import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../utils/logger.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';
import { exchangeService } from './exchange.service.js';
import { indicatorsService } from './indicators.service.js';
import { decrypt } from '../utils/encryption.js';

// Paper trade signal/P&L 로깅 인터페이스
interface PaperTradeLog {
  botId: string;
  timestamp: number;
  signal: {
    action: string;
    confidence: number;
    reason: string;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  execution: {
    fillPrice: number;
    amount: number;
    side: 'buy' | 'sell';
    fee: number;
  } | null; // null when signal was 'hold' or skipped
  position: {
    isOpen: boolean;
    side: 'long' | 'short' | null;
    entryPrice: number;
    amount: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  } | null;
  paperBalance: number;
}

// 매직 넘버 상수화
const DEFAULT_ORDER_AMOUNT = 0.001;
const DEFAULT_FEE_RATE = 0.001;
const BOT_LOOP_INTERVAL_MS = 60_000;

class BotRunnerService {
  private readonly activeBots: Map<string, NodeJS.Timeout> = new Map();
  private paperTradeLogs: Map<string, PaperTradeLog[]> = new Map();

  /**
   * Paper trade 시그널 로깅
   */
  private logPaperSignal(log: PaperTradeLog): void {
    const logs = this.paperTradeLogs.get(log.botId) ?? [];
    logs.push(log);
    // Keep last 1000 logs per bot
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }
    this.paperTradeLogs.set(log.botId, logs);

    logger.info('Paper trade signal', {
      botId: log.botId,
      action: log.signal.action,
      confidence: log.signal.confidence,
      price: log.signal.price,
      executed: log.execution !== null,
      balance: log.paperBalance,
      unrealizedPnl: log.position?.unrealizedPnl ?? 0,
    });
  }

  /**
   * Paper trade 로그 조회 (API 노출용)
   */
  getPaperTradeLogs(botId: string): PaperTradeLog[] {
    return this.paperTradeLogs.get(botId) ?? [];
  }

  /**
   * Paper trade 통계 조회 (API 노출용)
   */
  getPaperTradeStats(botId: string): {
    totalSignals: number;
    buySignals: number;
    sellSignals: number;
    executedTrades: number;
    currentBalance: number;
    totalPnl: number;
    winRate: number;
  } {
    const logs = this.paperTradeLogs.get(botId) ?? [];
    const executed = logs.filter(l => l.execution !== null);

    let wins = 0;
    let losses = 0;
    for (const log of logs) {
      if (log.position && !log.position.isOpen && log.execution?.side === 'sell') {
        // A sell that closed a position
        if (log.position.unrealizedPnl > 0) wins++;
        else losses++;
      }
    }

    const lastLog = logs[logs.length - 1];
    const currentBalance = lastLog?.paperBalance ?? 0;
    const initialBalance = logs[0]?.paperBalance ?? currentBalance;

    return {
      totalSignals: logs.length,
      buySignals: logs.filter(l => l.signal.action === 'buy').length,
      sellSignals: logs.filter(l => l.signal.action === 'sell').length,
      executedTrades: executed.length,
      currentBalance,
      totalPnl: currentBalance - initialBalance,
      winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
    };
  }

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
        const currentPrice = ohlcvData[ohlcvData.length - 1]?.close ?? 0;

        // Paper trade: hold/null 시그널도 로깅
        if (mode === 'PAPER') {
          const paper = exchangeService.getPaperExchange(exchangeName);
          if (paper && (!signal || signal.action === 'hold')) {
            const balance = paper.getBalance();
            const paperUsdtBalance = balance['USDT']?.total ?? 0;
            const [base] = symbol.split('/') as [string, string];
            const baseBalance = balance[base];
            const hasPosition = baseBalance !== undefined && baseBalance.total > 0;

            const unrealizedPnl = hasPosition ? (currentPrice - (currentPrice)) * (baseBalance?.total ?? 0) : 0;

            this.logPaperSignal({
              botId,
              timestamp: Date.now(),
              signal: {
                action: signal?.action ?? 'hold',
                confidence: signal?.confidence ?? 0,
                reason: signal?.reason ?? 'No signal generated',
                price: currentPrice,
                stopLoss: signal?.stopLoss,
                takeProfit: signal?.takeProfit,
              },
              execution: null,
              position: hasPosition ? {
                isOpen: true,
                side: 'long',
                entryPrice: 0, // 포지션 진입가는 별도 추적 필요
                amount: baseBalance?.total ?? 0,
                unrealizedPnl: 0,
                unrealizedPnlPct: 0,
              } : null,
              paperBalance: paperUsdtBalance,
            });
          }
        }

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
              const fee = order.price * order.amount * DEFAULT_FEE_RATE;

              await prisma.trade.create({
                data: {
                  botId,
                  symbol,
                  side: signal.action === 'buy' ? 'BUY' : 'SELL',
                  type: 'MARKET',
                  price: order.price,
                  amount: order.amount,
                  fee,
                },
              });

              // Paper trade 실행 로깅
              const balance = paper.getBalance();
              const paperUsdtBalance = balance['USDT']?.total ?? 0;
              const [base] = symbol.split('/') as [string, string];
              const baseBalance = balance[base];
              const hasPosition = baseBalance !== undefined && baseBalance.total > 0;

              // 매도 시 실현 P&L 계산
              const isClosingPosition = signal.action === 'sell';
              const unrealizedPnl = hasPosition
                ? (currentPrice - order.price) * (baseBalance?.total ?? 0)
                : 0;
              const unrealizedPnlPct = hasPosition && order.price > 0
                ? ((currentPrice - order.price) / order.price) * 100
                : 0;

              this.logPaperSignal({
                botId,
                timestamp: Date.now(),
                signal: {
                  action: signal.action,
                  confidence: signal.confidence,
                  reason: signal.reason,
                  price: signal.price,
                  stopLoss: signal.stopLoss,
                  takeProfit: signal.takeProfit,
                },
                execution: {
                  fillPrice: order.price,
                  amount: order.amount,
                  side: signal.action === 'buy' ? 'buy' : 'sell',
                  fee,
                },
                position: {
                  isOpen: hasPosition && !isClosingPosition,
                  side: hasPosition ? 'long' : null,
                  entryPrice: order.price,
                  amount: baseBalance?.total ?? 0,
                  unrealizedPnl,
                  unrealizedPnlPct,
                },
                paperBalance: paperUsdtBalance,
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
    // Don't delete logs on stop - keep for analysis
    // this.paperTradeLogs.delete(botId);
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
