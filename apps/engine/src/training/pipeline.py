"""Full training pipeline for the RL-based trading engine.

Usage
-----
    python -m apps.engine.src.training.pipeline
    # or
    python apps/engine/src/training/pipeline.py
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import optuna
import pandas as pd

from ..config import settings
from ..env.trading_env import CryptoTradingEnv
from ..agents.ppo_lstm import PPOLSTMAgent
from ..agents.sac_agent import SACAgent
from ..agents.ensemble import EnsembleAgent

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# ======================================================================
# Data loading
# ======================================================================

def load_data(symbol: str = "BTCUSDT", timeframe: str = "1h") -> pd.DataFrame:
    """Load OHLCV data from a local CSV.

    Expected CSV columns: ``date, open, high, low, close, volume``.
    The function searches ``settings.DATA_DIR`` for a file named
    ``{symbol}_{timeframe}.csv``.  If the file is missing a small
    synthetic dataset is generated for demonstration purposes.
    """
    csv_path = Path(settings.DATA_DIR) / f"{symbol}_{timeframe}.csv"

    if csv_path.exists():
        logger.info("Loading data from %s", csv_path)
        df = pd.read_csv(csv_path, parse_dates=["date"])
        df.sort_values("date", inplace=True)
        df.reset_index(drop=True, inplace=True)
        return df

    logger.warning("CSV not found at %s -- generating synthetic data for demo", csv_path)
    return _generate_synthetic(n_bars=5000)


def _generate_synthetic(n_bars: int = 5000) -> pd.DataFrame:
    """Create synthetic OHLCV data resembling a crypto asset."""
    rng = np.random.default_rng(42)
    dates = pd.date_range(end=datetime.now(tz=timezone.utc), periods=n_bars, freq="h")

    price = 30_000.0
    rows = []
    for dt in dates:
        ret = rng.normal(0.0001, 0.005)
        price *= 1.0 + ret
        h = price * (1 + abs(rng.normal(0, 0.003)))
        l = price * (1 - abs(rng.normal(0, 0.003)))
        o = price * (1 + rng.normal(0, 0.001))
        v = rng.lognormal(mean=10.0, sigma=1.0)
        rows.append({"date": dt, "open": o, "high": h, "low": l, "close": price, "volume": v})

    return pd.DataFrame(rows)


# ======================================================================
# Pre-processing
# ======================================================================

def preprocess(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Return (features_df, labels_df) - labels are future returns.

    For RL we mainly use the raw dataframe inside the environment;
    the returned objects are useful for supervised pre-training or analysis.
    """
    data = df.copy()
    data.columns = [c.lower() for c in data.columns]
    data["returns"] = data["close"].pct_change()
    data["future_return"] = data["returns"].shift(-1)
    data.dropna(inplace=True)
    data.reset_index(drop=True, inplace=True)

    feature_cols = ["open", "high", "low", "close", "volume"]
    return data[feature_cols], data[["future_return"]]


# ======================================================================
# Training
# ======================================================================

def train_agents(
    df: pd.DataFrame,
    window_size: int = 60,
    ppo_timesteps: int = 50_000,
    sac_timesteps: int = 50_000,
) -> Tuple[PPOLSTMAgent, SACAgent]:
    """Train PPO-LSTM and SAC agents on the supplied data."""
    env_ppo = CryptoTradingEnv(df, window_size=window_size)
    env_sac = CryptoTradingEnv(df, window_size=window_size)

    logger.info("Training PPO-LSTM for %d timesteps ...", ppo_timesteps)
    ppo_agent = PPOLSTMAgent(env_ppo, verbose=0)
    ppo_agent.train(total_timesteps=ppo_timesteps)

    logger.info("Training SAC for %d timesteps ...", sac_timesteps)
    sac_agent = SACAgent(env_sac, verbose=0)
    sac_agent.train(total_timesteps=sac_timesteps)

    return ppo_agent, sac_agent


# ======================================================================
# Evaluation
# ======================================================================

@dataclass
class EvalMetrics:
    total_reward: float
    total_return_pct: float
    sharpe_ratio: float
    max_drawdown: float
    n_trades: int
    win_rate: float


