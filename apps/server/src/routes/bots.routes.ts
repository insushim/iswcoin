import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';
import { botRunnerService } from '../services/bot-runner.service.js';

const router = Router();

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  symbol: z.string().min(1),
  exchange: z.enum(['BINANCE', 'UPBIT', 'BYBIT', 'BITHUMB']),
  strategy: z.enum(['DCA', 'GRID', 'MARTINGALE', 'TRAILING', 'MOMENTUM', 'MEAN_REVERSION', 'RL_AGENT', 'STAT_ARB', 'SCALPING', 'FUNDING_ARB', 'ENSEMBLE']),
  mode: z.enum(['PAPER', 'REAL']).default('PAPER'),
  config: z.record(z.unknown()).optional(),
  riskConfig: z.record(z.number()).optional(),
});

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.number()).optional(),
  riskConfig: z.record(z.number()).optional(),
  mode: z.enum(['PAPER', 'REAL']).optional(),
});

router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const bots = await prisma.bot.findMany({
      where: { userId },
      include: {
        _count: {
          select: { trades: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ bots });
  } catch (err) {
    logger.error('Failed to fetch bots', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const botId = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId },
      include: {
        trades: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: {
          select: { trades: true },
        },
      },
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({ bot });
  } catch (err) {
    logger.error('Failed to fetch bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch bot' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const validation = createBotSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }

    const { name, symbol, exchange, strategy, mode, config: strategyConfig, riskConfig } = validation.data;

    const defaultConfig = getStrategy(strategy as StrategyType).getDefaultConfig();
    const mergedConfig = { ...defaultConfig, ...strategyConfig };

    const bot = await prisma.bot.create({
      data: {
        userId,
        name,
        symbol,
        exchange,
        strategy,
        mode,
        config: mergedConfig as Prisma.InputJsonValue,
        riskConfig: (riskConfig ?? {}) as Prisma.InputJsonValue,
      },
    });

    await prisma.botLog.create({
      data: {
        botId: bot.id,
        level: 'INFO',
        message: `Bot created: ${name} (${strategy} on ${exchange})`,
        data: { symbol, mode },
      },
    });

    logger.info('Bot created', { botId: bot.id, name, strategy });

    const warning = bot.strategy === 'RL_AGENT'
      ? '⚠️ RL_AGENT 전략은 현재 Momentum 대체 모드로 실행됩니다. 완전한 RL 학습에는 Python 엔진이 필요합니다.'
      : undefined;

    res.status(201).json({ bot, ...(warning ? { warning } : {}) });
  } catch (err) {
    logger.error('Failed to create bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to create bot' });
  }
});

router.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const botId = req.params['id'];
    const validation = updateBotSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }

    const existingBot = await prisma.bot.findFirst({
      where: { id: botId, userId },
    });

    if (!existingBot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (existingBot.status === 'RUNNING') {
      res.status(400).json({ error: 'Cannot update a running bot. Stop it first.' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (validation.data.name) updateData['name'] = validation.data.name;
    if (validation.data.mode) updateData['mode'] = validation.data.mode;
    if (validation.data.config) {
      const currentConfig = (existingBot.config as Record<string, number>) ?? {};
      updateData['config'] = { ...currentConfig, ...validation.data.config };
    }
    if (validation.data.riskConfig) {
      const currentRiskConfig = (existingBot.riskConfig as Record<string, number>) ?? {};
      updateData['riskConfig'] = { ...currentRiskConfig, ...validation.data.riskConfig };
    }

    const bot = await prisma.bot.update({
      where: { id: botId },
      data: updateData,
    });

    res.json({ bot });
  } catch (err) {
    logger.error('Failed to update bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to update bot' });
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const botId = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId },
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (bot.status === 'RUNNING') {
      await botRunnerService.stopBotLoop(botId);
    }

    await prisma.bot.delete({ where: { id: botId } });

    logger.info('Bot deleted', { botId });
    res.json({ message: 'Bot deleted successfully' });
  } catch (err) {
    logger.error('Failed to delete bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to delete bot' });
  }
});

router.post('/:id/start', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const botId = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId },
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (bot.status === 'RUNNING') {
      res.status(400).json({ error: 'Bot is already running' });
      return;
    }

    // 이중 시작 방지: 메모리 내 활성 봇 체크
    if (botRunnerService.getActiveBotCount() > 0 && botRunnerService.getBotPosition(botId, bot.symbol) !== null) {
      res.status(400).json({ error: 'Bot loop is already active in memory' });
      return;
    }

    if (bot.mode === 'REAL') {
      const apiKey = await prisma.apiKey.findFirst({
        where: { userId, exchange: bot.exchange, isActive: true },
      });

      if (!apiKey) {
        res.status(400).json({
          error: `No active API key found for ${bot.exchange}. Add one first.`,
        });
        return;
      }
    }

    await prisma.bot.update({
      where: { id: botId },
      data: { status: 'RUNNING' },
    });

    botRunnerService.startBotLoop(botId, bot.strategy as StrategyType, bot.symbol, bot.exchange, bot.mode, bot.config as Record<string, number>, userId);

    await prisma.botLog.create({
      data: {
        botId,
        level: 'INFO',
        message: `Bot started: ${bot.name} (${bot.mode} mode)`,
      },
    });

    const warning = bot.strategy === 'RL_AGENT'
      ? '⚠️ RL_AGENT 전략은 현재 Momentum 대체 모드로 실행됩니다. 완전한 RL 학습에는 Python 엔진이 필요합니다.'
      : undefined;

    logger.info('Bot started', { botId, strategy: bot.strategy, mode: bot.mode });
    res.json({ message: 'Bot started', status: 'RUNNING', ...(warning ? { warning } : {}) });
  } catch (err) {
    logger.error('Failed to start bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to start bot' });
  }
});

