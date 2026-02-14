import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../utils/logger.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';
import { exchangeService, type SupportedExchange } from './exchange.service.js';
import { indicatorsService } from './indicators.service.js';
import { riskManager } from './risk.service.js';
import { decrypt } from '../utils/encryption.js';

// ===== 포지션 추적 인터페이스 =====
interface TrackedPosition {
  isOpen: boolean;
  side: 'long' | 'short';
  entryPrice: number;
  amount: number;
  totalCost: number;
  timestamp: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

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
  } | null;
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
const DEFAULT_FEE_RATE = 0.001;
const BOT_LOOP_INTERVAL_MS = 60_000;
const MAX_PAPER_LOGS = 1000;
const MIN_CONFIDENCE_THRESHOLD = 0.3;
const MIN_ORDER_VALUE_USDT = 10;

class BotRunnerService {
  private readonly activeBots: Map<string, { running: boolean; stopped: boolean }> = new Map();
  private paperTradeLogs: Map<string, PaperTradeLog[]> = new Map();
  // 포지션 추적 (봇별 심볼별)
  private readonly positions: Map<string, TrackedPosition> = new Map();

  // ===== 포지션 관리 =====
  private getPositionKey(botId: string, symbol: string): string {
    return `${botId}:${symbol}`;
  }

  private getPosition(botId: string, symbol: string): TrackedPosition | null {
    return this.positions.get(this.getPositionKey(botId, symbol)) ?? null;
  }

  private openPosition(
    botId: string,
    symbol: string,
    side: 'long' | 'short',
    price: number,
    amount: number,
    stopLoss?: number,
    takeProfit?: number
  ): TrackedPosition {
    const key = this.getPositionKey(botId, symbol);
    const existing = this.positions.get(key);

    if (existing && existing.isOpen && existing.side === side) {
      // 같은 방향 추가 매수 - 평균 진입가 업데이트
      const totalAmount = existing.amount + amount;
      const totalCost = existing.totalCost + price * amount;
      existing.amount = totalAmount;
      existing.totalCost = totalCost;
      existing.entryPrice = totalCost / totalAmount;
      existing.stopLossPrice = stopLoss ?? existing.stopLossPrice;
      existing.takeProfitPrice = takeProfit ?? existing.takeProfitPrice;
      return existing;
    }

    const position: TrackedPosition = {
      isOpen: true,
      side,
      entryPrice: price,
      amount,
      totalCost: price * amount,
      timestamp: Date.now(),
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit,
    };
    this.positions.set(key, position);
    return position;
  }

  private closePosition(botId: string, symbol: string): TrackedPosition | null {
    const key = this.getPositionKey(botId, symbol);
    const position = this.positions.get(key);
    if (position) {
      position.isOpen = false;
      this.positions.delete(key);
    }
    return position ?? null;
  }

  /**
   * 전략에 전달할 포지션 컨텍스트 생성 (백테스터와 동일한 방식)
   */
  private enrichConfigWithPosition(
    config: Record<string, number>,
    position: TrackedPosition | null,
    currentPrice: number
  ): Record<string, number> {
    const enriched = { ...config };

    if (position && position.isOpen) {
      enriched['_hasPosition'] = 1;
      enriched['_avgEntryPrice'] = position.entryPrice;
      enriched['_positionAmount'] = position.amount;
      enriched['_positionSide'] = position.side === 'long' ? 1 : -1;

      const pnl = position.side === 'long'
        ? (currentPrice - position.entryPrice) * position.amount
        : (position.entryPrice - currentPrice) * position.amount;
      const pnlPct = position.entryPrice > 0
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'long' ? 1 : -1)
        : 0;

      enriched['_unrealizedPnl'] = pnl;
      enriched['_unrealizedPnlPct'] = pnlPct;
    } else {
      enriched['_hasPosition'] = 0;
      enriched['_avgEntryPrice'] = 0;
      enriched['_positionAmount'] = 0;
      enriched['_positionSide'] = 0;
      enriched['_unrealizedPnl'] = 0;
      enriched['_unrealizedPnlPct'] = 0;
    }

