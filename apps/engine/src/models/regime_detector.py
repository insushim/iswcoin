from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM


class MarketRegime(IntEnum):
    """Four canonical market regimes."""

    BULL_HIGH_VOL = 0
    BULL_LOW_VOL = 1
    BEAR_HIGH_VOL = 2
    BEAR_LOW_VOL = 3


_REGIME_LABELS: Dict[int, str] = {
    MarketRegime.BULL_HIGH_VOL: "BULL_HIGH_VOL",
    MarketRegime.BULL_LOW_VOL: "BULL_LOW_VOL",
    MarketRegime.BEAR_HIGH_VOL: "BEAR_HIGH_VOL",
    MarketRegime.BEAR_LOW_VOL: "BEAR_LOW_VOL",
}


@dataclass
class RegimePrediction:
    """Result of a single regime prediction."""

    regime: MarketRegime
    label: str
    probability: float
    all_probabilities: Dict[str, float]


class RegimeDetector:
    """Hidden Markov Model-based market-regime detector.

    Features used for HMM training:
        * returns          - log price returns
        * volatility       - rolling standard deviation of returns
        * volume_change    - percentage change in volume

    After fitting, the four HMM states are *mapped* to the canonical regime
    labels by sorting on mean-return and mean-volatility of each state.
    """

    def __init__(
        self,
        n_regimes: int = 4,
        n_iter: int = 200,
        covariance_type: str = "full",
        volatility_window: int = 20,
        random_state: int = 42,
    ) -> None:
        self.n_regimes = n_regimes
        self.volatility_window = volatility_window
        self._hmm = GaussianHMM(
            n_components=n_regimes,
            covariance_type=covariance_type,
            n_iter=n_iter,
            random_state=random_state,
        )
        self._state_map: Dict[int, MarketRegime] = {}
        self._is_fitted = False

    # ------------------------------------------------------------------
    # Feature engineering
    # ------------------------------------------------------------------

    @staticmethod
    def _build_features(
        prices: np.ndarray,
        volumes: np.ndarray,
        volatility_window: int,
    ) -> np.ndarray:
        """Build (returns, volatility, volume_change) matrix."""
        prices = np.asarray(prices, dtype=np.float64).flatten()
        volumes = np.asarray(volumes, dtype=np.float64).flatten()

        returns = np.diff(np.log(prices + 1e-10))
        vol_change = np.diff(volumes) / (volumes[:-1] + 1e-10)

        # Rolling volatility (same length as returns)
        volatility = np.full_like(returns, np.nan)
        for i in range(volatility_window, len(returns)):
            volatility[i] = np.std(returns[i - volatility_window: i])

        # Trim leading NaNs
        valid = ~np.isnan(volatility)
        features = np.column_stack([returns[valid], volatility[valid], vol_change[valid]])
        return features

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fit(self, prices: np.ndarray, volumes: np.ndarray) -> "RegimeDetector":
        """Fit the HMM on historical price/volume data.

        Parameters
        ----------
        prices : array-like, shape (n_samples,)
        volumes : array-like, shape (n_samples,)

        Returns
        -------
        self
        """
        features = self._build_features(prices, volumes, self.volatility_window)
        self._hmm.fit(features)
        self._map_states(features)
        self._is_fitted = True
        return self

    def predict(self, prices: np.ndarray, volumes: np.ndarray) -> RegimePrediction:
        """Predict the *current* (most recent) market regime.

        Returns a ``RegimePrediction`` containing the regime enum, a human-
        readable label, the probability of the predicted state, and
        probabilities for all states.
        """
        if not self._is_fitted:
            raise RuntimeError("RegimeDetector has not been fitted yet. Call fit() first.")

        features = self._build_features(prices, volumes, self.volatility_window)
        posteriors = self._hmm.predict_proba(features)

        last_posterior = posteriors[-1]  # probability distribution at the latest step
        raw_state = int(np.argmax(last_posterior))
        mapped_regime = self._state_map.get(raw_state, MarketRegime.BULL_LOW_VOL)

        all_probs: Dict[str, float] = {}
        for raw_idx, prob in enumerate(last_posterior):
            regime = self._state_map.get(raw_idx, MarketRegime(raw_idx % 4))
            all_probs[_REGIME_LABELS[regime]] = float(prob)

        return RegimePrediction(
            regime=mapped_regime,
            label=_REGIME_LABELS[mapped_regime],
            probability=float(last_posterior[raw_state]),
            all_probabilities=all_probs,
        )

    def get_transition_matrix(self) -> np.ndarray:
        """Return the state transition probability matrix (n_regimes x n_regimes).

        Rows/columns follow the raw HMM state ordering.  Use ``_state_map``
        to translate to canonical regime labels.
        """
        if not self._is_fitted:
            raise RuntimeError("RegimeDetector has not been fitted yet.")
        return self._hmm.transmat_.copy()

    def get_state_map(self) -> Dict[int, str]:
        """Human-readable mapping from raw HMM state index to regime label."""
        return {k: _REGIME_LABELS[v] for k, v in self._state_map.items()}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _map_states(self, features: np.ndarray) -> None:
        """Map raw HMM states to canonical regime labels.

        Strategy:
            1. Compute mean return and mean volatility per state.
            2. States with positive mean return are BULL, else BEAR.
            3. Within each group, higher volatility = HIGH_VOL.
        """
        states = self._hmm.predict(features)
        means: Dict[int, Tuple[float, float]] = {}
        for s in range(self.n_regimes):
            mask = states == s
            if mask.sum() == 0:
                means[s] = (0.0, 0.0)
            else:
                means[s] = (
                    float(features[mask, 0].mean()),  # return
                    float(features[mask, 1].mean()),  # volatility
                )

        sorted_states = sorted(means.keys(), key=lambda s: means[s][0], reverse=True)

        # Top half are bulls, bottom half are bears
        half = self.n_regimes // 2
        bulls = sorted_states[:half]
        bears = sorted_states[half:]

        # Sort each group by volatility (descending)
        bulls.sort(key=lambda s: means[s][1], reverse=True)
        bears.sort(key=lambda s: means[s][1], reverse=True)

        mapping: Dict[int, MarketRegime] = {}
        if len(bulls) >= 1:
            mapping[bulls[0]] = MarketRegime.BULL_HIGH_VOL
        if len(bulls) >= 2:
            mapping[bulls[1]] = MarketRegime.BULL_LOW_VOL
        if len(bears) >= 1:
            mapping[bears[0]] = MarketRegime.BEAR_HIGH_VOL
        if len(bears) >= 2:
            mapping[bears[1]] = MarketRegime.BEAR_LOW_VOL

        self._state_map = mapping
