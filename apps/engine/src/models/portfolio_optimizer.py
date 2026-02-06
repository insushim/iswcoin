from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from scipy import optimize


@dataclass
class EfficientFrontierPoint:
    """A single point on the efficient frontier."""

    risk: float          # portfolio standard deviation
    ret: float           # expected portfolio return
    weights: np.ndarray  # asset weights


class PortfolioOptimizer:
    """Classical portfolio optimisation and risk analytics.

    All ``returns`` parameters should be *daily* (or the same frequency)
    2-D arrays of shape ``(n_observations, n_assets)``.
    """

    # ------------------------------------------------------------------
    # Mean-variance
    # ------------------------------------------------------------------

    @staticmethod
    def mean_variance_optimize(
        returns: np.ndarray,
        risk_aversion: float = 1.0,
        allow_short: bool = False,
    ) -> np.ndarray:
        """Find the portfolio that maximises ``E[r] - (risk_aversion/2) * Var[r]``.

        Parameters
        ----------
        returns : np.ndarray
            Shape ``(T, n_assets)`` of historical asset returns.
        risk_aversion : float
            Higher values penalise variance more.
        allow_short : bool
            If False, weights are constrained to [0, 1].

        Returns
        -------
        np.ndarray
            Optimal weight vector of shape ``(n_assets,)``.
        """
        returns = np.asarray(returns, dtype=np.float64)
        n_assets = returns.shape[1]
        mu = returns.mean(axis=0)
        cov = np.cov(returns, rowvar=False)

        def neg_utility(w: np.ndarray) -> float:
            port_ret = w @ mu
            port_var = w @ cov @ w
            return -(port_ret - 0.5 * risk_aversion * port_var)

        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        bounds = None if allow_short else [(0.0, 1.0)] * n_assets
        x0 = np.ones(n_assets) / n_assets

        result = optimize.minimize(
            neg_utility,
            x0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000, "ftol": 1e-12},
        )
        return result.x

    # ------------------------------------------------------------------
    # Efficient frontier
    # ------------------------------------------------------------------

    @staticmethod
    def efficient_frontier(
        returns: np.ndarray,
        n_points: int = 50,
        allow_short: bool = False,
    ) -> List[EfficientFrontierPoint]:
        """Trace out the efficient frontier.

        Returns *n_points* ``EfficientFrontierPoint`` instances sorted by
        increasing risk.
        """
        returns = np.asarray(returns, dtype=np.float64)
        n_assets = returns.shape[1]
        mu = returns.mean(axis=0)
        cov = np.cov(returns, rowvar=False)

        def portfolio_volatility(w: np.ndarray) -> float:
            return float(np.sqrt(w @ cov @ w))

        target_returns = np.linspace(mu.min(), mu.max(), n_points)
        frontier: List[EfficientFrontierPoint] = []

        for target_ret in target_returns:
            constraints = [
                {"type": "eq", "fun": lambda w: np.sum(w) - 1.0},
                {"type": "eq", "fun": lambda w, tr=target_ret: w @ mu - tr},
            ]
            bounds = None if allow_short else [(0.0, 1.0)] * n_assets
            x0 = np.ones(n_assets) / n_assets

            result = optimize.minimize(
                portfolio_volatility,
                x0,
                method="SLSQP",
                bounds=bounds,
                constraints=constraints,
                options={"maxiter": 1000, "ftol": 1e-12},
            )
            if result.success:
                vol = portfolio_volatility(result.x)
                frontier.append(EfficientFrontierPoint(risk=vol, ret=float(target_ret), weights=result.x))

        frontier.sort(key=lambda p: p.risk)
        return frontier

    # ------------------------------------------------------------------
    # Value at Risk
    # ------------------------------------------------------------------

    @staticmethod
    def monte_carlo_var(
        returns: np.ndarray,
        confidence: float = 0.95,
        horizon: int = 1,
        n_sim: int = 10_000,
    ) -> float:
        """Monte-Carlo Value-at-Risk for an equal-weight portfolio.

        Parameters
        ----------
        returns : np.ndarray
            ``(T, n_assets)`` historical returns.
        confidence : float
            Confidence level (e.g. 0.95 for 95 %).
        horizon : int
            Forecast horizon in the same periodicity as ``returns``.
        n_sim : int
            Number of Monte Carlo simulations.

        Returns
        -------
        float
            The portfolio loss (positive number) at the given confidence level.
        """
        returns = np.asarray(returns, dtype=np.float64)
        n_assets = returns.shape[1]
        mu = returns.mean(axis=0)
        cov = np.cov(returns, rowvar=False)
        weights = np.ones(n_assets) / n_assets

        rng = np.random.default_rng(seed=42)
        simulated = rng.multivariate_normal(mu * horizon, cov * horizon, size=n_sim)
        portfolio_returns = simulated @ weights
        var = -float(np.percentile(portfolio_returns, (1.0 - confidence) * 100))
        return max(var, 0.0)

    # ------------------------------------------------------------------
    # CVaR (Expected Shortfall)
    # ------------------------------------------------------------------

    @staticmethod
    def cvar(
        returns: np.ndarray,
        confidence: float = 0.95,
        weights: Optional[np.ndarray] = None,
    ) -> float:
        """Historical Conditional VaR (Expected Shortfall).

        Parameters
        ----------
        returns : np.ndarray
            ``(T, n_assets)``.
        confidence : float
            Confidence level.
        weights : np.ndarray | None
            Portfolio weights; defaults to equal weight.

        Returns
        -------
        float
            Expected loss beyond the VaR threshold (positive number).
        """
        returns = np.asarray(returns, dtype=np.float64)
        n_assets = returns.shape[1]
        if weights is None:
            weights = np.ones(n_assets) / n_assets

        port_returns = returns @ weights
        cutoff = np.percentile(port_returns, (1.0 - confidence) * 100)
        tail = port_returns[port_returns <= cutoff]
        if len(tail) == 0:
            return 0.0
        return -float(tail.mean())

    # ------------------------------------------------------------------
    # GARCH volatility forecast
    # ------------------------------------------------------------------

    @staticmethod
    def garch_forecast(
        returns: np.ndarray,
        horizon: int = 5,
        p: int = 1,
        q: int = 1,
    ) -> np.ndarray:
        """Forecast volatility using a GARCH(p,q) model.

        If ``returns`` is 2-D the forecast is run on the first column (or an
        equal-weight portfolio).  Returns an array of length ``horizon`` with
        predicted standard deviations.
        """
        from arch import arch_model

        returns = np.asarray(returns, dtype=np.float64)
        if returns.ndim == 2:
            n_assets = returns.shape[1]
            weights = np.ones(n_assets) / n_assets
            series = returns @ weights
        else:
            series = returns.flatten()

        # arch library expects returns scaled (e.g. * 100)
        scaled = series * 100.0

        model = arch_model(scaled, vol="Garch", p=p, q=q, dist="Normal", rescale=False)
        result = model.fit(disp="off", show_warning=False)
        forecasts = result.forecast(horizon=horizon, reindex=False)

        # forecasts.variance is a DataFrame; take the last row
        variance_forecast = forecasts.variance.iloc[-1].values
        # Convert back from percentage scale
        std_forecast = np.sqrt(variance_forecast) / 100.0
        return std_forecast