def evaluate(
    agent: Any,
    df: pd.DataFrame,
    window_size: int = 60,
    n_episodes: int = 3,
) -> EvalMetrics:
    """Backtest an agent and return aggregate metrics."""
    env = CryptoTradingEnv(df, window_size=window_size)
    all_rewards: List[float] = []
    all_balances: List[List[float]] = []
    all_trades: List[int] = []
    step_rewards_concat: List[float] = []

    for ep in range(n_episodes):
        obs, info = env.reset(seed=ep)
        done = False
        ep_reward = 0.0
        balances = [info["balance"]]
        step_rewards: List[float] = []

        while not done:
            action = agent.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(action)
            ep_reward += reward
            step_rewards.append(reward)
            balances.append(info["balance"])
            done = terminated or truncated

        all_rewards.append(ep_reward)
        all_balances.append(balances)
        all_trades.append(info["trade_count"])
        step_rewards_concat.extend(step_rewards)

    avg_reward = float(np.mean(all_rewards))
    avg_trades = int(np.mean(all_trades))

    # Return %
    final_balances = [b[-1] for b in all_balances]
    initial_balance = env.initial_balance
    avg_return_pct = float(np.mean([(fb / initial_balance - 1.0) * 100 for fb in final_balances]))

    # Sharpe ratio (annualised, assume hourly data ~8760 bars/yr)
    step_arr = np.array(step_rewards_concat)
    if step_arr.std() > 0:
        sharpe = float((step_arr.mean() / step_arr.std()) * np.sqrt(8760))
    else:
        sharpe = 0.0

    # Max drawdown across episodes
    max_dd = 0.0
    for balances in all_balances:
        peak = balances[0]
        for b in balances:
            peak = max(peak, b)
            dd = (peak - b) / (peak + 1e-10)
            max_dd = max(max_dd, dd)

    # Win rate (fraction of positive-reward steps)
    positive = sum(1 for r in step_rewards_concat if r > 0)
    win_rate = positive / max(len(step_rewards_concat), 1)

    return EvalMetrics(
        total_reward=avg_reward,
        total_return_pct=avg_return_pct,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        n_trades=avg_trades,
        win_rate=win_rate,
    )


# ======================================================================
# Hyperparameter optimisation (Optuna)
# ======================================================================

def optimize_hyperparams(
    df: pd.DataFrame,
    n_trials: int = 50,
    timesteps_per_trial: int = 20_000,
    window_size: int = 60,
) -> Dict[str, Any]:
    """Use Optuna to tune PPO hyperparameters.

    Returns the best trial's parameters.
    """

    def objective(trial: optuna.Trial) -> float:
        lr = trial.suggest_float("learning_rate", 1e-5, 1e-3, log=True)
        n_steps = trial.suggest_categorical("n_steps", [512, 1024, 2048])
        batch_size = trial.suggest_categorical("batch_size", [32, 64, 128])
        gamma = trial.suggest_float("gamma", 0.95, 0.999)
        gae_lambda = trial.suggest_float("gae_lambda", 0.9, 0.99)
        clip_range = trial.suggest_float("clip_range", 0.1, 0.3)
        ent_coef = trial.suggest_float("ent_coef", 1e-4, 0.1, log=True)

        env = CryptoTradingEnv(df, window_size=window_size)
        agent = PPOLSTMAgent(
            env,
            learning_rate=lr,
            n_steps=n_steps,
            batch_size=batch_size,
            gamma=gamma,
            gae_lambda=gae_lambda,
            clip_range=clip_range,
            ent_coef=ent_coef,
            verbose=0,
        )

        try:
            agent.train(total_timesteps=timesteps_per_trial)
        except Exception as exc:
            logger.warning("Trial %d failed: %s", trial.number, exc)
            return -1e6

        metrics = evaluate(agent, df, window_size=window_size, n_episodes=1)
        return metrics.sharpe_ratio

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)

    logger.info("Best trial: %s", study.best_trial.params)
    return study.best_trial.params


# ======================================================================
# Walk-forward validation
# ======================================================================

