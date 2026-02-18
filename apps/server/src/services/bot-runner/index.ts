import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { getStrategy, type StrategyType, GridStrategy, MartingaleStrategy } from '../../strategies/index.js';
import { exchangeService } from '../exchange.service.js';
import { indicatorsService } from '../indicators.service.js';
import { riskManager } from '../risk.service.js';
import { decrypt } from '../../utils/encryption.js';
import { env } from '../../config/env.js';

import type {
  BotRunnerState,
  TrackedPosition,
  PaperTradeLog,
  ActiveBotState,
} from './types.js';
import { MIN_CONFIDENCE_THRESHOLD, PAPER_SAVE_INTERVAL, RECONCILE_INTERVAL } from './types.js';
import { PositionManager } from './position-manager.js';
import { OrderCalculator } from './order-calculator.js';
import { PaperTradingService } from './paper-trading.js';
import { RealTradingService } from './real-trading.js';

// re-export types for consumers
export type { TrackedPosition, PaperTradeLog, ActiveBotState, BotRunnerState } from './types.js';

export class BotRunnerService {
  private readonly state: BotRunnerState;
  private readonly positionManager: PositionManager;
  private readonly orderCalculator: OrderCalculator;
  private readonly paperTrading: PaperTradingService;
  private readonly realTrading: RealTradingService;

  constructor() {
    this.state = {
      positions: new Map(),
      paperBalances: new Map(),
      paperTradeLogs: new Map(),
      paperPositions: new Map(),
      activeBots: new Map(),
    };

    this.positionManager = new PositionManager(this.state);
    this.orderCalculator = new OrderCalculator();
    this.paperTrading = new PaperTradingService(this.state, this.positionManager, this.orderCalculator);
    this.realTrading = new RealTradingService(this.positionManager, this.orderCalculator);
  }

  // ===== Public API (기존 인터페이스와 동일) =====

  /**
   * Paper trade 로그 조회 (API 노출용)
   */
  getPaperTradeLogs(botId: string): PaperTradeLog[] {
    return this.paperTrading.getPaperTradeLogs(botId);
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
    return this.paperTrading.getPaperTradeStats(botId);
  }

  /**
   * Paper trade 종합 통계 (API 노출용 - summary)
   */
  getPaperTradeSummary(botId: string): {
    balance: number;
    initialBalance: number;
    totalPnl: number;
    totalPnlPct: number;
    netPnl: number;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    equityCurve: { date: string; value: number }[];
    dailyPnl: { date: string; pnl: number }[];
  } {
    return this.paperTrading.getPaperTradeSummary(botId);
  }

  /**
   * 현재 활성 봇 수 반환
   */
  getActiveBotCount(): number {
    return this.state.activeBots.size;
  }

