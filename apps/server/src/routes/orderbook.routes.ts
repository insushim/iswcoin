import { Router, type Response } from 'express';
import ccxt, { type Exchange } from 'ccxt';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { orderBookAnalysisService } from '../services/orderbook.service.js';
import { exchangeService } from '../services/exchange.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

let publicExchange: Exchange | null = null;

function getPublicExchange(): Exchange {
  if (!publicExchange) {
    publicExchange = new ccxt.binance({ enableRateLimit: true });
  }
  return publicExchange;
}

router.use(authMiddleware);

router.get('/analysis/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');
    const limit = parseInt(String(req.query['limit'] ?? '50'), 10);
    const wallThreshold = parseFloat(String(req.query['wallThreshold'] ?? '3'));

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }

    const exchange = getPublicExchange();
    const orderbook = await exchangeService.getOrderBook(exchange, symbol, limit);

    const bids = orderbook.bids as [number, number][];
    const asks = orderbook.asks as [number, number][];

    const imbalance = orderBookAnalysisService.calculateImbalance(bids, asks);
    const walls = orderBookAnalysisService.detectWalls(bids, asks, wallThreshold);

    const spread = asks.length > 0 && bids.length > 0
      ? asks[0]![0] - bids[0]![0]
      : 0;
    const midPrice = asks.length > 0 && bids.length > 0
      ? (asks[0]![0] + bids[0]![0]) / 2
      : 0;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const bidDepth = bids.reduce((sum, [price, amount]) => sum + price * amount, 0);
    const askDepth = asks.reduce((sum, [price, amount]) => sum + price * amount, 0);

    res.json({
      symbol,
      imbalance,
      walls: walls.slice(0, 10),
      spread: Math.round(spread * 10000) / 10000,
      spreadPct: Math.round(spreadPct * 10000) / 10000,
      midPrice: Math.round(midPrice * 100) / 100,
      bidDepth: Math.round(bidDepth * 100) / 100,
      askDepth: Math.round(askDepth * 100) / 100,
      levels: limit,
      timestamp: orderbook.timestamp,
    });
  } catch (err) {
    logger.error('Failed to analyze orderbook', { error: String(err) });
    res.status(500).json({ error: 'Failed to analyze orderbook' });
  }
});

router.get('/imbalance/:symbol', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const symbol = decodeURIComponent(req.params['symbol'] ?? '');
    const limit = parseInt(String(req.query['limit'] ?? '20'), 10);

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }

    const exchange = getPublicExchange();
    const orderbook = await exchangeService.getOrderBook(exchange, symbol, limit);

    const bids = orderbook.bids as [number, number][];
    const asks = orderbook.asks as [number, number][];

    const imbalance = orderBookAnalysisService.calculateImbalance(bids, asks);

    const depthLevels = [5, 10, 20].map((depth) => {
      const depthBids = bids.slice(0, depth);
      const depthAsks = asks.slice(0, depth);
      return {
        depth,
        ...orderBookAnalysisService.calculateImbalance(depthBids, depthAsks),
      };
    });

    res.json({
      symbol,
      imbalance,
      depthLevels,
      timestamp: orderbook.timestamp,
    });
  } catch (err) {
    logger.error('Failed to fetch imbalance', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch imbalance' });
  }
});

export default router;
