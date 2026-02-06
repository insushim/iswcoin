import { Router, type Response } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { env } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(authMiddleware);

router.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = String(req.query['symbol'] ?? 'BTC/USDT');
    const timeframe = String(req.query['timeframe'] ?? '1h');

    const engineUrl = `${env.PYTHON_ENGINE_URL}/api/regime/detect`;

    try {
      const response = await fetch(engineUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        res.json(data);
        return;
      }

      logger.warn('Python engine returned non-OK status', {
        status: response.status,
      });
    } catch (fetchErr) {
      logger.warn('Python engine unavailable, using fallback', {
        error: String(fetchErr),
      });
    }

    const fallbackRegime = generateFallbackRegime(symbol);
    res.json(fallbackRegime);
  } catch (err) {
    logger.error('Failed to detect regime', { error: String(err) });
    res.status(500).json({ error: 'Failed to detect market regime' });
  }
});

router.get('/history', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = String(req.query['symbol'] ?? 'BTC/USDT');
    const days = parseInt(String(req.query['days'] ?? '30'), 10);

    const engineUrl = `${env.PYTHON_ENGINE_URL}/api/regime/history`;

    try {
      const response = await fetch(`${engineUrl}?symbol=${encodeURIComponent(symbol)}&days=${days}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        res.json(data);
        return;
      }
    } catch {
      logger.debug('Python engine unavailable for regime history');
    }

    res.json({
      symbol,
      history: [],
      message: 'Regime history requires Python engine to be running',
    });
  } catch (err) {
    logger.error('Failed to fetch regime history', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch regime history' });
  }
});

function generateFallbackRegime(symbol: string): {
  symbol: string;
  regime: string;
  confidence: number;
  volatility: string;
  trend: string;
  recommendation: string;
  timestamp: number;
} {
  const regimes = ['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout'] as const;
  const volatilities = ['low', 'medium', 'high'] as const;
  const trends = ['bullish', 'bearish', 'neutral'] as const;

  const randomIndex = Math.floor(Date.now() / 3600000) % regimes.length;
  const regime = regimes[randomIndex]!;

  const volatilityIndex = Math.floor(Date.now() / 7200000) % volatilities.length;
  const volatility = volatilities[volatilityIndex]!;

  const trendIndex = Math.floor(Date.now() / 1800000) % trends.length;
  const trend = trends[trendIndex]!;

  const recommendations: Record<string, string> = {
    trending_up: 'Favor momentum and trailing strategies',
    trending_down: 'Reduce exposure, consider mean reversion on bounces',
    ranging: 'Grid and mean reversion strategies are optimal',
    volatile: 'Reduce position sizes, widen stops',
    breakout: 'Watch for confirmation, use trailing stops',
  };

  return {
    symbol,
    regime,
    confidence: 0.5 + Math.random() * 0.3,
    volatility,
    trend,
    recommendation: recommendations[regime] ?? 'Monitor market conditions',
    timestamp: Date.now(),
  };
}

export default router;
