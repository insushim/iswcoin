from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np


class AnomalyType(str, Enum):
    FLASH_CRASH = "FLASH_CRASH"
    PUMP = "PUMP"
    VOLUME_SPIKE = "VOLUME_SPIKE"
    LIQUIDITY_CRISIS = "LIQUIDITY_CRISIS"


@dataclass
class AnomalyEvent:
    """A detected market anomaly."""

    anomaly_type: AnomalyType
    severity: float        # 0.0 .. 1.0
    description: str
    details: Dict[str, Any] = field(default_factory=dict)


class AnomalyDetector:
    """Rule-based anomaly detector for cryptocurrency market data."""

    # ------------------------------------------------------------------
    # Individual detectors
    # ------------------------------------------------------------------

    @staticmethod
    def detect_flash_crash(
        prices: np.ndarray,
        threshold: float = -0.05,
        window: int = 5,
    ) -> bool:
        """Detect a flash crash: short-window return exceeding *threshold*.

        Parameters
        ----------
        prices : array-like, shape (n,)
            Recent price series.
        threshold : float
            Negative return threshold (e.g. -0.05 for a 5 % drop).
        window : int
            Number of most recent bars to compute the return over.

        Returns
        -------
        bool
        """
        prices = np.asarray(prices, dtype=np.float64).flatten()
        if len(prices) < window + 1:
            return False
        recent_return = (prices[-1] / (prices[-window - 1] + 1e-10)) - 1.0
        return bool(recent_return <= threshold)

    @staticmethod
    def detect_pump(
        prices: np.ndarray,
        volumes: np.ndarray,
        price_threshold: float = 0.10,
        vol_threshold: float = 3.0,
        window: int = 5,
    ) -> bool:
        """Detect a pump event: large price increase combined with a volume spike.

        Parameters
        ----------
        prices : array-like
        volumes : array-like
        price_threshold : float
            Minimum positive return (e.g. 0.10 for 10 %).
        vol_threshold : float
            Multiplier above the rolling mean volume.
        window : int
            Lookback window for the return and for the "normal" volume mean.

        Returns
        -------
        bool
        """
        prices = np.asarray(prices, dtype=np.float64).flatten()
        volumes = np.asarray(volumes, dtype=np.float64).flatten()

        if len(prices) < window + 1 or len(volumes) < window + 1:
            return False

        recent_return = (prices[-1] / (prices[-window - 1] + 1e-10)) - 1.0
        mean_volume = volumes[-(window + 1):-1].mean()
        current_volume = volumes[-1]

        price_surged = recent_return >= price_threshold
        volume_surged = current_volume >= vol_threshold * (mean_volume + 1e-10)
        return bool(price_surged and volume_surged)

    @staticmethod
    def detect_volume_spike(
        volumes: np.ndarray,
        threshold: float = 3.0,
        window: int = 20,
    ) -> bool:
        """Detect an abnormal volume spike.

        Returns True when the most recent volume bar exceeds
        ``threshold`` times the rolling mean volume.
        """
        volumes = np.asarray(volumes, dtype=np.float64).flatten()
        if len(volumes) < window + 1:
            return False

        mean_vol = volumes[-window - 1:-1].mean()
        return bool(volumes[-1] >= threshold * (mean_vol + 1e-10))

    @staticmethod
    def detect_liquidity_crisis(
        orderbook_depth: np.ndarray,
        threshold: float = 0.3,
        window: int = 10,
    ) -> bool:
        """Detect a liquidity crisis from order-book depth data.

        *orderbook_depth* is an array of total-depth values (bid + ask size)
        over time.  A crisis is detected when the most recent depth drops
        below ``threshold`` times the rolling mean.
        """
        depth = np.asarray(orderbook_depth, dtype=np.float64).flatten()
        if len(depth) < window + 1:
            return False

        mean_depth = depth[-window - 1:-1].mean()
        return bool(depth[-1] <= threshold * (mean_depth + 1e-10))

    # ------------------------------------------------------------------
    # Aggregate scanner
    # ------------------------------------------------------------------

    def scan_all(
        self,
        market_data: Dict[str, Any],
    ) -> List[AnomalyEvent]:
        """Run all detectors and return a list of anomaly events.

        Parameters
        ----------
        market_data : dict
            Expected keys (all optional):
                ``prices``          - 1-D array of recent prices
                ``volumes``         - 1-D array of recent volumes
                ``orderbook_depth`` - 1-D array of order-book depth snapshots

        Returns
        -------
        List[AnomalyEvent]
        """
        events: List[AnomalyEvent] = []

        prices: Optional[np.ndarray] = market_data.get("prices")
        volumes: Optional[np.ndarray] = market_data.get("volumes")
        orderbook_depth: Optional[np.ndarray] = market_data.get("orderbook_depth")

        # --- Flash crash ---
        if prices is not None:
            prices_arr = np.asarray(prices, dtype=np.float64)
            if self.detect_flash_crash(prices_arr):
                recent_ret = (prices_arr[-1] / (prices_arr[-6] + 1e-10)) - 1.0
                severity = min(abs(recent_ret) / 0.20, 1.0)  # 20 % drop = severity 1
                events.append(AnomalyEvent(
                    anomaly_type=AnomalyType.FLASH_CRASH,
                    severity=severity,
                    description=f"Flash crash detected: {recent_ret:.2%} drop in 5 bars",
                    details={"return": float(recent_ret)},
                ))

        # --- Pump ---
        if prices is not None and volumes is not None:
            prices_arr = np.asarray(prices, dtype=np.float64)
            volumes_arr = np.asarray(volumes, dtype=np.float64)
            if self.detect_pump(prices_arr, volumes_arr):
                recent_ret = (prices_arr[-1] / (prices_arr[-6] + 1e-10)) - 1.0
                vol_ratio = volumes_arr[-1] / (volumes_arr[-6:-1].mean() + 1e-10)
                severity = min(recent_ret / 0.30, 1.0)
                events.append(AnomalyEvent(
                    anomaly_type=AnomalyType.PUMP,
                    severity=severity,
                    description=f"Pump detected: +{recent_ret:.2%} price, {vol_ratio:.1f}x volume",
                    details={"return": float(recent_ret), "volume_ratio": float(vol_ratio)},
                ))

        # --- Volume spike ---
        if volumes is not None:
            volumes_arr = np.asarray(volumes, dtype=np.float64)
            if self.detect_volume_spike(volumes_arr):
                mean_vol = volumes_arr[-21:-1].mean() if len(volumes_arr) >= 21 else volumes_arr[:-1].mean()
                ratio = volumes_arr[-1] / (mean_vol + 1e-10)
                severity = min((ratio - 3.0) / 7.0, 1.0)
                events.append(AnomalyEvent(
                    anomaly_type=AnomalyType.VOLUME_SPIKE,
                    severity=max(severity, 0.0),
                    description=f"Volume spike: {ratio:.1f}x above mean",
                    details={"volume_ratio": float(ratio)},
                ))

        # --- Liquidity crisis ---
        if orderbook_depth is not None:
            depth_arr = np.asarray(orderbook_depth, dtype=np.float64)
            if self.detect_liquidity_crisis(depth_arr):
                mean_depth = depth_arr[-11:-1].mean() if len(depth_arr) >= 11 else depth_arr[:-1].mean()
                ratio = depth_arr[-1] / (mean_depth + 1e-10)
                severity = min((1.0 - ratio) / 0.7, 1.0)
                events.append(AnomalyEvent(
                    anomaly_type=AnomalyType.LIQUIDITY_CRISIS,
                    severity=max(severity, 0.0),
                    description=f"Liquidity crisis: depth at {ratio:.1%} of mean",
                    details={"depth_ratio": float(ratio)},
                ))

        return events
