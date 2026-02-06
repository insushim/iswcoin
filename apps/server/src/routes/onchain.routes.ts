import { Router, type Response } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { onchainAnalyticsService } from '../services/onchain.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(authMiddleware);

router.get('/flow', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const flow = await onchainAnalyticsService.getExchangeFlow();

    const totalInflow = flow.reduce((sum, f) => sum + f.inflow, 0);
    const totalOutflow = flow.reduce((sum, f) => sum + f.outflow, 0);
    const netFlow = totalInflow - totalOutflow;

    let interpretation: string;
    if (netFlow > 1000) {
      interpretation = 'Net inflow to exchanges detected - potential sell pressure';
    } else if (netFlow < -1000) {
      interpretation = 'Net outflow from exchanges detected - potential accumulation';
    } else {
      interpretation = 'Balanced exchange flows - neutral signal';
    }

    res.json({
      exchanges: flow,
      summary: {
        totalInflow: Math.round(totalInflow * 100) / 100,
        totalOutflow: Math.round(totalOutflow * 100) / 100,
        netFlow: Math.round(netFlow * 100) / 100,
        interpretation,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error('Failed to fetch exchange flow', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch exchange flow' });
  }
});

router.get('/mvrv', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const mvrv = await onchainAnalyticsService.getMVRV();

    let interpretation: string;
    switch (mvrv.zone) {
      case 'undervalued':
        interpretation = 'Market cap below realized cap - historically a good accumulation zone';
        break;
      case 'fair':
        interpretation = 'MVRV in fair value range - no extreme signal';
        break;
      case 'overvalued':
        interpretation = 'MVRV elevated - market may be overheated, consider taking profits';
        break;
      case 'extreme':
        interpretation = 'MVRV at extreme levels - high probability of correction';
        break;
    }

    res.json({
      ...mvrv,
      interpretation,
    });
  } catch (err) {
    logger.error('Failed to fetch MVRV', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch MVRV data' });
  }
});

router.get('/funding/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }

    const funding = await onchainAnalyticsService.getFundingRate(symbol);

    let interpretation: string;
    if (funding.fundingRate > 0.001) {
      interpretation = 'High positive funding - longs paying shorts, market may be overleveraged long';
    } else if (funding.fundingRate < -0.001) {
      interpretation = 'High negative funding - shorts paying longs, market may be overleveraged short';
    } else if (funding.fundingRate > 0) {
      interpretation = 'Slightly positive funding - mild long bias';
    } else if (funding.fundingRate < 0) {
      interpretation = 'Slightly negative funding - mild short bias';
    } else {
      interpretation = 'Neutral funding rate';
    }

    res.json({
      ...funding,
      interpretation,
    });
  } catch (err) {
    logger.error('Failed to fetch funding rate', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch funding rate' });
  }
});

router.get('/tvl', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tvl = await onchainAnalyticsService.getTVL();
    res.json(tvl);
  } catch (err) {
    logger.error('Failed to fetch TVL', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch TVL data' });
  }
});

router.get('/gas', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const gas = await onchainAnalyticsService.getGasPrice();
    res.json({
      ...gas,
      unit: 'gwei',
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error('Failed to fetch gas price', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch gas price' });
  }
});

export default router;
