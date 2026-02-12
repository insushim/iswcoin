import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../utils/logger.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';
import { exchangeService } from './exchange.service.js';
import { indicatorsService } from './indicators.service.js';
import { decrypt } from '../utils/encryption.js';

// 매직 넘버 상수화
const DEFAULT_ORDER_AMOUNT = 0.001;
const DEFAULT_FEE_RATE = 0.001;
const BOT_LOOP_INTERVAL_MS = 60_000;

class BotRunnerService {
  private readonly activeBots: Map<string, NodeJS.Timeout> = new Map();

  /**
   * 봇 트레이딩 루프 시작
   */
  async startBotLoop(
    botId: string,
    strategyType: StrategyType,
    symbol: string,
    exchangeEnum: string,
    mode: string,
    config: Record<string, number>,
    userId: string
  ): Promise<void> {
    const strategy = getStrategy(strategyType, config);
    const exchangeName = exchangeService.getExchangeNameFromEnum(exchangeEnum);

    if (mode === 'PAPER') {
      exchangeService.initPaperExchange(exchangeName, 10000);
    }

    // API 키를 시작 시 한 번만 조회하여 캐싱 (매 루프 DB 쿼리 방지)
    let cachedExchange: ReturnType<typeof exchangeService.initExchange> | null = null;

    if (mode === 'REAL') {
      const apiKeyRecord = await prisma.apiKey.findFirst({
        where: { userId, exchange: exchangeEnum as 'BINANCE' | 'UPBIT' | 'BYBIT' | 'BITHUMB', isActive: true },
      });
      if (apiKeyRecord) {
        cachedExchange = exchangeService.initExchange(
          exchangeName,
          decrypt(apiKeyRecord.apiKey),
          decrypt(apiKeyRecord.apiSecret)
        );
      }
    }

    const interval = setInterval(async () => {
      try {
        const exchange = cachedExchange;
        if (mode === 'REAL' && !exchange) {
          logger.warn('No API key found for running bot', { botId });
          return;
        }

        let ohlcvRaw: number[][] = [];
        if (exchange) {
          const data = await exchangeService.getOHLCV(exchange, symbol, '1h', 100);
          ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
        }

        if (ohlcvRaw.length === 0) {
          return;
        }

        const ohlcvData = indicatorsService.parseOHLCV(ohlcvRaw);
        const signal = strategy.analyze(ohlcvData, config);

        if (signal && signal.action !== 'hold') {
          logger.info('Trade signal generated', {
            botId,
            action: signal.action,
            reason: signal.reason,
            confidence: signal.confidence,
          });

          if (mode === 'PAPER') {
            const paper = exchangeService.getPaperExchange(exchangeName);
            if (paper) {
              const order = await paper.createOrder(symbol, signal.action, 'market', DEFAULT_ORDER_AMOUNT);
              await prisma.trade.create({
                data: {
                  botId,
                  symbol,
                  side: signal.action === 'buy' ? 'BUY' : 'SELL',
                  type: 'MARKET',
                  price: order.price,
                  amount: order.amount,
                  fee: order.price * order.amount * DEFAULT_FEE_RATE,
                },
              });
            }
          } else if (exchange) {
            const order = await exchangeService.createOrder(
              exchange,
              symbol,
              signal.action,
              'market',
              DEFAULT_ORDER_AMOUNT
            );
            await prisma.trade.create({
              data: {
                botId,
                symbol,
                side: signal.action === 'buy' ? 'BUY' : 'SELL',
                type: 'MARKET',
                price: order.average ?? order.price ?? signal.price,
                amount: order.filled ?? DEFAULT_ORDER_AMOUNT,
                fee: order.fee?.cost ?? 0,
              },
            });
          }

          await prisma.botLog.create({
            data: {
              botId,
              level: 'INFO',
              message: `Signal: ${signal.action} - ${signal.reason}`,
              data: (signal.metadata ?? {}) as Prisma.InputJsonValue,
            },
          });
        }
      } catch (err) {
        logger.error('Bot loop error', { botId, error: String(err) });
        await prisma.botLog.create({
          data: {
            botId,
            level: 'ERROR',
            message: `Bot error: ${String(err)}`,
          },
        }).catch(() => {});
      }
    }, BOT_LOOP_INTERVAL_MS);

    this.activeBots.set(botId, interval);
  }

  /**
   * 봇 트레이딩 루프 중지
   */
  stopBotLoop(botId: string): void {
    const interval = this.activeBots.get(botId);
    if (interval) {
      clearInterval(interval);
      this.activeBots.delete(botId);
    }
  }

  /**
   * 모든 활성 봇 중지 (서버 종료 시 graceful shutdown)
   */
  stopAllBots(): void {
    const count = this.activeBots.size;
    for (const [botId, interval] of this.activeBots) {
      clearInterval(interval);
      logger.info('Bot stopped during shutdown', { botId });
    }
    this.activeBots.clear();
    if (count > 0) {
      logger.info(`Stopped ${count} active bot(s) during shutdown`);
    }
  }

  /**
   * 서버 재시작 시 RUNNING 상태로 남은 봇을 STOPPED로 복구
   * (서버가 비정상 종료되었을 때 DB 상태 정리)
   */
  async recoverStuckBots(): Promise<void> {
    try {
      const result = await prisma.bot.updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'STOPPED' },
      });

      if (result.count > 0) {
        logger.warn(`Recovered ${result.count} stuck bot(s) from RUNNING to STOPPED`);
      }
    } catch (err) {
      logger.error('Failed to recover stuck bots', { error: String(err) });
    }
  }

  /**
   * 현재 활성 봇 수 반환
   */
  getActiveBotCount(): number {
    return this.activeBots.size;
  }
}

export const botRunnerService = new BotRunnerService();
