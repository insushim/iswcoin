"""FastAPI application exposing the ML/RL trading engine."""
from __future__ import annotations

import json
import logging
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import settings
from .env.trading_env import CryptoTradingEnv
from .agents.ppo_lstm import PPOLSTMAgent
from .agents.sac_agent import SACAgent
from .agents.ensemble import EnsembleAgent
from .models.regime_detector import RegimeDetector
from .models.portfolio_optimizer import PortfolioOptimizer
from .models.anomaly_detector import AnomalyDetector

logger = logging.getLogger(__name__)

app = FastAPI(
    title="ISWCoin Trading Engine",
    version="1.0.0",
    description="ML/RL trading engine with PPO-LSTM, SAC, regime detection, portfolio optimisation, and anomaly scanning.",
)


# ======================================================================
# Request / Response schemas
# ======================================================================

class PredictRequest(BaseModel):
    observation: List[List[float]] = Field(..., description="2-D observation matrix (window_size x num_features)")
    deterministic: bool = True


class PredictResponse(BaseModel):
    action: float
    model_used: str


class RegimeRequest(BaseModel):
    prices: List[float]
    volumes: List[float]


class RegimeResponse(BaseModel):
    regime: str
    probability: float
    all_probabilities: Dict[str, float]


class OptimizeRequest(BaseModel):
    returns: List[List[float]] = Field(..., description="2-D array (T x n_assets) of historical returns")
    risk_aversion: float = 1.0
    include_frontier: bool = False
    n_frontier_points: int = 30
    var_confidence: float = 0.95
    garch_horizon: int = 5


class OptimizeResponse(BaseModel):
    weights: List[float]
    var: float
    cvar: float
    garch_forecast: List[float]
    frontier: Optional[List[Dict[str, Any]]] = None


class AnomalyRequest(BaseModel):
    prices: Optional[List[float]] = None
    volumes: Optional[List[float]] = None
    orderbook_depth: Optional[List[float]] = None


class AnomalyResponse(BaseModel):
    anomalies: List[Dict[str, Any]]
    count: int


class BacktestRequest(BaseModel):
    ohlcv: List[Dict[str, float]] = Field(
        ...,
        description="List of dicts with keys: open, high, low, close, volume",
    )
    window_size: int = 60
    agent_type: str = "ppo"
    n_episodes: int = 1


class BacktestResponse(BaseModel):
    total_reward: float
    total_return_pct: float
    sharpe_ratio: float
    max_drawdown: float
    n_trades: int
    win_rate: float


class ModelStatusResponse(BaseModel):
    models: Dict[str, Any]
    engine_version: str = "1.0.0"


class HealthResponse(BaseModel):
    status: str
    timestamp: str


# ======================================================================
# Startup: lazy-load models
# ======================================================================

_state: Dict[str, Any] = {
    "ppo_agent": None,
    "sac_agent": None,
    "ensemble": None,
    "regime_detector": None,
}


def _try_load_agents() -> None:
    """Attempt to load persisted models (non-fatal if missing)."""
    model_dir = Path(settings.MODEL_DIR)

    # We need a dummy env to load SB3 models -- create a minimal one
    dummy_df = _make_dummy_df()
    dummy_env = CryptoTradingEnv(dummy_df, window_size=settings.DEFAULT_WINDOW_SIZE)

    ppo_path = model_dir / "ppo_latest.zip"
    if ppo_path.exists():
        try:
            _state["ppo_agent"] = PPOLSTMAgent.from_pretrained(str(model_dir / "ppo_latest"), dummy_env)
            logger.info("Loaded PPO agent")
        except Exception as exc:
            logger.warning("Could not load PPO agent: %s", exc)

    sac_path = model_dir / "sac_latest.zip"
    if sac_path.exists():
        try:
            _state["sac_agent"] = SACAgent.from_pretrained(str(model_dir / "sac_latest"), dummy_env)
            logger.info("Loaded SAC agent")
        except Exception as exc:
            logger.warning("Could not load SAC agent: %s", exc)

    agents = []
    if _state["ppo_agent"] is not None:
        agents.append(_state["ppo_agent"])
    if _state["sac_agent"] is not None:
        agents.append(_state["sac_agent"])
    if agents:
        _state["ensemble"] = EnsembleAgent(agents)
        logger.info("Ensemble created with %d agents", len(agents))


def _make_dummy_df(n: int = 500) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    price = 30_000.0
    rows = []
    for i in range(n):
        ret = rng.normal(0, 0.005)
        price *= 1 + ret
        rows.append({
            "open": price * (1 + rng.normal(0, 0.001)),
            "high": price * 1.003,
            "low": price * 0.997,
            "close": price,
            "volume": rng.lognormal(10, 1),
        })
    return pd.DataFrame(rows)


@app.on_event("startup")
async def startup_event() -> None:
    logger.info("Engine starting up ...")
    _try_load_agents()


# ======================================================================
# Endpoints
# ======================================================================

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        timestamp=datetime.now(tz=timezone.utc).isoformat(),
    )


