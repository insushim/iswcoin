from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Protocol, Sequence

import numpy as np


class AgentProtocol(Protocol):
    """Minimal interface an agent must implement to participate in the ensemble."""

    def predict(self, obs: np.ndarray, deterministic: bool = True) -> np.ndarray: ...


@dataclass
class _AgentRecord:
    agent: AgentProtocol
    weight: float
    recent_rewards: List[float] = field(default_factory=list)


class EnsembleAgent:
    """Weighted ensemble of heterogeneous RL agents.

    The ensemble produces actions as the weighted average of its member agents'
    predictions.  Weights can be updated dynamically using an exponential-
    weighted-moving-average of each agent's recent reward signal.
    """

    def __init__(
        self,
        agents: Sequence[AgentProtocol],
        weights: Sequence[float] | None = None,
        ema_alpha: float = 0.3,
        reward_history_len: int = 50,
    ) -> None:
        n = len(agents)
        if n == 0:
            raise ValueError("At least one agent is required")

        if weights is None:
            weights = [1.0 / n] * n
        else:
            weights = list(weights)
            if len(weights) != n:
                raise ValueError(f"Expected {n} weights, got {len(weights)}")

        total = sum(weights)
        weights = [w / total for w in weights]

        self._records: List[_AgentRecord] = [
            _AgentRecord(agent=a, weight=w) for a, w in zip(agents, weights)
        ]
        self._ema_alpha = ema_alpha
        self._reward_history_len = reward_history_len

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, obs: np.ndarray, deterministic: bool = True) -> np.ndarray:
        """Return the weighted-average action across all agents."""
        actions: List[np.ndarray] = []
        for rec in self._records:
            act = rec.agent.predict(obs, deterministic=deterministic)
            actions.append(np.asarray(act, dtype=np.float64).flatten())

        weights = np.array([r.weight for r in self._records], dtype=np.float64)
        stacked = np.stack(actions, axis=0)  # (n_agents, action_dim)
        combined = np.average(stacked, axis=0, weights=weights)
        return combined.astype(np.float32)

    def update_weights(self, rewards: Sequence[float]) -> None:
        """Update agent weights based on per-agent rewards.

        Parameters
        ----------
        rewards : Sequence[float]
            One reward value per agent, representing each agent's most recent
            performance signal (e.g. episode return or step reward).
        """
        if len(rewards) != len(self._records):
            raise ValueError(
                f"Expected {len(self._records)} reward values, got {len(rewards)}"
            )

        for rec, r in zip(self._records, rewards):
            rec.recent_rewards.append(r)
            if len(rec.recent_rewards) > self._reward_history_len:
                rec.recent_rewards = rec.recent_rewards[-self._reward_history_len:]

        # Compute EMA score for each agent
        scores: List[float] = []
        for rec in self._records:
            if not rec.recent_rewards:
                scores.append(0.0)
                continue

            ema = rec.recent_rewards[0]
            for val in rec.recent_rewards[1:]:
                ema = self._ema_alpha * val + (1.0 - self._ema_alpha) * ema
            scores.append(ema)

        # Shift scores to be non-negative, then normalise
        min_score = min(scores)
        shifted = [s - min_score + 1e-8 for s in scores]
        total = sum(shifted)
        for rec, s in zip(self._records, shifted):
            rec.weight = s / total

    def get_weights(self) -> List[float]:
        """Return current agent weights."""
        return [r.weight for r in self._records]

    def set_weights(self, weights: Sequence[float]) -> None:
        """Manually override agent weights (will be normalised)."""
        if len(weights) != len(self._records):
            raise ValueError(f"Expected {len(self._records)} weights, got {len(weights)}")
        total = sum(weights)
        for rec, w in zip(self._records, weights):
            rec.weight = w / total

    @property
    def n_agents(self) -> int:
        return len(self._records)