def walk_forward_validation(
    df: pd.DataFrame,
    n_splits: int = 5,
    train_ratio: float = 0.8,
    window_size: int = 60,
    timesteps: int = 30_000,
) -> List[EvalMetrics]:
    """Expanding-window walk-forward validation.

    The data is split into ``n_splits`` folds.  For each fold the agent
    is trained on all prior data and tested on the current fold.
    """
    n = len(df)
    fold_size = n // n_splits
    results: List[EvalMetrics] = []

    for i in range(1, n_splits):
        train_end = i * fold_size
        test_end = min(train_end + fold_size, n)
        train_df = df.iloc[:train_end].copy().reset_index(drop=True)
        test_df = df.iloc[train_end:test_end].copy().reset_index(drop=True)

        if len(test_df) <= window_size + 2:
            logger.warning("Fold %d test set too small, skipping", i)
            continue

        logger.info(
            "Walk-forward fold %d/%d  train=%d  test=%d",
            i, n_splits - 1, len(train_df), len(test_df),
        )

        ppo_agent, _ = train_agents(train_df, window_size=window_size, ppo_timesteps=timesteps, sac_timesteps=0)
        metrics = evaluate(ppo_agent, test_df, window_size=window_size, n_episodes=1)
        results.append(metrics)
        logger.info("  -> Sharpe=%.3f  Return=%.2f%%  MaxDD=%.3f", metrics.sharpe_ratio, metrics.total_return_pct, metrics.max_drawdown)

    return results


# ======================================================================
# Save best model
# ======================================================================

def save_best_model(agent: Any, name: str = "best_model") -> str:
    """Persist model and write a metadata sidecar JSON."""
    model_dir = Path(settings.MODEL_DIR)
    model_dir.mkdir(parents=True, exist_ok=True)
    path = str(model_dir / name)
    agent.save(path)

    meta = {
        "name": name,
        "saved_at": datetime.now(tz=timezone.utc).isoformat(),
        "type": type(agent).__name__,
    }
    meta_path = model_dir / f"{name}_meta.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    logger.info("Model saved to %s", path)
    return path


# ======================================================================
# Main entry point
# ======================================================================

def run_pipeline(
    symbol: str = "BTCUSDT",
    timeframe: str = "1h",
    ppo_timesteps: int = 50_000,
    sac_timesteps: int = 50_000,
    optuna_trials: int = 0,
    walk_forward_splits: int = 0,
) -> Dict[str, Any]:
    """Execute the full training pipeline end-to-end."""
    logger.info("=== Training pipeline start ===")
    start = time.time()

    df = load_data(symbol, timeframe)
    logger.info("Loaded %d bars for %s %s", len(df), symbol, timeframe)

    # Optional: Optuna HPO
    best_params: Dict[str, Any] = {}
    if optuna_trials > 0:
        best_params = optimize_hyperparams(df, n_trials=optuna_trials)

    # Train agents
    ppo_agent, sac_agent = train_agents(df, ppo_timesteps=ppo_timesteps, sac_timesteps=sac_timesteps)

    # Evaluate
    ppo_metrics = evaluate(ppo_agent, df)
    sac_metrics = evaluate(sac_agent, df)

    logger.info("PPO metrics: %s", asdict(ppo_metrics))
    logger.info("SAC metrics: %s", asdict(sac_metrics))

    # Save best
    if ppo_metrics.sharpe_ratio >= sac_metrics.sharpe_ratio:
        save_best_model(ppo_agent, "best_ppo")
        best_agent_name = "PPO-LSTM"
    else:
        save_best_model(sac_agent, "best_sac")
        best_agent_name = "SAC"

    save_best_model(ppo_agent, "ppo_latest")
    save_best_model(sac_agent, "sac_latest")

    # Optional: walk-forward validation
    wf_results: List[Dict[str, Any]] = []
    if walk_forward_splits > 0:
        wf_metrics = walk_forward_validation(df, n_splits=walk_forward_splits)
        wf_results = [asdict(m) for m in wf_metrics]

    elapsed = time.time() - start
    logger.info("=== Pipeline complete in %.1fs ===", elapsed)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "bars": len(df),
        "ppo_metrics": asdict(ppo_metrics),
        "sac_metrics": asdict(sac_metrics),
        "best_agent": best_agent_name,
        "best_params": best_params,
        "walk_forward": wf_results,
        "elapsed_seconds": elapsed,
    }


if __name__ == "__main__":
    results = run_pipeline(
        symbol="BTCUSDT",
        timeframe="1h",
        ppo_timesteps=50_000,
        sac_timesteps=50_000,
    )
    print(json.dumps(results, indent=2, default=str))