  /**
   * 특정 봇의 현재 포지션 조회
   */
  getBotPosition(botId: string, symbol: string): TrackedPosition | null {
    return this.positionManager.getPosition(botId, symbol);
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

    // Grid/Martingale 전략 상태 복원
    if (strategyType === 'GRID' || strategyType === 'MARTINGALE') {
      const botForState = await prisma.bot.findUnique({
        where: { id: botId },
        select: { riskConfig: true },
      });
      const rc = botForState?.riskConfig as Record<string, unknown> | null;
      const savedStrategyState = rc?.strategyState as Record<string, unknown> | undefined;
      if (savedStrategyState) {
        if (strategyType === 'GRID' && strategy instanceof GridStrategy) {
          strategy.restoreState(savedStrategyState);
          logger.info('Grid strategy state restored', { botId });
        } else if (strategyType === 'MARTINGALE' && strategy instanceof MartingaleStrategy) {
          strategy.restoreState(savedStrategyState);
          logger.info('Martingale strategy state restored', { botId });
        }
      }
    }

    if (mode === 'PAPER') {
      // DB에서 이전 Paper 상태 복원 시도
      const botRecord = await prisma.bot.findUnique({
        where: { id: botId },
        select: { id: true, riskConfig: true },
      });
      if (botRecord) {
        this.paperTrading.restorePaperState(botRecord);
      }

      const restoredBalance = this.state.paperBalances.get(botId);
      const initialBalance = restoredBalance?.USDT ?? env.PAPER_INITIAL_BALANCE;
      exchangeService.initPaperExchange(exchangeName, initialBalance);
    }

    // API 키를 시작 시 한 번만 조회하여 캐싱
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

    // setTimeout 체이닝: 이전 반복이 완료된 후에만 다음 반복 스케줄
    const control: ActiveBotState = { running: true, stopped: false, loopCount: 0, peakEquity: 0 };
    this.state.activeBots.set(botId, control);

    // REAL 모드: 시작 시 포지션 대사
    if (mode === 'REAL' && cachedExchange) {
      await this.positionManager.reconcilePosition(botId, symbol, cachedExchange, 0).catch((err) => logger.debug('Background task failed', { error: String(err) }));
    }

    const runLoop = async () => {
      if (control.stopped) return;
      control.loopCount++;

      try {
        const exchange = cachedExchange;
        if (mode === 'REAL' && !exchange) {
          logger.warn('No API key found for running bot', { botId });
          return;
        }

        // 주기적 Paper 상태 저장 (크래시 복구용)
        if (mode === 'PAPER' && control.loopCount % PAPER_SAVE_INTERVAL === 0) {
          await this.paperTrading.savePaperState(botId).catch((err) => {
            logger.warn('Periodic paper state save failed', { botId, error: String(err) });
          });
        }

        // REAL 모드: 주기적 포지션 대사
        if (mode === 'REAL' && exchange && control.loopCount % RECONCILE_INTERVAL === 0) {
          await this.positionManager.reconcilePosition(botId, symbol, exchange, 0).catch((err) => logger.debug('Background task failed', { error: String(err) }));
        }

        // OHLCV 데이터 가져오기
        let ohlcvRaw: number[][] = [];
        if (mode === 'PAPER') {
          // Paper 모드: 공개 API로 실시세 데이터 가져오기
          try {
            const publicExchange = exchangeService.getPublicExchange(exchangeName);
            const data = await exchangeService.getOHLCV(publicExchange, symbol, '1h', 200);
            ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
          } catch (err) {
            logger.warn('Paper mode: failed to fetch OHLCV via public exchange', { error: String(err) });
            // Fallback: 인증된 exchange가 있으면 사용
            if (exchange) {
              const data = await exchangeService.getOHLCV(exchange, symbol, '1h', 200);
              ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
            }
          }
        } else if (exchange) {
          const data = await exchangeService.getOHLCV(exchange, symbol, '1h', 200);
          ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
        }

        if (ohlcvRaw.length === 0) {
          return;
        }

        const ohlcvData = indicatorsService.parseOHLCV(ohlcvRaw);
        const currentPrice = ohlcvData[ohlcvData.length - 1]?.close ?? 0;
        if (currentPrice <= 0) return;

        // ATR 계산 (리스크 관리용)
        let atr = 0;
        if (ohlcvData.length >= 15) {
          const highs = ohlcvData.map(d => d.high);
          const lows = ohlcvData.map(d => d.low);
          const closes = ohlcvData.map(d => d.close);
          const atrValues = indicatorsService.calculateATR(highs, lows, closes, 14);
          atr = atrValues.length > 0 ? atrValues[atrValues.length - 1]! : 0;
        }

        // 현재 포지션 상태 조회
        const currentPosition = this.positionManager.getPosition(botId, symbol);

        // ===== 스탑로스/테이크프로핏 체크 (전략 분석보다 먼저!) =====
        if (currentPosition && currentPosition.isOpen) {
          const slTpCheck = this.orderCalculator.checkStopLossTakeProfit(currentPosition, currentPrice);
          if (slTpCheck && slTpCheck.triggered) {
            logger.warn('Stop-loss/Take-profit triggered', {
              botId, symbol, reason: slTpCheck.reason,
              entryPrice: currentPosition.entryPrice,
              currentPrice,
            });

            await this.realTrading.executeClose(
              botId, symbol, exchangeName, mode, exchange,
              currentPosition, currentPrice, slTpCheck.reason,
              this.paperTrading
            );
            return; // SL/TP 발동 시 이번 루프는 종료
          }
        }

        // ===== 리스크 관리 체크 (PAPER + REAL 모드 공통) =====
        // 서킷 브레이커 확인
        const cbCheck = await riskManager.checkCircuitBreaker(botId);
        if (cbCheck.triggered) {
          logger.warn('Circuit breaker active, skipping trade', {
            botId,
            mode,
            consecutiveLosses: cbCheck.consecutiveLosses,
            cooldownRemainingMs: cbCheck.cooldownRemainingMs,
          });
          await prisma.botLog.create({
            data: {
              botId,
              level: 'WARN',
              message: `서킷 브레이커 발동: 연속 ${cbCheck.consecutiveLosses}회 손실, ${Math.ceil(cbCheck.cooldownRemainingMs / 60000)}분 대기`,
            },
          }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
          return;
        }

        // 미실현 PnL 계산 (강화된 리스크 체크에 전달)
        let unrealizedPnl = 0;
        if (currentPosition && currentPosition.isOpen) {
          unrealizedPnl = currentPosition.side === 'long'
            ? (currentPrice - currentPosition.entryPrice) * currentPosition.amount
            : (currentPosition.entryPrice - currentPrice) * currentPosition.amount;
        }

        // 강화된 리스크 체크 (미실현 PnL + MDD + 일일 거래 한도)
        const riskCheck = await riskManager.checkRiskLimitsEnhanced(
          botId, unrealizedPnl, control.peakEquity > 0 ? control.peakEquity : undefined
        );

        // 피크 에퀴티 업데이트 (MDD 추적용)
        if (riskCheck.allowed) {
          const currentEquity = env.PAPER_INITIAL_BALANCE + unrealizedPnl;
          if (currentEquity > control.peakEquity) {
            control.peakEquity = currentEquity;
          }
        }

        if (!riskCheck.allowed) {
          logger.warn('Risk limit reached, skipping trade', {
            botId, mode, reason: riskCheck.reason,
          });
          await prisma.botLog.create({
            data: {
              botId,
              level: riskCheck.shouldEmergencyStop ? 'ERROR' : 'WARN',
              message: `리스크 한도 초과: ${riskCheck.reason}`,
            },
          }).catch((err) => logger.debug('Background task failed', { error: String(err) }));

          // MDD 킬스위치: 봇 정지
          if (riskCheck.shouldEmergencyStop) {
            logger.error('MDD kill switch: stopping bot', { botId });
            await prisma.bot.update({
              where: { id: botId },
              data: { status: 'ERROR' },
            }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
            control.stopped = true;

            // 열린 포지션 강제 청산
            if (currentPosition && currentPosition.isOpen) {
              await this.realTrading.executeClose(
                botId, symbol, exchangeName, mode, exchange ?? null,
                currentPosition, currentPrice,
                `MDD 킬스위치 발동: 낙폭 ${riskCheck.drawdownPercent.toFixed(2)}%`,
                this.paperTrading
              );
            }
          }
          return;
        }

        // ===== 포지션 컨텍스트를 포함하여 전략 분석 =====
        const enrichedConfig = this.orderCalculator.enrichConfigWithPosition(config, currentPosition, currentPrice);

        // FUNDING_ARB 전략: analyzeWithFunding() 사용 (비동기 펀딩비 데이터 필요)
        let signal: import('../../strategies/base.strategy.js').TradeSignal | null = null;
        if (strategyType === 'FUNDING_ARB') {
          const { FundingArbStrategy } = await import('../../strategies/funding-arb.strategy.js');
          const fundingStrategy = strategy as InstanceType<typeof FundingArbStrategy>;
          try {
            const fundingSignal = await fundingStrategy.analyzeWithFunding(
              symbol, currentPrice, ohlcvRaw
            );
            // FundingArbSignal -> TradeSignal 매핑
            if (fundingSignal.action === 'ENTER_LONG_FUNDING' || fundingSignal.action === 'ENTER_SHORT_FUNDING') {
              signal = {
                action: 'buy',
                confidence: fundingSignal.confidence / 100,
                reason: fundingSignal.reason,
                price: currentPrice,
                stopLoss: currentPrice * (1 - (enrichedConfig['stopLossPercent'] ?? 2) / 100),
                metadata: {
                  fundingRate: String(fundingSignal.fundingRate),
                  annualizedRate: String(fundingSignal.annualizedRate),
                  expectedProfit: String(fundingSignal.expectedProfit),
                },
              };
            } else if (fundingSignal.action === 'EXIT') {
              signal = {
                action: 'sell',
                confidence: fundingSignal.confidence / 100,
                reason: fundingSignal.reason,
                price: currentPrice,
              };
            }
            // HOLD -> signal remains null
          } catch (err) {
            logger.warn('FundingArb analyzeWithFunding failed, falling back', { error: String(err) });
            signal = strategy.analyze(ohlcvData, enrichedConfig);
          }
        } else {
          signal = strategy.analyze(ohlcvData, enrichedConfig);
        }

        // hold 시그널 로깅 (Paper 모드)
        if (mode === 'PAPER' && (!signal || signal.action === 'hold')) {
          const paper = exchangeService.getPaperExchange(exchangeName);
          if (paper) {
            const balance = paper.getBalance();
            const paperUsdtBalance = balance['USDT']?.total ?? 0;

            const holdUnrealizedPnl = currentPosition && currentPosition.isOpen
              ? (currentPrice - currentPosition.entryPrice) * currentPosition.amount
              : 0;
            const holdUnrealizedPnlPct = currentPosition && currentPosition.isOpen && currentPosition.entryPrice > 0
              ? ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100
              : 0;

            this.paperTrading.logPaperSignal({
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
              position: currentPosition && currentPosition.isOpen ? {
                isOpen: true,
                side: currentPosition.side,
                entryPrice: currentPosition.entryPrice,
                amount: currentPosition.amount,
                unrealizedPnl: holdUnrealizedPnl,
                unrealizedPnlPct: holdUnrealizedPnlPct,
              } : null,
              paperBalance: paperUsdtBalance,
            });
          }
        }

        if (signal && signal.action !== 'hold') {
          // 최소 신뢰도 체크
          if (signal.confidence < MIN_CONFIDENCE_THRESHOLD) {
            logger.debug('Signal confidence too low, skipping', {
              botId, confidence: signal.confidence, threshold: MIN_CONFIDENCE_THRESHOLD,
            });
            return;
          }

          // 포지션 없이 매도 시도 방지
          if (signal.action === 'sell' && (!currentPosition || !currentPosition.isOpen)) {
            logger.debug('Sell signal without open position, skipping', { botId });
            return;
          }

          // 이미 포지션이 있을 때 같은 방향 매수 방지 (DCA/MARTINGALE/ENSEMBLE 제외)
          if (signal.action === 'buy' && currentPosition && currentPosition.isOpen) {
            if (strategyType !== 'DCA' && strategyType !== 'MARTINGALE' && strategyType !== 'ENSEMBLE') {
              logger.debug('Buy signal with existing position, skipping (non-DCA/ENSEMBLE)', { botId });
              return;
            }
          }

          logger.info('Trade signal generated', {
            botId,
            action: signal.action,
            reason: signal.reason,
            confidence: signal.confidence,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
          });

          if (mode === 'PAPER') {
            await this.paperTrading.executePaperTrade(botId, symbol, exchangeName, signal, currentPrice, currentPosition, atr, ohlcvData, userId);
          } else if (exchange) {
            await this.realTrading.executeRealTrade(botId, symbol, exchange, signal, currentPrice, currentPosition, atr, userId);
          }

          await prisma.botLog.create({
            data: {
              botId,
              level: 'INFO',
              message: `Signal: ${signal.action} - ${signal.reason} (신뢰도: ${(signal.confidence * 100).toFixed(1)}%)`,
              data: (signal.metadata ?? {}) as Prisma.InputJsonValue,
            },
          });

          // Grid/Martingale 전략 상태 영속화 (거래 후)
          if (strategyType === 'GRID' || strategyType === 'MARTINGALE') {
            try {
              const strategyState = (strategyType === 'GRID' && strategy instanceof GridStrategy)
                ? strategy.serializeState()
                : (strategyType === 'MARTINGALE' && strategy instanceof MartingaleStrategy)
                  ? strategy.serializeState()
                  : null;

              if (strategyState) {
                const existingBot = await prisma.bot.findUnique({
                  where: { id: botId },
                  select: { riskConfig: true },
                });
                const existingRc = (existingBot?.riskConfig as Record<string, unknown>) ?? {};
                await prisma.bot.update({
                  where: { id: botId },
                  data: {
                    riskConfig: {
                      ...existingRc,
                      strategyState,
                    } as Prisma.InputJsonValue,
                  },
                });
              }
            } catch (saveErr) {
              logger.warn('Failed to save strategy state', { botId, error: String(saveErr) });
            }
          }
        }
      } catch (err) {
        logger.error('Bot loop error', { botId, error: String(err) });
        await prisma.botLog.create({
          data: {
            botId,
            level: 'ERROR',
            message: `Bot error: ${String(err)}`,
          },
        }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
      }

      // 이전 반복 완료 후 다음 반복 스케줄 (겹침 방지)
      if (!control.stopped) {
        const interval = mode === 'PAPER' ? env.PAPER_LOOP_INTERVAL_MS : 60_000;
        control.timerId = setTimeout(runLoop, interval);
      }
    };

    // 첫 반복 스케줄 (PAPER 모드는 환경변수 간격, REAL은 60초)
    const firstInterval = mode === 'PAPER' ? env.PAPER_LOOP_INTERVAL_MS : 60_000;
    control.timerId = setTimeout(runLoop, firstInterval);
  }

  /**
   * 봇 트레이딩 루프 중지
   */
  async stopBotLoop(botId: string): Promise<void> {
    const control = this.state.activeBots.get(botId);
    if (control) {
      control.stopped = true;
      control.running = false;
      logger.info('Bot stopped', { botId, loopCount: control.loopCount });
      if (control.timerId) {
        clearTimeout(control.timerId);
        control.timerId = undefined;
      }

      // Paper 모드 상태 저장
      await this.paperTrading.savePaperState(botId).catch((err) => {
        logger.error('Failed to save paper state on stop', { botId, error: String(err) });
      });

      // Paper 상태 메모리 정리
      this.state.paperTradeLogs.delete(botId);
      this.state.paperBalances.delete(botId);
      this.state.paperPositions.delete(botId);
      this.state.activeBots.delete(botId);
    }
  }

  /**
   * 모든 활성 봇 중지 (서버 종료 시 graceful shutdown)
   */
  async stopAllBots(): Promise<void> {
    const count = this.state.activeBots.size;
    const savePromises: Promise<void>[] = [];

    for (const [botId, control] of this.state.activeBots) {
      control.stopped = true;
      control.running = false;
      if (control.timerId) {
        clearTimeout(control.timerId);
        control.timerId = undefined;
      }
      // Paper 모드 상태 저장
      savePromises.push(
        this.paperTrading.savePaperState(botId).catch((err) => {
          logger.error('Failed to save paper state during shutdown', { botId, error: String(err) });
        })
      );
      logger.info('Bot stopped during shutdown', { botId });
    }

    // 모든 Paper 상태 저장 완료 대기
    await Promise.all(savePromises);

    this.state.activeBots.clear();
    this.state.paperTradeLogs.clear();
    this.state.paperBalances.clear();
    this.state.paperPositions.clear();
    if (count > 0) {
      logger.info(`Stopped ${count} active bot(s) during shutdown`);
    }
  }

  /**
   * 서버 재시작 시 RUNNING 상태로 남은 봇을 STOPPED로 복구
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
}

export const botRunnerService = new BotRunnerService();
