import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { getDateRanges } from '../utils/date.js';

const router = Router();

router.use(authMiddleware);

router.get('/summary', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    const bots = await prisma.bot.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        symbol: true,
        exchange: true,
        strategy: true,
        status: true,
        mode: true,
      },
    });

    const botIds = bots.map((b) => b.id);

    const { startOfDay, startOfWeek, startOfMonth } = getDateRanges();

    // DB 집계로 최적화 (전체 trades를 메모리에 로드하지 않음)
    const [dailyAgg, weeklyAgg, monthlyAgg, totalAgg] = await Promise.all([
      prisma.trade.aggregate({
        where: { botId: { in: botIds }, timestamp: { gte: startOfDay } },
        _sum: { pnl: true, fee: true },
        _count: true,
      }),
      prisma.trade.aggregate({
        where: { botId: { in: botIds }, timestamp: { gte: startOfWeek } },
        _sum: { pnl: true },
      }),
      prisma.trade.aggregate({
        where: { botId: { in: botIds }, timestamp: { gte: startOfMonth } },
        _sum: { pnl: true },
      }),
      prisma.trade.aggregate({
        where: { botId: { in: botIds } },
        _sum: { pnl: true, fee: true },
        _count: true,
      }),
    ]);

    const dailyPnL = dailyAgg._sum.pnl ?? 0;
    const weeklyPnL = weeklyAgg._sum.pnl ?? 0;
    const monthlyPnL = monthlyAgg._sum.pnl ?? 0;
    const totalPnL = totalAgg._sum.pnl ?? 0;
    const totalFees = totalAgg._sum.fee ?? 0;

    const activeBots = bots.filter((b) => b.status === 'RUNNING').length;

    res.json({
      portfolio: portfolio ?? { totalValue: 0, dailyPnL: 0, positions: [] },
      pnl: {
        daily: Math.round(dailyPnL * 100) / 100,
        weekly: Math.round(weeklyPnL * 100) / 100,
        monthly: Math.round(monthlyPnL * 100) / 100,
        total: Math.round(totalPnL * 100) / 100,
      },
      totalFees: Math.round(totalFees * 100) / 100,
      totalTrades: totalAgg._count,
      activeBots,
      totalBots: bots.length,
      bots,
    });
  } catch (err) {
    logger.error('Failed to fetch portfolio summary', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch portfolio summary' });
  }
});

router.get('/history', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const days = Math.min(Math.max(parseInt(String(req.query['days'] ?? '30'), 10) || 30, 1), 365);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const bots = await prisma.bot.findMany({
      where: { userId },
      select: { id: true },
    });
    const botIds = bots.map((b) => b.id);

    const trades = await prisma.trade.findMany({
      where: {
        botId: { in: botIds },
        timestamp: { gte: since },
      },
      select: { timestamp: true, pnl: true, price: true, amount: true },
      orderBy: { timestamp: 'asc' },
    });

    const dailyMap = new Map<string, { pnl: number; trades: number; volume: number }>();

    for (const trade of trades) {
      const dateKey = trade.timestamp.toISOString().split('T')[0]!;
      const existing = dailyMap.get(dateKey) ?? { pnl: 0, trades: 0, volume: 0 };
      existing.pnl += trade.pnl ?? 0;
      existing.trades += 1;
      existing.volume += trade.price * trade.amount;
      dailyMap.set(dateKey, existing);
    }

    const history = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        pnl: Math.round(data.pnl * 100) / 100,
        trades: data.trades,
        volume: Math.round(data.volume * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    let cumulativePnL = 0;
    const equityCurve = history.map((entry) => {
      cumulativePnL += entry.pnl;
      return {
        ...entry,
        cumulativePnL: Math.round(cumulativePnL * 100) / 100,
      };
    });

    res.json({
      history: equityCurve,
      period: { from: since.toISOString(), to: new Date().toISOString(), days },
    });
  } catch (err) {
    logger.error('Failed to fetch portfolio history', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch portfolio history' });
  }
});

router.get('/positions', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      positions: (portfolio?.positions as Record<string, unknown>[]) ?? [],
      totalValue: portfolio?.totalValue ?? 0,
      updatedAt: portfolio?.updatedAt ?? null,
    });
  } catch (err) {
    logger.error('Failed to fetch positions', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

export default router;
