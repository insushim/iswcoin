from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import gymnasium as gym
import numpy as np
import pandas as pd
from gymnasium import spaces


def _compute_features(df: pd.DataFrame, window: int = 14) -> pd.DataFrame:
    """Compute technical-analysis features from raw OHLCV data.

    The caller is expected to supply a DataFrame with columns:
        open, high, low, close, volume
    (case-insensitive; the function lowercases column names internally).

    Returns a *new* DataFrame with the original OHLCV columns plus:
        rsi, macd, macd_signal, bb_upper, bb_middle, bb_lower,
        atr, volume_ma, returns
    Rows with NaN (from rolling calculations) are dropped.
    """
    data = df.copy()
    data.columns = [c.lower() for c in data.columns]

    close = data["close"]
    high = data["high"]
    low = data["low"]
    volume = data["volume"]

    # --- Returns ---
    data["returns"] = close.pct_change()

    # --- RSI ---
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=window, min_periods=window).mean()
    avg_loss = loss.rolling(window=window, min_periods=window).mean()
    rs = avg_gain / (avg_loss + 1e-10)
    data["rsi"] = 100.0 - (100.0 / (1.0 + rs))

    # --- MACD ---
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    data["macd"] = ema12 - ema26
    data["macd_signal"] = data["macd"].ewm(span=9, adjust=False).mean()

    # --- Bollinger Bands ---
    sma20 = close.rolling(window=20).mean()
    std20 = close.rolling(window=20).std()
    data["bb_upper"] = sma20 + 2.0 * std20
    data["bb_middle"] = sma20
    data["bb_lower"] = sma20 - 2.0 * std20

    # --- ATR ---
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    data["atr"] = true_range.rolling(window=window).mean()

    # --- Volume MA ---
    data["volume_ma"] = volume.rolling(window=window).mean()

    data.dropna(inplace=True)
    data.reset_index(drop=True, inplace=True)
    return data


_FEATURE_COLUMNS = [
    "open", "high", "low", "close", "volume",
    "rsi", "macd", "macd_signal",
    "bb_upper", "bb_middle", "bb_lower",
    "atr", "volume_ma", "returns",
]


class CryptoTradingEnv(gym.Env):
    """A Gymnasium environment for single-asset cryptocurrency trading.

    Action space
    ------------
    ``Box(-1, 1, shape=(1,))`` where the scalar encodes:
        * -1  full sell (short or flatten)
        *  0  hold
        * +1  full buy

    Observation space
    -----------------
    ``Box(-inf, inf, shape=(window_size, num_features))`` representing a
    sliding window of normalised feature vectors.

    Reward
    ------
    ``log_return * position - transaction_cost``
    """

    metadata = {"render_modes": ["human"]}

    def __init__(
        self,
        df: pd.DataFrame,
        window_size: int = 60,
        initial_balance: float = 100_000.0,
        transaction_cost_pct: float = 0.001,
        max_position: float = 1.0,
        render_mode: Optional[str] = None,
    ) -> None:
        super().__init__()

        self.raw_df = df.copy()
        self.data = _compute_features(self.raw_df)
        self.window_size = window_size
        self.initial_balance = initial_balance
        self.transaction_cost_pct = transaction_cost_pct
        self.max_position = max_position
        self.render_mode = render_mode

        self.num_features = len(_FEATURE_COLUMNS)
        self.feature_data = self.data[_FEATURE_COLUMNS].values.astype(np.float32)

        # Normalise features per-column (z-score) for training stability
        self._mean = self.feature_data.mean(axis=0)
        self._std = self.feature_data.std(axis=0) + 1e-8
        self.feature_data = (self.feature_data - self._mean) / self._std

        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(1,), dtype=np.float32)
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self.window_size, self.num_features),
            dtype=np.float32,
        )

        # State variables (set in reset)
        self._current_step: int = 0
        self._start_step: int = 0
        self._position: float = 0.0  # fraction of max_position currently held
        self._balance: float = initial_balance
        self._portfolio_value: float = initial_balance
        self._prev_portfolio_value: float = initial_balance
        self._total_reward: float = 0.0
        self._trade_count: int = 0

    # ------------------------------------------------------------------
    # Gym API
    # ------------------------------------------------------------------

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)

        max_start = len(self.feature_data) - self.window_size - 1
        if max_start <= self.window_size:
            self._start_step = self.window_size
        else:
            self._start_step = self.np_random.integers(self.window_size, max_start)

        self._current_step = self._start_step
        self._position = 0.0
        self._balance = self.initial_balance
        self._portfolio_value = self.initial_balance
        self._prev_portfolio_value = self.initial_balance
        self._total_reward = 0.0
        self._trade_count = 0

        return self._get_observation(), self._get_info()

    def step(self, action: np.ndarray) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        action_value = float(np.clip(action[0], -1.0, 1.0))

        # Current close price (un-normalised from raw data aligned to feature_data)
        close_idx = _FEATURE_COLUMNS.index("close")
        raw_close = self.feature_data[self._current_step, close_idx] * self._std[close_idx] + self._mean[close_idx]
        prev_raw_close = (
            self.feature_data[self._current_step - 1, close_idx] * self._std[close_idx] + self._mean[close_idx]
        )

        # Desired position after action
        desired_position = np.clip(action_value, -self.max_position, self.max_position)
        position_delta = desired_position - self._position

        # Transaction cost for the trade
        trade_value = abs(position_delta) * self._balance
        cost = trade_value * self.transaction_cost_pct
        self._balance -= cost

        if abs(position_delta) > 1e-6:
            self._trade_count += 1

        self._position = desired_position

        # Log return of the asset
        if prev_raw_close > 0:
            log_return = float(np.log(raw_close / (prev_raw_close + 1e-10)))
        else:
            log_return = 0.0

        # Reward: position-weighted log return minus transaction cost fraction
        reward = log_return * self._position - (cost / (self._balance + 1e-10))

        # Update portfolio value
        self._prev_portfolio_value = self._portfolio_value
        self._portfolio_value = self._balance * (1.0 + self._position * log_return)
        self._balance = self._portfolio_value  # simplified mark-to-market
        self._total_reward += reward

        self._current_step += 1

        terminated = False
        truncated = False

        # Bankrupt
        if self._balance <= 0:
            terminated = True
            reward -= 1.0  # penalty

        # End of data
        if self._current_step >= len(self.feature_data) - 1:
            truncated = True

        obs = self._get_observation()
        info = self._get_info()

        if self.render_mode == "human":
            self.render()

        return obs, reward, terminated, truncated, info

    def render(self) -> None:
        print(
            f"Step {self._current_step} | "
            f"Balance: {self._balance:,.2f} | "
            f"Position: {self._position:+.3f} | "
            f"Trades: {self._trade_count} | "
            f"Total reward: {self._total_reward:.6f}"
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_observation(self) -> np.ndarray:
        start = self._current_step - self.window_size
        end = self._current_step
        obs = self.feature_data[start:end].copy()
        return obs

    def _get_info(self) -> Dict[str, Any]:
        return {
            "balance": self._balance,
            "position": self._position,
            "portfolio_value": self._portfolio_value,
            "total_reward": self._total_reward,
            "trade_count": self._trade_count,
            "current_step": self._current_step,
        }
