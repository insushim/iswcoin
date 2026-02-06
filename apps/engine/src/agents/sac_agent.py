from __future__ import annotations

import os
from typing import Any, Dict, Optional

import gymnasium as gym
import numpy as np
import torch.nn as nn
from stable_baselines3 import SAC
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor

from .ppo_lstm import LSTMFeaturesExtractor


class SACAgent:
    """Wrapper around a Soft Actor-Critic agent with optional LSTM feature extraction."""

    def __init__(
        self,
        env: gym.Env,
        learning_rate: float = 3e-4,
        buffer_size: int = 100_000,
        learning_starts: int = 1000,
        batch_size: int = 256,
        tau: float = 0.005,
        gamma: float = 0.99,
        ent_coef: str = "auto",
        target_entropy: str = "auto",
        use_lstm: bool = True,
        lstm_hidden_size: int = 128,
        lstm_num_layers: int = 2,
        verbose: int = 1,
        device: str = "auto",
    ) -> None:
        self.env = env

        policy_kwargs: Dict[str, Any] = {
            "net_arch": [256, 256],
        }

        if use_lstm:
            policy_kwargs["features_extractor_class"] = LSTMFeaturesExtractor
            policy_kwargs["features_extractor_kwargs"] = {
                "lstm_hidden_size": lstm_hidden_size,
                "lstm_num_layers": lstm_num_layers,
            }

        self.model = SAC(
            policy="MlpPolicy",
            env=env,
            learning_rate=learning_rate,
            buffer_size=buffer_size,
            learning_starts=learning_starts,
            batch_size=batch_size,
            tau=tau,
            gamma=gamma,
            ent_coef=ent_coef,
            target_entropy=target_entropy,
            policy_kwargs=policy_kwargs,
            verbose=verbose,
            device=device,
        )

    def train(self, total_timesteps: int = 100_000) -> None:
        """Train the SAC agent."""
        self.model.learn(total_timesteps=total_timesteps)

    def predict(self, obs: np.ndarray, deterministic: bool = True) -> np.ndarray:
        """Return an action for the given observation.

        Parameters
        ----------
        obs : np.ndarray
            Shape ``(window_size, num_features)`` or ``(1, window_size, num_features)``.
        deterministic : bool
            Whether to use the mean action (True) or sample (False).

        Returns
        -------
        np.ndarray
            Action array of shape ``(1,)``.
        """
        action, _ = self.model.predict(obs, deterministic=deterministic)
        return np.asarray(action).flatten()

    def save(self, path: str) -> None:
        """Persist model to disk."""
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        self.model.save(path)

    def load(self, path: str) -> None:
        """Load model from disk."""
        self.model = SAC.load(path, env=self.env)

    @classmethod
    def from_pretrained(cls, path: str, env: gym.Env) -> "SACAgent":
        """Create agent and load weights from *path*."""
        agent = cls.__new__(cls)
        agent.env = env
        agent.model = SAC.load(path, env=env)
        return agent
