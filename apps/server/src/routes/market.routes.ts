import { Router, type Response } from 'express';
import ccxt, { type Exchange } from 'ccxt';
import { z } from 'zod';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { exchangeService } from '../services/exchange.service.js';
import { indicatorsService } from '../services/indicators.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

let publicExchange: Exchange | null = null;

function getPublicExchange(): Exchange {
  if (!publicExchange) {
    publicExchange = new ccxt.binance({
      enableRateLimit: true,
    });
  }
  return publicExchange;
}

const ohlcvQuerySchema = z.object({
  timeframe: z.string().default('1h'),
  limit: z.coerce.number().min(1).max(1000).default(100),
});

const indicatorsQuerySchema = z.object({
  timeframe: z.string().default('1h'),
  limit: z.coerce.number().min(50).max(1000).default(200),
});

router.use(authMiddleware);

router.get('/ticker/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }

    const exchange = getPublicExchange();
    const ticker = await exchangeService.getTicker(exchange, symbol);

    res.json({
      symbol: ticker.symbol,
      last: ticker.last,
      bid: ticker.bid,
      ask: ticker.ask,
      high: ticker.high,
      low: ticker.low,
      volume: ticker.baseVolume,
      quoteVolume: ticker.quoteVolume,
      change: ticker.change,
      percentage: ticker.percentage,
      timestamp: ticker.timestamp,
    });
  } catch (err) {
    logger.error('Failed to fetch ticker', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch ticker' });
  }
});

router.get('/ohlcv/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');
    const validation = ohlcvQuerySchema.safeParse(req.query);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: validation.error.errors });
      return;
    }

    const { timeframe, limit } = validation.data;
    const exchange = getPublicExchange();
    const ohlcv = await exchangeService.getOHLCV(exchange, symbol, timeframe, limit);

    const formatted = ohlcv.map((candle) => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));

    res.json({
      symbol,
      timeframe,
      data: formatted,
      count: formatted.length,
    });
  } catch (err) {
    logger.error('Failed to fetch OHLCV', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch OHLCV data' });
  }
});

router.get('/indicators/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');
    const validation = indicatorsQuerySchema.safeParse(req.query);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: validation.error.errors });
      return;
    }

    const { timeframe, limit } = validation.data;
    const exchange = getPublicExchange();
    const rawOhlcv = await exchangeService.getOHLCV(exchange, symbol, timeframe, limit);

    const ohlcvData = indicatorsService.parseOHLCV(
      rawOhlcv.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0])
    );

    const indicators = indicatorsService.getAllIndicators(ohlcvData);

    res.json({
      symbol,
      timeframe,
      indicators,
      dataPoints: ohlcvData.length,
    });
  } catch (err) {
    logger.error('Failed to fetch indicators', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

router.get('/orderbook/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');
    const limit = parseInt(String(req.query['limit'] ?? '20'), 10);

    const exchange = getPublicExchange();
    const orderbook = await exchangeService.getOrderBook(exchange, symbol, limit);

    res.json({
      symbol,
      bids: orderbook.bids,
      asks: orderbook.asks,
      timestamp: orderbook.timestamp,
      nonce: orderbook.nonce,
    });
  } catch (err) {
    logger.error('Failed to fetch orderbook', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch orderbook' });
  }
});

export default router;
