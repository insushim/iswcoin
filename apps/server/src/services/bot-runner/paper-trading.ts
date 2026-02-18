import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { exchangeService, EXCHANGE_FEE_RATES, type SupportedExchange } from '../exchange.service.js';
import { riskManager } from '../risk.service.js';
import { slippageService } from '../slippage.service.js';
import { notificationService } from '../notification.service.js';
import { env } from '../../config/env.js';
import type { BotRunnerState, TrackedPosition, PaperTradeLog, TradeSignalInput } from './types.js';
import { MAX_PAPER_LOGS, MIN_ORDER_VALUE_USDT } from './types.js';
import type { PositionManager } from './position-manager.js';
import type { OrderCalculator } from './order-calculator.js';

/**
 * PaperTradingService: Paper 모드 거래 실행, 로깅, 통계, 상태 영속화
 */
export class PaperTradingService {
  constructor(
    private state: BotRunnerState,
    private positionManager: PositionManager,
    private orderCalculator: OrderCalculator
  ) {}

  /**
   * Paper trade 시그널 로깅
   */
  logPaperSignal(log: PaperTradeLog): void {
    const logs = this.state.paperTradeLogs.get(log.botId) ?? [];
    logs.push(log);
    if (logs.length > MAX_PAPER_LOGS) {
      logs.splice(0, logs.length - MAX_PAPER_LOGS);
    }
    this.state.paperTradeLogs.set(log.botId, logs);

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
    return this.state.paperTradeLogs.get(botId) ?? [];
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
    const logs = this.state.paperTradeLogs.get(botId) ?? [];
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
    const logs = this.state.paperTradeLogs.get(botId) ?? [];
    const initialBalance = env.PAPER_INITIAL_BALANCE;

    // 체결된 거래만 추출
    const executedLogs = logs.filter(l => l.execution !== null);

    // 라운드트립 수익 추적 (매도 시점의 실현 PnL)
    const roundTripPnls: number[] = [];
    let totalFees = 0;

    for (const log of executedLogs) {
      if (log.execution) {
        totalFees += log.execution.fee;
      }
      if (log.execution?.side === 'sell' && log.position && !log.position.isOpen) {
        roundTripPnls.push(log.position.unrealizedPnl);
      }
    }

    const wins = roundTripPnls.filter(p => p > 0).length;
    const losses = roundTripPnls.filter(p => p <= 0).length;
    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

    const totalGrossProfit = roundTripPnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const totalGrossLoss = Math.abs(roundTripPnls.filter(p => p <= 0).reduce((s, p) => s + p, 0));
    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : totalGrossProfit > 0 ? Infinity : 0;

    const avgWin = wins > 0 ? totalGrossProfit / wins : 0;
    const avgLoss = losses > 0 ? totalGrossLoss / losses : 0;

    // 에쿼티 커브 & MDD 계산
    const equityCurve: { date: string; value: number }[] = [];
    const dailyPnlMap = new Map<string, number>();
    let peak = initialBalance;
    let maxDrawdown = 0;

    for (const log of logs) {
      const dateStr = new Date(log.timestamp).toISOString().split('T')[0]!;

      // 에쿼티 커브: 모든 로그 시점의 잔고
      if (log.paperBalance > 0) {
        equityCurve.push({ date: dateStr, value: log.paperBalance });

        if (log.paperBalance > peak) peak = log.paperBalance;
        const dd = peak - log.paperBalance;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }

      // 일별 PnL 계산 (체결 시점만)
      if (log.execution?.side === 'sell' && log.position) {
        const existing = dailyPnlMap.get(dateStr) ?? 0;
        dailyPnlMap.set(dateStr, existing + log.position.unrealizedPnl);
      }
    }

    const dailyPnl = Array.from(dailyPnlMap.entries()).map(([date, pnl]) => ({ date, pnl }));

    // 샤프 비율: 일별 수익률의 평균/표준편차 * sqrt(252)
    let sharpeRatio = 0;
    if (dailyPnl.length >= 2) {
      const dailyReturns = dailyPnl.map(d => d.pnl / initialBalance);
      const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
    }

    const lastLog = logs[logs.length - 1];
    const currentBalance = lastLog?.paperBalance ?? initialBalance;
    const totalPnl = currentBalance - initialBalance;
    const totalPnlPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;
    const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    return {
      balance: currentBalance,
      initialBalance,
      totalPnl,
      totalPnlPct,
      netPnl: totalPnl - totalFees,
      totalTrades: executedLogs.length,
      wins,
      losses,
      winRate,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
      profitFactor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      equityCurve,
      dailyPnl,
    };
  }

  /**
   * Paper 모드 상태를 DB에 저장 (봇 중지 시 호출)
   */
  async savePaperState(botId: string): Promise<void> {
    const balance = this.state.paperBalances.get(botId);
    const positions = this.state.paperPositions.get(botId);
    if (!balance && !positions) return;

    try {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { riskConfig: true },
      });

      const existingRiskConfig = (bot?.riskConfig as Record<string, unknown>) ?? {};

