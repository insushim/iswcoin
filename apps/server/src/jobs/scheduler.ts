import cron from 'node-cron';
import ccxt, { type Exchange } from 'ccxt';
import { prisma } from '../db.js';
import { logger } from '../utils/logger.js';
import { riskManager } from '../services/risk.service.js';
import { notificationService } from '../services/notification.service.js';
import { emitTickerUpdate, emitBotStatus } from '../websocket/index.js';
import { botRunnerService } from '../services/bot-runner.service.js';
import { getDateRanges } from '../utils/date.js';

const DURATIONS = {
  ONE_WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  SIX_HOURS_MS: 6 * 60 * 60 * 1000,
} as const;

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

      const symbols = [...new Set(runningBots.map((b) => b.symbol))];
      const exchange = getPublicExchange();

      // 병렬 ticker 업데이트 (순차 → 병렬로 성능 개선)
      await Promise.allSettled(symbols.map(async (symbol) => {
        try {
          const ticker = await exchange.fetchTicker(symbol);

          emitTickerUpdate(symbol, {
            symbol,
            price: ticker.last ?? 0,
            change24h: ticker.percentage ?? 0,
            volume: ticker.baseVolume ?? 0,
            timestamp: Date.now(),
          });

          const botsForSymbol = runningBots.filter((b) => b.symbol === symbol);
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
      }));
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

          // 봇 루프 실제로 중지 + DB 상태 업데이트
          botRunnerService.stopBotLoop(bot.id);
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

      // N+1 해결: include로 bots를 한 번에 조회
      const users = await prisma.user.findMany({
        select: {
          id: true,
          bots: { select: { id: true } },
        },
      });

      const { startOfDay } = getDateRanges();

      // 모든 봇 ID를 한 번에 모아서 오늘 거래를 일괄 조회
      const allBotIds = users.flatMap((u) => u.bots.map((b) => b.id));

      const todayTrades = allBotIds.length > 0
        ? await prisma.trade.findMany({
            where: {
              botId: { in: allBotIds },
              timestamp: { gte: startOfDay },
            },
            select: { botId: true, pnl: true },
          })
        : [];

      // botId별 PnL 맵 구축
      const pnlByBot = new Map<string, number>();
      for (const t of todayTrades) {
        pnlByBot.set(t.botId, (pnlByBot.get(t.botId) ?? 0) + (t.pnl ?? 0));
      }

      // 모든 유저의 포트폴리오를 한 번에 조회
      const portfolios = await prisma.portfolio.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        orderBy: { updatedAt: 'desc' },
        distinct: ['userId'],
      });

      const portfolioByUser = new Map(portfolios.map((p) => [p.userId, p]));

      for (const user of users) {
        const userBotIds = user.bots.map((b) => b.id);
        const dailyPnL = userBotIds.reduce((sum, botId) => sum + (pnlByBot.get(botId) ?? 0), 0);

        const existingPortfolio = portfolioByUser.get(user.id);
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

      // N+1 해결: include로 bots를 한 번에 조회
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          bots: { select: { id: true, name: true, strategy: true } },
        },
      });

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - DURATIONS.ONE_WEEK_MS);

      // 봇이 있는 유저만 필터
      const usersWithBots = users.filter((u) => u.bots.length > 0);
      const allBotIds = usersWithBots.flatMap((u) => u.bots.map((b) => b.id));

      // 주간 거래를 한 번에 조회
      const weeklyTrades = allBotIds.length > 0
        ? await prisma.trade.findMany({
            where: {
              botId: { in: allBotIds },
              timestamp: { gte: oneWeekAgo },
            },
            select: { botId: true, pnl: true },
          })
        : [];

      // botId별 거래 그룹핑
      const tradesByBot = new Map<string, { pnl: number | null }[]>();
      for (const t of weeklyTrades) {
        const existing = tradesByBot.get(t.botId) ?? [];
        existing.push(t);
        tradesByBot.set(t.botId, existing);
      }

      for (const user of usersWithBots) {
        const userBotIds = user.bots.map((b) => b.id);
        const userTrades = userBotIds.flatMap((id) => tradesByBot.get(id) ?? []);

        const totalPnL = userTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
        const winningTrades = userTrades.filter((t) => (t.pnl ?? 0) > 0);
        const winRate = userTrades.length > 0
          ? (winningTrades.length / userTrades.length) * 100
          : 0;

        const report = [
          `주간 성과 리포트`,
          `기간: ${oneWeekAgo.toISOString().split('T')[0]} ~ ${now.toISOString().split('T')[0]}`,
          `총 거래: ${userTrades.length}건`,
          `총 PnL: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} USDT`,
          `승률: ${winRate.toFixed(1)}%`,
          `활성 봇: ${user.bots.length}개`,
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
      const sixHoursAgo = new Date(Date.now() - DURATIONS.SIX_HOURS_MS);

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