router.post('/:id/stop', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const botId = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId },
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (bot.status !== 'RUNNING') {
      res.status(400).json({ error: 'Bot is not running' });
      return;
    }

    await botRunnerService.stopBotLoop(botId);

    await prisma.bot.update({
      where: { id: botId },
      data: { status: 'STOPPED' },
    });

    await prisma.botLog.create({
      data: {
        botId,
        level: 'INFO',
        message: `Bot stopped: ${bot.name}`,
      },
    });

    logger.info('Bot stopped', { botId });
    res.json({ message: 'Bot stopped', status: 'STOPPED' });
  } catch (err) {
    logger.error('Failed to stop bot', { error: String(err) });
    res.status(500).json({ error: 'Failed to stop bot' });
  }
});

// ─── Performance & Trades ───────────────────────────────

router.get('/:id/performance', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id, userId },
    });
    if (!bot) {
      res.status(404).json({ error: '봇을 찾을 수 없습니다' });
      return;
    }

    const trades = await prisma.trade.findMany({
      where: { botId: id },
      orderBy: { timestamp: 'asc' },
    });

    const totalTrades = trades.length;
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
    const losses = trades.filter((t) => (t.pnl ?? 0) < 0).length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalFees = trades.reduce((sum, t) => sum + (t.fee ?? 0), 0);
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    // Max drawdown calculation
    let peak = 0;
    let maxDrawdown = 0;
    let cumPnl = 0;
    for (const t of trades) {
      cumPnl += t.pnl ?? 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    res.json({
      totalTrades,
      wins,
      losses,
      totalPnl,
      totalFees,
      winRate,
      maxDrawdown,
      netPnl: totalPnl - totalFees,
    });
  } catch (err) {
    logger.error('Failed to fetch bot performance', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch bot performance' });
  }
});

router.get('/:id/trades', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = req.params['id'];
    const page = parseInt(req.query['page'] as string) || 1;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100);

    const bot = await prisma.bot.findFirst({
      where: { id, userId },
    });
    if (!bot) {
      res.status(404).json({ error: '봇을 찾을 수 없습니다' });
      return;
    }

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where: { botId: id },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trade.count({ where: { botId: id } }),
    ]);

    res.json({ trades, total, page, limit });
  } catch (err) {
    logger.error('Failed to fetch bot trades', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch bot trades' });
  }
});

// ─── Paper Trading API ──────────────────────────────────

router.get('/:id/paper/summary', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id, userId },
    });
    if (!bot) {
      res.status(404).json({ error: '봇을 찾을 수 없습니다' });
      return;
    }
    if (bot.mode !== 'PAPER') {
      res.status(400).json({ error: 'PAPER 모드 봇만 조회 가능합니다' });
      return;
    }

    const summary = botRunnerService.getPaperTradeSummary(id);
    res.json({ summary });
  } catch (err) {
    logger.error('Failed to fetch paper summary', { error: String(err) });
    res.status(500).json({ error: '모의 투자 요약 조회 실패' });
  }
});

router.get('/:id/paper/logs', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = req.params['id'];
    const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
    const offset = parseInt(req.query['offset'] as string) || 0;

    const bot = await prisma.bot.findFirst({
      where: { id, userId },
    });
    if (!bot) {
      res.status(404).json({ error: '봇을 찾을 수 없습니다' });
      return;
    }

    const allLogs = botRunnerService.getPaperTradeLogs(id);
    // 최신순 정렬 후 페이지네이션
    const sorted = [...allLogs].reverse();
    const logs = sorted.slice(offset, offset + limit);

    res.json({ logs, total: allLogs.length });
  } catch (err) {
    logger.error('Failed to fetch paper logs', { error: String(err) });
    res.status(500).json({ error: '모의 투자 로그 조회 실패' });
  }
});

router.get('/:id/paper/stats', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const id = req.params['id'];

    const bot = await prisma.bot.findFirst({
      where: { id, userId },
    });
    if (!bot) {
      res.status(404).json({ error: '봇을 찾을 수 없습니다' });
      return;
    }

    const stats = botRunnerService.getPaperTradeStats(id);
    res.json({ stats });
  } catch (err) {
    logger.error('Failed to fetch paper stats', { error: String(err) });
    res.status(500).json({ error: '모의 투자 통계 조회 실패' });
  }
});

export default router;
