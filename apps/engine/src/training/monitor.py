"""Training monitor -- checks model staleness and triggers retraining.

Usage
-----
    python -m apps.engine.src.training.monitor
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# ======================================================================
# Helpers
# ======================================================================

def _load_meta(name: str) -> Optional[Dict[str, Any]]:
    """Load the JSON sidecar for a saved model."""
    meta_path = Path(settings.MODEL_DIR) / f"{name}_meta.json"
    if not meta_path.exists():
        return None
    with open(meta_path, "r") as f:
        return json.load(f)


def _model_age_days(meta: Dict[str, Any]) -> float:
    """Return how many days since the model was saved."""
    saved_at_str = meta.get("saved_at", "")
    if not saved_at_str:
        return float("inf")
    try:
        saved_at = datetime.fromisoformat(saved_at_str)
    except ValueError:
        return float("inf")

    if saved_at.tzinfo is None:
        saved_at = saved_at.replace(tzinfo=timezone.utc)

    age = datetime.now(tz=timezone.utc) - saved_at
    return age.total_seconds() / 86_400


# ======================================================================
# Staleness check
# ======================================================================

def check_staleness(model_names: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
    """Check whether each model is stale (older than ``RETRAIN_STALENESS_DAYS``).

    Returns
    -------
    dict
        Mapping from model name to ``{age_days, is_stale, saved_at}``.
    """
    if model_names is None:
        model_names = ["ppo_latest", "sac_latest", "best_ppo", "best_sac"]

    results: Dict[str, Dict[str, Any]] = {}
    for name in model_names:
        meta = _load_meta(name)
        if meta is None:
            results[name] = {"age_days": None, "is_stale": True, "saved_at": None, "reason": "not_found"}
            continue
        age = _model_age_days(meta)
        stale = age > settings.RETRAIN_STALENESS_DAYS
        results[name] = {
            "age_days": round(age, 2),
            "is_stale": stale,
            "saved_at": meta.get("saved_at"),
            "reason": "age_exceeded" if stale else "ok",
        }
    return results


# ======================================================================
# Performance degradation
# ======================================================================

def detect_performance_degradation(
    recent_sharpe: float,
    baseline_sharpe: float,
    threshold_pct: float = 0.30,
) -> bool:
    """Return True if recent Sharpe has degraded by more than *threshold_pct*
    relative to the baseline.

    Example
    -------
    >>> detect_performance_degradation(0.5, 1.0, threshold_pct=0.30)
    True   # 50 % degradation > 30 % threshold
    """
    if baseline_sharpe <= 0:
        return recent_sharpe < 0
    degradation = (baseline_sharpe - recent_sharpe) / abs(baseline_sharpe)
    return degradation > threshold_pct


# ======================================================================
# Auto-retrain trigger
# ======================================================================

def auto_trigger_retrain(
    model_names: Optional[List[str]] = None,
    recent_sharpe: Optional[float] = None,
    baseline_sharpe: Optional[float] = None,
) -> Dict[str, Any]:
    """Decide whether retraining should be triggered.

    Combines staleness and optional performance degradation checks.

    Returns
    -------
    dict
        ``{should_retrain, reasons, staleness}``
    """
    staleness = check_staleness(model_names)
    reasons: List[str] = []

    stale_models = [name for name, info in staleness.items() if info["is_stale"]]
    if stale_models:
        reasons.append(f"stale_models: {stale_models}")

    if recent_sharpe is not None and baseline_sharpe is not None:
        if detect_performance_degradation(recent_sharpe, baseline_sharpe):
            reasons.append(
                f"performance_degradation: recent_sharpe={recent_sharpe:.3f} "
                f"vs baseline={baseline_sharpe:.3f}"
            )

    should_retrain = len(reasons) > 0
    return {
        "should_retrain": should_retrain,
        "reasons": reasons,
        "staleness": staleness,
        "checked_at": datetime.now(tz=timezone.utc).isoformat(),
    }


# ======================================================================
# Metric logging
# ======================================================================

def log_metrics(metrics: Dict[str, Any], tag: str = "monitor") -> None:
    """Log metrics as structured JSON.  In production this would ship to
    a metrics backend; here we simply log to stdout.
    """
    entry = {
        "tag": tag,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        **metrics,
    }
    logger.info(json.dumps(entry, default=str))


# ======================================================================
# Main loop
# ======================================================================

def run_monitor_loop(interval_seconds: int = 3600) -> None:
    """Run the monitor indefinitely, checking every *interval_seconds*.

    When retraining is needed, this imports and runs the training pipeline.
    """
    logger.info("Monitor loop started (interval=%ds)", interval_seconds)

    while True:
        try:
            result = auto_trigger_retrain()
            log_metrics(result, tag="retrain_check")

            if result["should_retrain"]:
                logger.info("Retraining triggered: %s", result["reasons"])
                try:
                    from .pipeline import run_pipeline

                    pipeline_result = run_pipeline()
                    log_metrics(pipeline_result, tag="retrain_result")
                except Exception as exc:
                    logger.error("Retraining failed: %s", exc, exc_info=True)
            else:
                logger.info("All models healthy -- no retraining needed")

        except Exception as exc:
            logger.error("Monitor iteration failed: %s", exc, exc_info=True)

        time.sleep(interval_seconds)


if __name__ == "__main__":
    run_monitor_loop(interval_seconds=3600)