@app.get("/model/status", response_model=ModelStatusResponse)
async def model_status() -> ModelStatusResponse:
    model_dir = Path(settings.MODEL_DIR)
    models_info: Dict[str, Any] = {}

    for name in ("ppo_latest", "sac_latest", "best_ppo", "best_sac"):
        meta_path = model_dir / f"{name}_meta.json"
        if meta_path.exists():
            with open(meta_path) as f:
                models_info[name] = json.load(f)
        else:
            models_info[name] = {"status": "not_found"}

    models_info["ensemble_active"] = _state["ensemble"] is not None
    models_info["ppo_loaded"] = _state["ppo_agent"] is not None
    models_info["sac_loaded"] = _state["sac_agent"] is not None

    return ModelStatusResponse(models=models_info)


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    obs = np.array(req.observation, dtype=np.float32)

    if _state["ensemble"] is not None:
        action = _state["ensemble"].predict(obs, deterministic=req.deterministic)
        return PredictResponse(action=float(action[0]), model_used="ensemble")

    if _state["ppo_agent"] is not None:
        action = _state["ppo_agent"].predict(obs, deterministic=req.deterministic)
        return PredictResponse(action=float(action[0]), model_used="ppo_lstm")

    if _state["sac_agent"] is not None:
        action = _state["sac_agent"].predict(obs, deterministic=req.deterministic)
        return PredictResponse(action=float(action[0]), model_used="sac")

    raise HTTPException(status_code=503, detail="No trained model available. Run training pipeline first.")


@app.post("/regime", response_model=RegimeResponse)
async def regime(req: RegimeRequest) -> RegimeResponse:
    prices = np.array(req.prices, dtype=np.float64)
    volumes = np.array(req.volumes, dtype=np.float64)

    if len(prices) < 100:
        raise HTTPException(status_code=400, detail="At least 100 price points required for regime detection")

    detector = RegimeDetector()
    detector.fit(prices, volumes)
    result = detector.predict(prices, volumes)

    return RegimeResponse(
        regime=result.label,
        probability=result.probability,
        all_probabilities=result.all_probabilities,
    )


@app.post("/optimize", response_model=OptimizeResponse)
async def optimize(req: OptimizeRequest) -> OptimizeResponse:
    returns = np.array(req.returns, dtype=np.float64)
    if returns.ndim != 2:
        raise HTTPException(status_code=400, detail="returns must be a 2-D array")

    opt = PortfolioOptimizer()

    weights = opt.mean_variance_optimize(returns, risk_aversion=req.risk_aversion)
    var = opt.monte_carlo_var(returns, confidence=req.var_confidence)
    cvar_val = opt.cvar(returns, confidence=req.var_confidence)
    garch = opt.garch_forecast(returns, horizon=req.garch_horizon)

    frontier_data = None
    if req.include_frontier:
        frontier = opt.efficient_frontier(returns, n_points=req.n_frontier_points)
        frontier_data = [
            {"risk": p.risk, "return": p.ret, "weights": p.weights.tolist()}
            for p in frontier
        ]

    return OptimizeResponse(
        weights=weights.tolist(),
        var=var,
        cvar=cvar_val,
        garch_forecast=garch.tolist(),
        frontier=frontier_data,
    )


@app.post("/anomaly", response_model=AnomalyResponse)
async def anomaly(req: AnomalyRequest) -> AnomalyResponse:
    market_data: Dict[str, Any] = {}
    if req.prices is not None:
        market_data["prices"] = np.array(req.prices, dtype=np.float64)
    if req.volumes is not None:
        market_data["volumes"] = np.array(req.volumes, dtype=np.float64)
    if req.orderbook_depth is not None:
        market_data["orderbook_depth"] = np.array(req.orderbook_depth, dtype=np.float64)

    detector = AnomalyDetector()
    events = detector.scan_all(market_data)

    return AnomalyResponse(
        anomalies=[
            {
                "type": e.anomaly_type.value,
                "severity": e.severity,
                "description": e.description,
                "details": e.details,
            }
            for e in events
        ],
        count=len(events),
    )


@app.post("/backtest", response_model=BacktestResponse)
async def backtest(req: BacktestRequest) -> BacktestResponse:
    df = pd.DataFrame(req.ohlcv)
    required_cols = {"open", "high", "low", "close", "volume"}
    if not required_cols.issubset(set(df.columns)):
        raise HTTPException(
            status_code=400,
            detail=f"OHLCV data must contain columns: {required_cols}",
        )

    if len(df) < req.window_size + 50:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {req.window_size + 50} bars for backtesting",
        )

    env = CryptoTradingEnv(df, window_size=req.window_size)

    # Pick agent
    agent = None
    if req.agent_type == "ensemble" and _state["ensemble"] is not None:
        agent = _state["ensemble"]
    elif req.agent_type == "ppo" and _state["ppo_agent"] is not None:
        agent = _state["ppo_agent"]
    elif req.agent_type == "sac" and _state["sac_agent"] is not None:
        agent = _state["sac_agent"]

    if agent is None:
        raise HTTPException(status_code=503, detail=f"Agent '{req.agent_type}' is not loaded")

    from .training.pipeline import evaluate

    metrics = evaluate(agent, df, window_size=req.window_size, n_episodes=req.n_episodes)

    return BacktestResponse(
        total_reward=metrics.total_reward,
        total_return_pct=metrics.total_return_pct,
        sharpe_ratio=metrics.sharpe_ratio,
        max_drawdown=metrics.max_drawdown,
        n_trades=metrics.n_trades,
        win_rate=metrics.win_rate,
    )
