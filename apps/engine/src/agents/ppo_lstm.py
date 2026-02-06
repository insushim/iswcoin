from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Type

import gymnasium as gym
import numpy as np
import torch
import torch.nn as nn
from stable_baselines3 import PPO
from stable_baselines3.common.policies import ActorCriticPolicy
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class LSTMFeaturesExtractor(BaseFeaturesExtractor):
    """Custom feature extractor that runs an LSTM over the observation window.

    The observation is ``(window_size, num_features)``.  We treat ``window_size``
    as the sequence length and ``num_features`` as the input size, then return
    the final hidden state as the extracted feature vector.
    """

    def __init__(
        self,
        observation_space: gym.spaces.Box,
        lstm_hidden_size: int = 128,
        lstm_num_layers: int = 2,
        dropout: float = 0.1,
    ) -> None:
        # features_dim is what downstream policy networks receive
        super().__init__(observation_space, features_dim=lstm_hidden_size)

        obs_shape = observation_space.shape  # (window_size, num_features)
        assert obs_shape is not None and len(obs_shape) == 2
        input_size = int(obs_shape[1])

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=lstm_hidden_size,
            num_layers=lstm_num_layers,
            batch_first=True,
            dropout=dropout if lstm_num_layers > 1 else 0.0,
        )
        self.layer_norm = nn.LayerNorm(lstm_hidden_size)

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        # observations: (batch, window_size, num_features)
        lstm_out, (h_n, _) = self.lstm(observations)
        # Use the last hidden state of the top layer
        features = h_n[-1]  # (batch, hidden_size)
        features = self.layer_norm(features)
        return features


class LSTMActorCriticPolicy(ActorCriticPolicy):
    """PPO policy that uses the LSTM feature extractor."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["features_extractor_class"] = LSTMFeaturesExtractor
        kwargs.setdefault("features_extractor_kwargs", {})
        kwargs["features_extractor_kwargs"].setdefault("lstm_hidden_size", 128)
        kwargs["features_extractor_kwargs"].setdefault("lstm_num_layers", 2)
        super().__init__(*args, **kwargs)


class PPOLSTMAgent:
    """Wrapper around a PPO agent with an LSTM-based policy."""

    def __init__(
        self,
        env: gym.Env,
        learning_rate: float = 3e-4,
        n_steps: int = 2048,
        batch_size: int = 64,
        n_epochs: int = 10,
        gamma: float = 0.99,
        gae_lambda: float = 0.95,
        clip_range: float = 0.2,
        ent_coef: float = 0.01,
        lstm_hidden_size: int = 128,
        lstm_num_layers: int = 2,
        verbose: int = 1,
        device: str = "auto",
    ) -> None:
        self.env = env

        policy_kwargs: Dict[str, Any] = {
            "features_extractor_class": LSTMFeaturesExtractor,
            "features_extractor_kwargs": {
                "lstm_hidden_size": lstm_hidden_size,
                "lstm_num_layers": lstm_num_layers,
            },
            "net_arch": dict(pi=[64, 64], vf=[64, 64]),
        }

        self.model = PPO(
            policy=ActorCriticPolicy,
            env=env,
            learning_rate=learning_rate,
            n_steps=n_steps,
            batch_size=batch_size,
            n_epochs=n_epochs,
            gamma=gamma,
            gae_lambda=gae_lambda,
            clip_range=clip_range,
            ent_coef=ent_coef,
            policy_kwargs=policy_kwargs,
            verbose=verbose,
            device=device,
        )

    def train(self, total_timesteps: int = 100_000) -> None:
        """Train the PPO-LSTM agent."""
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
        self.model = PPO.load(path, env=self.env)

    @classmethod
    def from_pretrained(cls, path: str, env: gym.Env) -> "PPOLSTMAgent":
        """Create agent and load weights from *path*."""
        agent = cls.__new__(cls)
        agent.env = env
        agent.model = PPO.load(path, env=env)
        return agent
