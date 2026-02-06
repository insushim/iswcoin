from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class EngineSettings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    REDIS_URL: str = Field(default="redis://localhost:6379/0", description="Redis connection URL")
    DATABASE_URL: str = Field(default="postgresql://localhost:5432/iswcoin", description="Database connection URL")
    ENGINE_PORT: int = Field(default=8000, description="Port for the FastAPI server")

    MODEL_DIR: str = Field(default="models", description="Directory to persist trained models")
    DATA_DIR: str = Field(default="data", description="Directory for training data CSV files")

    RETRAIN_STALENESS_DAYS: int = Field(default=7, description="Days before a model is considered stale")
    DEFAULT_WINDOW_SIZE: int = Field(default=60, description="Default lookback window for observations")
    DEFAULT_INITIAL_BALANCE: float = Field(default=100_000.0, description="Default starting cash for backtests")

    class Config:
        env_file = str(_ENV_FILE) if _ENV_FILE.exists() else None
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = EngineSettings()


def ensure_dirs() -> None:
    """Create required directories if they do not exist."""
    for d in (settings.MODEL_DIR, settings.DATA_DIR):
        os.makedirs(d, exist_ok=True)


ensure_dirs()
