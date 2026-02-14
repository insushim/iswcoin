import { Router, type Response } from 'express';
import { z } from 'zod';
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
  strategy: z.enum(['DCA', 'GRID', 'MARTINGALE', 'TRAILING', 'MOMENTUM', 'MEAN_REVERSION', 'RL_AGENT', 'STAT_ARB', 'SCALPING', 'FUNDING_ARB']),
  mode: z.enum(['PAPER', 'REAL']).default('PAPER'),
  config: z.record(z.number()).optional(),
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
        config: mergedConfig,
        riskConfig: riskConfig ?? {},
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

    res.status(201).json({ bot });
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
      botRunnerService.stopBotLoop(botId);
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

    logger.info('Bot started', { botId, strategy: bot.strategy, mode: bot.mode });
    res.json({ message: 'Bot started', status: 'RUNNING' });
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

    botRunnerService.stopBotLoop(botId);

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

export default router;
