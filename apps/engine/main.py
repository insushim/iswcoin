"""Entry point for the ISWCoin ML/RL Trading Engine.

Usage
-----
    python apps/engine/main.py
    # or
    python -m apps.engine.main
"""
from __future__ import annotations

import uvicorn

from src.config import settings


def main() -> None:
    """Launch the FastAPI server via uvicorn."""
    uvicorn.run(
        "src.api:app",
        host="0.0.0.0",
        port=settings.ENGINE_PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
