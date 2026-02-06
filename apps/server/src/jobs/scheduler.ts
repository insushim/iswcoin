import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import ccxt, { type Exchange } from 'ccxt';
import { logger } from '../utils/logger.js';
import { riskManager } from '../services/risk.service.js';
import { notificationService } from '../services/notification.service.js';
import { emitTickerUpdate, emitBotStatus } from '../websocket/index.js';

const prisma = new PrismaClient();

let publicExchange: Exchange | null = null;

function getPublicExchange(): Exchange {
  if (!publicExchange) {
    publicExchange = new ccxt.binance({ enableRateLimit: true });
  }
  return publicExchange;
}

export function startScheduler(): void {
  logger.info('Starting cron scheduler');

  cron.schedule('* * * * *', async () => {
    try {
      const runningBots = await prisma.bot.findMany({
        where: { status: 'RUNNING' },
        select: { id: true, symbol: true, userId: true },
      });

      if (runningBots.length === 0) return;

      const symbols = [...new Set(runningBots.map((b: any) => b.symbol))];
      const exchange = getPublicExchange();

      for (const symbol of symbols) {
        try {
          const ticker = await exchange.fetchTicker(symbol);

          emitTickerUpdate(symbol, {
            symbol,
            price: ticker.last ?? 0,
            change24h: ticker.percentage ?? 0,
            volume: ticker.baseVolume ?? 0,
            timestamp: Date.now(),
          });

          const botsForSymbol = runningBots.filter((b: any) => b.symbol === symbol);
          for (const bot of botsForSymbol) {
            emitBotStatus(bot.id, {
              botId: bot.id,
              status: 'RUNNING',
              lastSignal: null,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          logger.debug('Failed to update ticker', { symbol, error: String(err) });
        }
      }
    } catch (err) {
      logger.error('Ticker update job failed', { error: String(err) });
    }
  });

  cron.schedule('*/5 * * * *', async () => {
    try {
      const runningBots = await prisma.bot.findMany({
        where: { status: 'RUNNING' },
        select: { id: true, userId: true, name: true },
      });

      for (const bot of runningBots) {
        const riskCheck = await riskManager.checkRiskLimits(bot.id);

        if (!riskCheck.allowed) {
          logger.warn('Risk limit breached', { botId: bot.id, reason: riskCheck.reason });

          await prisma.bot.update({
            where: { id: bot.id },
            data: { status: 'STOPPED' },
          });

          await notificationService.sendRiskAlert(
            bot.userId,
            `Bot "${bot.name}" stopped: ${riskCheck.reason}`,
            riskCheck.currentDailyLoss,
            riskCheck.currentWeeklyLoss
          );

          await prisma.botLog.create({
            data: {
              botId: bot.id,
              level: 'WARN',
              message: `Bot stopped due to risk limit: ${riskCheck.reason}`,
              data: {
                dailyLoss: riskCheck.currentDailyLoss,
                weeklyLoss: riskCheck.currentWeeklyLoss,
              },
            },
          });

          emitBotStatus(bot.id, {
            botId: bot.id,
            status: 'STOPPED',
            lastSignal: `Risk limit: ${riskCheck.reason}`,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      logger.error('Risk check job failed', { error: String(err) });
    }
  });

  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Running daily portfolio snapshot job');

      const users = await prisma.user.findMany({
        select: { id: true },
      });

      for (const user of users) {
        const bots = await prisma.bot.findMany({
          where: { userId: user.id },
          select: { id: true },
        });

        const botIds = bots.map((b: any) => b.id);

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const todayTrades = await prisma.trade.findMany({
          where: {
            botId: { in: botIds },
            timestamp: { gte: startOfDay },
          },
        });

        const dailyPnL = todayTrades.reduce((sum: number, t: any) => sum + (t.pnl ?? 0), 0);

        const existingPortfolio = await prisma.portfolio.findFirst({
          where: { userId: user.id },
          orderBy: { updatedAt: 'desc' },
        });

        const currentValue = (existingPortfolio?.totalValue ?? 10000) + dailyPnL;

        await prisma.portfolio.upsert({
          where: { id: existingPortfolio?.id ?? 'new' },
          update: {
            totalValue: currentValue,
            dailyPnL,
          },
          create: {
            userId: user.id,
            totalValue: currentValue,
            dailyPnL,
            positions: [],
          },
        });

        logger.debug('Portfolio snapshot saved', {
          userId: user.id,
          totalValue: currentValue,
          dailyPnL,
        });
      }

      logger.info('Daily portfolio snapshot completed');
    } catch (err) {
      logger.error('Daily portfolio snapshot failed', { error: String(err) });
    }
  });

  cron.schedule('0 0 * * 1', async () => {
    try {
      logger.info('Running weekly performance report job');

      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true },
      });

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      for (const user of users) {
        const bots = await prisma.bot.findMany({
          where: { userId: user.id },
          select: { id: true, name: true, strategy: true },
        });

        if (bots.length === 0) continue;

        const botIds = bots.map((b: any) => b.id);

        const weeklyTrades = await prisma.trade.findMany({
          where: {
            botId: { in: botIds },
            timestamp: { gte: oneWeekAgo },
          },
        });

        const totalPnL = weeklyTrades.reduce((sum: number, t: any) => sum + (t.pnl ?? 0), 0);
        const winningTrades = weeklyTrades.filter((t: any) => (t.pnl ?? 0) > 0);
        const winRate = weeklyTrades.length > 0
          ? (winningTrades.length / weeklyTrades.length) * 100
          : 0;

        const report = [
          `Weekly Performance Report`,
          `Period: ${oneWeekAgo.toISOString().split('T')[0]} - ${now.toISOString().split('T')[0]}`,
          `Total Trades: ${weeklyTrades.length}`,
          `Total PnL: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} USDT`,
          `Win Rate: ${winRate.toFixed(1)}%`,
          `Active Bots: ${bots.length}`,
        ].join('\n');

        await notificationService.sendAlert(
          user.id,
          'SYSTEM',
          report,
          'LOW'
        );

        await notificationService.sendTelegram(report);

        logger.debug('Weekly report generated', { userId: user.id });
      }

      logger.info('Weekly performance reports completed');
    } catch (err) {
      logger.error('Weekly report job failed', { error: String(err) });
    }
  });

  cron.schedule('0 */6 * * *', async () => {
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

      const stuckBots = await prisma.bot.findMany({
        where: {
          status: 'RUNNING',
          updatedAt: { lt: sixHoursAgo },
        },
      });

      for (const bot of stuckBots) {
        logger.warn('Potentially stuck bot detected', {
          botId: bot.id,
          lastUpdated: bot.updatedAt,
        });

        await notificationService.sendAlert(
          bot.userId,
          'SYSTEM',
          `Bot "${bot.name}" may be stuck. Last activity: ${bot.updatedAt.toISOString()}`,
          'MEDIUM'
        );
      }
    } catch (err) {
      logger.error('Health check job failed', { error: String(err) });
    }
  });

  logger.info('All cron jobs scheduled successfully');
}
