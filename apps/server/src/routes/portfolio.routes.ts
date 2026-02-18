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

    // DB 집계 쿼리로 일별 데이터 생성 (메모리 최적화)
    const dailyAgg = botIds.length > 0
      ? await prisma.$queryRaw<Array<{ date: Date; pnl: number; trades: bigint; volume: number }>>`
          SELECT DATE("timestamp") as date,
                 COALESCE(SUM(pnl), 0) as pnl,
                 COUNT(*) as trades,
                 COALESCE(SUM(price * amount), 0) as volume
          FROM trades
          WHERE "botId" = ANY(${botIds}) AND "timestamp" >= ${since}
          GROUP BY DATE("timestamp")
          ORDER BY date ASC`
      : [];

    const history = (dailyAgg as Array<{ date: Date; pnl: number; trades: bigint; volume: number }>).map((row) => ({
      date: new Date(row.date).toISOString().split('T')[0]!,
      pnl: Math.round(Number(row.pnl) * 100) / 100,
      trades: Number(row.trades),
      volume: Math.round(Number(row.volume) * 100) / 100,
    }));

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