      await prisma.bot.update({
        where: { id: botId },
        data: {
          riskConfig: {
            ...existingRiskConfig,
            paperState: {
              balance,
              positions: positions ? Array.from(positions.entries()) : [],
              savedAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });

      logger.info('Paper state saved', { botId, balance });
    } catch (err) {
      logger.error('Failed to save paper state', { botId, error: String(err) });
    }
  }

  /**
   * Paper 모드 상태를 DB에서 복원 (봇 시작 시 호출)
   */
  restorePaperState(bot: { id: string; riskConfig: unknown }): void {
    const riskConfig = bot.riskConfig as Record<string, unknown> | null;
    const paperState = riskConfig?.paperState as {
      balance?: Record<string, number>;
      positions?: [string, TrackedPosition][];
      savedAt?: string;
    } | undefined;

    if (paperState?.balance) {
      this.state.paperBalances.set(bot.id, paperState.balance);
      logger.info('Paper balance restored', { botId: bot.id, balance: paperState.balance, savedAt: paperState.savedAt });
    } else {
      this.state.paperBalances.set(bot.id, { USDT: env.PAPER_INITIAL_BALANCE });
    }

    if (paperState?.positions?.length) {
      const positionsMap = new Map<string, TrackedPosition>(paperState.positions);
      this.state.paperPositions.set(bot.id, positionsMap);

      // 내부 positions 맵에도 복원
      for (const [key, position] of positionsMap) {
        if (position.isOpen) {
          this.state.positions.set(key, position);
        }
      }

      logger.info('Paper positions restored', { botId: bot.id, positionCount: paperState.positions.length });
    }
  }

  /**
   * Paper 거래 실행 (슬리피지 시뮬레이션 통합)
   */
  async executePaperTrade(
    botId: string,
    symbol: string,
    exchangeName: SupportedExchange,
    signal: TradeSignalInput,
    currentPrice: number,
    currentPosition: TrackedPosition | null,
    atr: number,
    ohlcvData?: { high: number; low: number; close: number; volume: number }[],
    userId?: string
  ): Promise<void> {
    const paper = exchangeService.getPaperExchange(exchangeName);
    if (!paper) return;

    const balance = paper.getBalance();
    const capital = balance['USDT']?.total ?? 0;

    // 동적 주문 수량 계산 (포지션 누적 상한 적용)
    let orderAmount: number;
    if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
      // 매도 시 보유 수량 전체 매도
      orderAmount = currentPosition.amount;
    } else {
      orderAmount = this.orderCalculator.calculateOrderAmount(capital, currentPrice, atr, signal, currentPosition);
      // 최소 주문 금액 체크
      if (orderAmount * currentPrice < MIN_ORDER_VALUE_USDT) {
        logger.debug('Order value too small, skipping', {
          botId, value: orderAmount * currentPrice, min: MIN_ORDER_VALUE_USDT,
        });
        return;
      }
    }

    if (orderAmount <= 0) return;

    // 슬리피지 시뮬레이션
    let slippageAdjustedPrice = currentPrice;
    if (env.PAPER_SLIPPAGE_ENABLED === 'true' && ohlcvData && ohlcvData.length > 15) {
      const { currentATR, avgVolume } = slippageService.extractSlippageInputs(ohlcvData);
      const orderSizeUSD = orderAmount * currentPrice;
      const currentVolume = ohlcvData[ohlcvData.length - 1]?.volume ?? 0;
      const slippagePct = slippageService.calculateDynamicSlippage(
        0.0005, currentATR, currentPrice, currentVolume, avgVolume, orderSizeUSD
      );
      // 매수 시 +슬리피지 (불리하게), 매도 시 -슬리피지 (불리하게)
      slippageAdjustedPrice = signal.action === 'buy'
        ? currentPrice * (1 + slippagePct)
        : currentPrice * (1 - slippagePct);

      logger.debug('Paper trade slippage applied', {
        botId, original: currentPrice, adjusted: slippageAdjustedPrice, slippagePct,
      });
    }

    try {
      const order = await paper.createOrder(symbol, signal.action as 'buy' | 'sell', 'market', orderAmount, slippageAdjustedPrice);
      const feeRate = EXCHANGE_FEE_RATES[exchangeName] ?? 0.001;
      const fee = order.price * order.amount * feeRate;

      // 포지션 업데이트
      if (signal.action === 'buy') {
        this.positionManager.openPosition(botId, symbol, 'long', order.price, order.amount, signal.stopLoss, signal.takeProfit);
      } else {
        this.positionManager.closePosition(botId, symbol);
      }

      const updatedPosition = this.positionManager.getPosition(botId, symbol);
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

      // 서킷 브레이커 메모리 추적 업데이트
      if (realizedPnl !== null) riskManager.recordTradeResult(botId, realizedPnl);

      // 알림 생성 (userId가 있을 때만)
      if (userId) {
        notificationService.sendTradeNotification(
          userId, symbol, signal.action, order.price, order.amount, realizedPnl ?? undefined
        ).catch((err) => logger.debug('Trade notification failed', { error: String(err) }));
      }

      const updatedBalance = paper.getBalance();
      const paperUsdtBalance = updatedBalance['USDT']?.total ?? 0;

      // Paper 상태 추적 업데이트 (영속화용)
      this.state.paperBalances.set(botId, { USDT: paperUsdtBalance });
      const currentPositions = new Map<string, TrackedPosition>();
      for (const [key, pos] of this.state.positions) {
        if (key.startsWith(`${botId}:`)) {
          currentPositions.set(key, pos);
        }
      }
      this.state.paperPositions.set(botId, currentPositions);

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
}