    return enriched;
  }

  /**
   * 스탑로스/테이크프로핏 확인
   */
  private checkStopLossTakeProfit(
    position: TrackedPosition,
    currentPrice: number
  ): { triggered: boolean; action: 'sell' | 'buy'; reason: string } | null {
    if (!position.isOpen) return null;

    const isLong = position.side === 'long';

    // 스탑로스 체크
    if (position.stopLossPrice) {
      const slTriggered = isLong
        ? currentPrice <= position.stopLossPrice
        : currentPrice >= position.stopLossPrice;

      if (slTriggered) {
        const lossPct = Math.abs((currentPrice - position.entryPrice) / position.entryPrice * 100);
        return {
          triggered: true,
          action: isLong ? 'sell' : 'buy',
          reason: `스탑로스 발동: ${currentPrice.toFixed(2)} (진입: ${position.entryPrice.toFixed(2)}, 손실: -${lossPct.toFixed(2)}%)`,
        };
      }
    }

    // 테이크프로핏 체크
    if (position.takeProfitPrice) {
      const tpTriggered = isLong
        ? currentPrice >= position.takeProfitPrice
        : currentPrice <= position.takeProfitPrice;

      if (tpTriggered) {
        const profitPct = Math.abs((currentPrice - position.entryPrice) / position.entryPrice * 100);
        return {
          triggered: true,
          action: isLong ? 'sell' : 'buy',
          reason: `테이크프로핏 달성: ${currentPrice.toFixed(2)} (진입: ${position.entryPrice.toFixed(2)}, 수익: +${profitPct.toFixed(2)}%)`,
        };
      }
    }

    return null;
  }

  /**
   * 리스크 관리 기반 동적 주문 수량 계산
   */
  private calculateOrderAmount(
    capital: number,
    entryPrice: number,
    atr: number,
    signal: { stopLoss?: number; confidence: number }
  ): number {
    if (entryPrice <= 0 || capital <= 0) return 0;

    // ATR 기반 포지션 사이징
    const riskPercent = Math.min(2, riskManager.getConfig().maxTradeRiskPercent);

    if (atr > 0) {
      const sizing = riskManager.calculateATRPositionSize(capital, riskPercent, entryPrice, atr);
      return Math.max(0, sizing.positionSize);
    }

    // ATR 없으면 고정 비율 사이징 (자본의 2% 리스크)
    if (signal.stopLoss && signal.stopLoss > 0) {
      const stopDistance = Math.abs(entryPrice - signal.stopLoss);
      if (stopDistance > 0) {
        const riskAmount = capital * (riskPercent / 100);
        return riskAmount / stopDistance;
      }
    }

    // Fallback: 자본의 5% 이내
    const maxPositionValue = capital * 0.05;
    return maxPositionValue / entryPrice;
  }

  /**
   * Paper trade 시그널 로깅
   */
  private logPaperSignal(log: PaperTradeLog): void {
    const logs = this.paperTradeLogs.get(log.botId) ?? [];
    logs.push(log);
    if (logs.length > MAX_PAPER_LOGS) {
      logs.splice(0, logs.length - MAX_PAPER_LOGS);
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
    const control = { running: true, stopped: false };
    this.activeBots.set(botId, control);

    const runLoop = async () => {
      if (control.stopped) return;

      try {
        const exchange = cachedExchange;
        if (mode === 'REAL' && !exchange) {
          logger.warn('No API key found for running bot', { botId });
          return;
        }

        // OHLCV 데이터 가져오기
        let ohlcvRaw: number[][] = [];
        if (mode === 'PAPER') {
          // Paper 모드: 공개 API로 실시세 데이터 가져오기
          try {
            const publicExchange = exchangeService.getPublicExchange(exchangeName);
            const data = await exchangeService.getOHLCV(publicExchange, symbol, '1h', 100);
            ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
          } catch (err) {
            logger.warn('Paper mode: failed to fetch OHLCV via public exchange', { error: String(err) });
            // Fallback: 인증된 exchange가 있으면 사용
            if (exchange) {
              const data = await exchangeService.getOHLCV(exchange, symbol, '1h', 100);
              ohlcvRaw = data.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
            }
          }
        } else if (exchange) {
          const data = await exchangeService.getOHLCV(exchange, symbol, '1h', 100);
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
        const currentPosition = this.getPosition(botId, symbol);

        // ===== 스탑로스/테이크프로핏 체크 (전략 분석보다 먼저!) =====
        if (currentPosition && currentPosition.isOpen) {
          const slTpCheck = this.checkStopLossTakeProfit(currentPosition, currentPrice);
          if (slTpCheck && slTpCheck.triggered) {
            logger.warn('Stop-loss/Take-profit triggered', {
              botId, symbol, reason: slTpCheck.reason,
              entryPrice: currentPosition.entryPrice,
              currentPrice,
            });

            await this.executeClose(
              botId, symbol, exchangeName, mode, exchange,
              currentPosition, currentPrice, slTpCheck.reason
            );
            return; // SL/TP 발동 시 이번 루프는 종료
          }
        }

        // ===== 리스크 관리 체크 =====
        if (mode === 'REAL') {
          // 서킷 브레이커 확인
          const cbCheck = await riskManager.checkCircuitBreaker(botId);
          if (cbCheck.triggered) {
            logger.warn('Circuit breaker active, skipping trade', {
              botId,
              consecutiveLosses: cbCheck.consecutiveLosses,
              cooldownRemainingMs: cbCheck.cooldownRemainingMs,
            });
            await prisma.botLog.create({
              data: {
                botId,
                level: 'WARN',
                message: `서킷 브레이커 발동: 연속 ${cbCheck.consecutiveLosses}회 손실, ${Math.ceil(cbCheck.cooldownRemainingMs / 60000)}분 대기`,
              },
            }).catch(() => {});
            return;
          }

          // 일일/주간 손실 한도 확인
          const riskCheck = await riskManager.checkRiskLimits(botId);
          if (!riskCheck.allowed) {
            logger.warn('Risk limit reached, skipping trade', {
              botId, reason: riskCheck.reason,
            });
            await prisma.botLog.create({
              data: {
                botId,
                level: 'WARN',
                message: `리스크 한도 초과: ${riskCheck.reason}`,
              },
            }).catch(() => {});
            return;
          }
        }

        // ===== 포지션 컨텍스트를 포함하여 전략 분석 =====
        const enrichedConfig = this.enrichConfigWithPosition(config, currentPosition, currentPrice);
        const signal = strategy.analyze(ohlcvData, enrichedConfig);

        // hold 시그널 로깅 (Paper 모드)
        if (mode === 'PAPER' && (!signal || signal.action === 'hold')) {
          const paper = exchangeService.getPaperExchange(exchangeName);
          if (paper) {
            const balance = paper.getBalance();
            const paperUsdtBalance = balance['USDT']?.total ?? 0;

            const unrealizedPnl = currentPosition && currentPosition.isOpen
              ? (currentPrice - currentPosition.entryPrice) * currentPosition.amount
              : 0;
            const unrealizedPnlPct = currentPosition && currentPosition.isOpen && currentPosition.entryPrice > 0
              ? ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100
              : 0;

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
              position: currentPosition && currentPosition.isOpen ? {
                isOpen: true,
                side: currentPosition.side,
                entryPrice: currentPosition.entryPrice,
                amount: currentPosition.amount,
                unrealizedPnl,
                unrealizedPnlPct,
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

          // 이미 포지션이 있을 때 같은 방향 매수 방지 (DCA 제외)
          if (signal.action === 'buy' && currentPosition && currentPosition.isOpen) {
            if (strategyType !== 'DCA' && strategyType !== 'MARTINGALE') {
              logger.debug('Buy signal with existing position, skipping (non-DCA)', { botId });
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
            await this.executePaperTrade(botId, symbol, exchangeName, signal, currentPrice, currentPosition, atr);
          } else if (exchange) {
            await this.executeRealTrade(botId, symbol, exchange, signal, currentPrice, currentPosition, atr, userId);
          }

          await prisma.botLog.create({
            data: {
              botId,
              level: 'INFO',
              message: `Signal: ${signal.action} - ${signal.reason} (신뢰도: ${(signal.confidence * 100).toFixed(1)}%)`,
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

      // 이전 반복 완료 후 다음 반복 스케줄 (겹침 방지)
      if (!control.stopped) {
        setTimeout(runLoop, BOT_LOOP_INTERVAL_MS);
      }
    };

    // 첫 반복 스케줄
    setTimeout(runLoop, BOT_LOOP_INTERVAL_MS);
  }

  /**
   * Paper 거래 실행
   */
  private async executePaperTrade(
    botId: string,
    symbol: string,
    exchangeName: SupportedExchange,
    signal: { action: string; confidence: number; reason: string; price: number; stopLoss?: number; takeProfit?: number; metadata?: Record<string, number | string> },
    currentPrice: number,
    currentPosition: TrackedPosition | null,
    atr: number
  ): Promise<void> {
    const paper = exchangeService.getPaperExchange(exchangeName);
    if (!paper) return;

    const balance = paper.getBalance();
    const capital = balance['USDT']?.total ?? 0;

    // 동적 주문 수량 계산
    let orderAmount: number;
    if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
      // 매도 시 보유 수량 전체 매도
      orderAmount = currentPosition.amount;
    } else {
      orderAmount = this.calculateOrderAmount(capital, currentPrice, atr, signal);
      // 최소 주문 금액 체크
      if (orderAmount * currentPrice < MIN_ORDER_VALUE_USDT) {
        logger.debug('Order value too small, skipping', {
          botId, value: orderAmount * currentPrice, min: MIN_ORDER_VALUE_USDT,
        });
        return;
      }
    }

    if (orderAmount <= 0) return;

    try {
      const order = await paper.createOrder(symbol, signal.action as 'buy' | 'sell', 'market', orderAmount);
      const fee = order.price * order.amount * DEFAULT_FEE_RATE;

      // 포지션 업데이트
      if (signal.action === 'buy') {
        this.openPosition(botId, symbol, 'long', order.price, order.amount, signal.stopLoss, signal.takeProfit);
      } else {
        this.closePosition(botId, symbol);
      }

      const updatedPosition = this.getPosition(botId, symbol);
      const unrealizedPnl = updatedPosition && updatedPosition.isOpen
        ? (currentPrice - updatedPosition.entryPrice) * updatedPosition.amount
        : 0;
      const unrealizedPnlPct = updatedPosition && updatedPosition.isOpen && updatedPosition.entryPrice > 0
        ? ((currentPrice - updatedPosition.entryPrice) / updatedPosition.entryPrice) * 100
        : 0;

      // PnL 계산 (매도 시)
      let realizedPnl: number | null = null;
      if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
        realizedPnl = (order.price - currentPosition.entryPrice) * order.amount - fee;
      }

      await prisma.trade.create({
        data: {
          botId,
          symbol,
          side: signal.action === 'buy' ? 'BUY' : 'SELL',
          type: 'MARKET',
          price: order.price,
          amount: order.amount,
          fee,
          pnl: realizedPnl,
        },
      });

      const updatedBalance = paper.getBalance();
      const paperUsdtBalance = updatedBalance['USDT']?.total ?? 0;

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
        position: updatedPosition ? {
          isOpen: updatedPosition.isOpen,
          side: updatedPosition.side,
          entryPrice: updatedPosition.entryPrice,
          amount: updatedPosition.amount,
          unrealizedPnl,
          unrealizedPnlPct,
        } : {
          isOpen: false,
          side: null,
          entryPrice: currentPosition?.entryPrice ?? 0,
          amount: 0,
          unrealizedPnl: 0,
          unrealizedPnlPct: 0,
        },
        paperBalance: paperUsdtBalance,
      });
    } catch (err) {
      logger.error('Paper trade execution failed', { botId, error: String(err) });
    }
  }

  /**
   * REAL 거래 실행 (리스크 관리 통합)
   */
  private async executeRealTrade(
    botId: string,
    symbol: string,
    exchange: ReturnType<typeof exchangeService.initExchange>,
    signal: { action: string; confidence: number; reason: string; price: number; stopLoss?: number; takeProfit?: number; metadata?: Record<string, number | string> },
    currentPrice: number,
    currentPosition: TrackedPosition | null,
    atr: number,
    userId: string
  ): Promise<void> {
    // 실제 잔고 조회
    let capital = 10000; // fallback
    try {
      const balances = await exchangeService.getBalance(exchange);
      const usdtBalance = balances['USDT'] as { total?: number } | undefined;
      capital = usdtBalance?.total ?? 10000;
    } catch (err) {
      logger.warn('Failed to fetch balance, using portfolio value', { error: String(err) });
      const portfolio = await prisma.portfolio.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { totalValue: true },
      });
      capital = portfolio?.totalValue ?? 10000;
    }

    // 동적 주문 수량 계산
    let orderAmount: number;
    if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
      orderAmount = currentPosition.amount;
    } else {
      orderAmount = this.calculateOrderAmount(capital, currentPrice, atr, signal);

      // 변동성 스케일링 적용
      if (atr > 0) {
        const volatility = (atr / currentPrice) * 100;
        orderAmount = riskManager.volatilityScaledSize(orderAmount, volatility);
      }

      // 최소 주문 금액 체크
      if (orderAmount * currentPrice < MIN_ORDER_VALUE_USDT) {
        logger.debug('Order value too small, skipping', {
          botId, value: orderAmount * currentPrice, min: MIN_ORDER_VALUE_USDT,
        });
        return;
      }
    }

    if (orderAmount <= 0) return;

    try {
      const order = await exchangeService.createOrder(
        exchange,
        symbol,
        signal.action as 'buy' | 'sell',
        'market',
        orderAmount
      );

      const fillPrice = order.average ?? order.price ?? currentPrice;
      const filledAmount = order.filled ?? orderAmount;
      const fee = order.fee?.cost ?? 0;

      // 포지션 업데이트
      if (signal.action === 'buy') {
        this.openPosition(botId, symbol, 'long', fillPrice, filledAmount, signal.stopLoss, signal.takeProfit);
      } else {
        this.closePosition(botId, symbol);
      }

      // PnL 계산 (매도 시)
      let realizedPnl: number | null = null;
      if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
        realizedPnl = (fillPrice - currentPosition.entryPrice) * filledAmount - fee;
      }

      await prisma.trade.create({
        data: {
          botId,
          symbol,
          side: signal.action === 'buy' ? 'BUY' : 'SELL',
          type: 'MARKET',
          price: fillPrice,
          amount: filledAmount,
          fee,
          pnl: realizedPnl,
        },
      });

      logger.info('Real trade executed', {
        botId, symbol,
        side: signal.action,
        price: fillPrice,
        amount: filledAmount,
        pnl: realizedPnl,
      });
    } catch (err) {
      logger.error('Real trade execution failed', { botId, symbol, error: String(err) });

      await prisma.botLog.create({
        data: {
          botId,
          level: 'ERROR',
          message: `거래 실행 실패: ${String(err)}`,
        },
      }).catch(() => {});
    }
  }

  /**
   * SL/TP로 인한 포지션 청산
   */
  private async executeClose(
    botId: string,
    symbol: string,
    exchangeName: SupportedExchange,
    mode: string,
    exchange: ReturnType<typeof exchangeService.initExchange> | null,
    position: TrackedPosition,
    currentPrice: number,
    reason: string
  ): Promise<void> {
    const closeSignal = {
      action: 'sell' as const,
      confidence: 1.0,
      reason,
      price: currentPrice,
    };

    if (mode === 'PAPER') {
      await this.executePaperTrade(
        botId, symbol, exchangeName, closeSignal, currentPrice, position, 0
      );
    } else if (exchange) {
      try {
        const order = await exchangeService.createOrder(
          exchange, symbol, 'sell', 'market', position.amount
        );

        const fillPrice = order.average ?? order.price ?? currentPrice;
        const fee = order.fee?.cost ?? 0;
        const pnl = (fillPrice - position.entryPrice) * position.amount - fee;

        this.closePosition(botId, symbol);

        await prisma.trade.create({
          data: {
            botId,
            symbol,
            side: 'SELL',
            type: 'MARKET',
            price: fillPrice,
            amount: position.amount,
            fee,
            pnl,
          },
        });

        logger.warn('Position closed by SL/TP', {
          botId, symbol, reason, pnl,
        });
      } catch (err) {
        logger.error('Failed to close position via SL/TP', {
          botId, symbol, error: String(err),
        });
      }
    }

    await prisma.botLog.create({
      data: {
        botId,
        level: 'WARN',
        message: reason,
      },
    }).catch(() => {});
  }

  /**
   * 봇 트레이딩 루프 중지
   */
  stopBotLoop(botId: string): void {
    const control = this.activeBots.get(botId);
    if (control) {
      control.stopped = true;
      control.running = false;
      this.activeBots.delete(botId);
    }
  }

  /**
   * 모든 활성 봇 중지 (서버 종료 시 graceful shutdown)
   */
  stopAllBots(): void {
    const count = this.activeBots.size;
    for (const [botId, control] of this.activeBots) {
      control.stopped = true;
      control.running = false;
      logger.info('Bot stopped during shutdown', { botId });
    }
    this.activeBots.clear();
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

  /**
   * 현재 활성 봇 수 반환
   */
  getActiveBotCount(): number {
    return this.activeBots.size;
  }

  /**
   * 특정 봇의 현재 포지션 조회
   */
  getBotPosition(botId: string, symbol: string): TrackedPosition | null {
    return this.getPosition(botId, symbol);
  }
}

export const botRunnerService = new BotRunnerService();
