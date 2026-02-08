import { Router, type Response } from 'express';
import { z } from 'zod';
import ccxt from 'ccxt';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { backtesterService, type BacktestConfig } from '../services/backtester.service.js';
import { indicatorsService } from '../services/indicators.service.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const runBacktestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().default('1h'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  initialCapital: z.number().min(100).default(10000),
  strategy: z.enum(['DCA', 'GRID', 'MOMENTUM', 'MEAN_REVERSION', 'TRAILING', 'MARTINGALE', 'RL_AGENT']),
  strategyConfig: z.record(z.number()).optional(),
  slippagePct: z.number().min(0).max(0.1).default(0.0005),
  feePct: z.number().min(0).max(0.1).default(0.001),
  walkForwardSplit: z.number().min(0.5).max(0.9).default(0.7),
  botId: z.string().optional(),
});

router.use(authMiddleware);

router.post('/run', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const validation = runBacktestSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const params = validation.data;

    logger.info('Starting backtest', { userId, symbol: params.symbol, strategy: params.strategy });

    const exchange = new ccxt.binance({ enableRateLimit: true });
    const since = params.startDate ? new Date(params.startDate).getTime() : undefined;
    const rawOhlcv = await exchange.fetchOHLCV(params.symbol, params.timeframe, since, 1000);

    if (rawOhlcv.length < 50) {
      res.status(400).json({ error: 'Insufficient data for backtest. Need at least 50 candles.' });
      return;
    }

    const ohlcvData = indicatorsService.parseOHLCV(
      rawOhlcv.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0])
    );

    const strategyType = params.strategy as StrategyType;
    const strategy = getStrategy(strategyType, params.strategyConfig);

    const config: BacktestConfig = {
      symbol: params.symbol,
      timeframe: params.timeframe,
      startDate: params.startDate ?? new Date(rawOhlcv[0]![0]!).toISOString(),
      endDate: params.endDate ?? new Date(rawOhlcv[rawOhlcv.length - 1]![0]!).toISOString(),
      initialCapital: params.initialCapital,
      strategy: params.strategy,
      strategyConfig: params.strategyConfig ?? strategy.getDefaultConfig(),
      slippagePct: params.slippagePct,
      feePct: params.feePct,
      walkForwardSplit: params.walkForwardSplit,
    };

    const result = await backtesterService.runBacktest(
      config,
      ohlcvData,
      (data, cfg) => strategy.analyze(data, cfg)
    );

    const saved = await prisma.backtestResult.create({
      data: {
        userId,
        botId: params.botId ?? null,
        config: config as any,
        result: {
          metrics: result.metrics,
          tradeCount: result.trades.length,
          trades: result.trades.slice(0, 100),
          equityCurveLength: result.equityCurve.length,
          equityCurveSampled: sampleArray(result.equityCurve, 200),
          drawdownCurveSampled: sampleArray(result.drawdownCurve, 200),
          inSampleMetrics: result.inSampleMetrics,
          outOfSampleMetrics: result.outOfSampleMetrics,
        } as any,
      },
    });

    res.json({
      id: saved.id,
      metrics: result.metrics,
      trades: result.trades.slice(0, 50),
      equityCurve: sampleArray(result.equityCurve, 200),
      drawdownCurve: sampleArray(result.drawdownCurve, 200),
      inSampleMetrics: result.inSampleMetrics,
      outOfSampleMetrics: result.outOfSampleMetrics,
    });
  } catch (err) {
    logger.error('Backtest failed', { error: String(err) });
    res.status(500).json({ error: 'Backtest failed', message: String(err) });
  }
});

router.get('/results', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const page = parseInt(String(req.query['page'] ?? '1'), 10);
    const limit = parseInt(String(req.query['limit'] ?? '20'), 10);

    const [results, total] = await Promise.all([
      prisma.backtestResult.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.backtestResult.count({ where: { userId } }),
    ]);

    res.json({
      results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error('Failed to fetch backtest results', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch backtest results' });
  }
});

router.get('/results/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const resultId = req.params['id'];

    const result = await prisma.backtestResult.findFirst({
      where: { id: resultId, userId },
    });

    if (!result) {
      res.status(404).json({ error: 'Backtest result not found' });
      return;
    }

    res.json({ result });
  } catch (err) {
    logger.error('Failed to fetch backtest result', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch backtest result' });
  }
});

function sampleArray<T>(arr: T[], maxSamples: number): T[] {
  if (arr.length <= maxSamples) return arr;
  const step = arr.length / maxSamples;
  const sampled: T[] = [];
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.min(Math.floor(i * step), arr.length - 1);
    sampled.push(arr[index]!);
  }
  if (sampled[sampled.length - 1] !== arr[arr.length - 1]) {
    sampled.push(arr[arr.length - 1]!);
  }
  return sampled;
}

export default router;
