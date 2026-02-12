import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

const tradesQuerySchema = z.object({
  botId: z.string().optional(),
  symbol: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const validation = tradesQuerySchema.safeParse(req.query);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: validation.error.errors });
      return;
    }

    const { botId, symbol, side, startDate, endDate, page, limit } = validation.data;

    const userBots = await prisma.bot.findMany({
      where: { userId },
      select: { id: true },
    });
    const userBotIds = userBots.map((b) => b.id);

    if (userBotIds.length === 0) {
      res.json({ trades: [], total: 0, page, limit });
      return;
    }

    const where: Record<string, unknown> = {
      botId: { in: botId ? [botId] : userBotIds },
    };

    if (symbol) {
      where['symbol'] = symbol;
    }

    if (side) {
      where['side'] = side;
    }

    if (startDate || endDate) {
      const timestampFilter: Record<string, Date> = {};
      if (startDate) timestampFilter['gte'] = new Date(startDate);
      if (endDate) timestampFilter['lte'] = new Date(endDate);
      where['timestamp'] = timestampFilter;
    }

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          bot: {
            select: { name: true, symbol: true, exchange: true },
          },
        },
      }),
      prisma.trade.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      trades,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    logger.error('Failed to fetch trades', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

router.get('/summary', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const userBots = await prisma.bot.findMany({
      where: { userId },
      select: { id: true },
    });
    const userBotIds = userBots.map((b) => b.id);

    if (userBotIds.length === 0) {
      res.json({
        totalTrades: 0,
        totalPnL: 0,
        winRate: 0,
        avgPnL: 0,
        bestTrade: null,
        worstTrade: null,
      });
      return;
    }

    // DB 집계로 최적화 (전체 trades를 메모리에 로드하지 않음)
    const [totalAgg, pnlAgg, winCount, bestTrade, worstTrade] = await Promise.all([
      prisma.trade.aggregate({
        where: { botId: { in: userBotIds } },
        _count: true,
      }),
      prisma.trade.aggregate({
        where: { botId: { in: userBotIds }, pnl: { not: null } },
        _sum: { pnl: true },
        _avg: { pnl: true },
        _count: true,
      }),
      prisma.trade.count({
        where: { botId: { in: userBotIds }, pnl: { gt: 0 } },
      }),
      prisma.trade.findFirst({
        where: { botId: { in: userBotIds }, pnl: { not: null } },
        orderBy: { pnl: 'desc' },
      }),
      prisma.trade.findFirst({
        where: { botId: { in: userBotIds }, pnl: { not: null } },
        orderBy: { pnl: 'asc' },
      }),
    ]);

    const totalPnL = pnlAgg._sum.pnl ?? 0;
    const avgPnL = pnlAgg._avg.pnl ?? 0;
    const winRate = pnlAgg._count > 0
      ? (winCount / pnlAgg._count) * 100
      : 0;

    res.json({
      totalTrades: totalAgg._count,
      totalPnL: Math.round(totalPnL * 100) / 100,
      winRate: Math.round(winRate * 100) / 100,
      avgPnL: Math.round(avgPnL * 100) / 100,
      bestTrade,
      worstTrade,
    });
  } catch (err) {
    logger.error('Failed to fetch trade summary', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch trade summary' });
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const tradeId = req.params['id'];

    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        bot: {
          select: { userId: true, name: true, symbol: true, exchange: true },
        },
      },
    });

    if (!trade || trade.bot.userId !== userId) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    res.json({ trade });
  } catch (err) {
    logger.error('Failed to fetch trade', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

export default router;
