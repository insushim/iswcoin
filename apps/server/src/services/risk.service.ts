import { logger } from '../utils/logger.js';
import { prisma } from '../db.js';
import { getDateRanges } from '../utils/date.js';
import { env } from '../config/env.js';

export interface RiskConfig {
  maxTradeRiskPercent: number;
  maxDailyRiskPercent: number;
  maxWeeklyRiskPercent: number;
  maxPositionSizePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  maxOpenPositions: number;
  // 서킷 브레이커
  maxConsecutiveLosses: number;
  circuitBreakerCooldownMs: number;
  // ATR 동적 사이징
  atrPositionSizingEnabled: boolean;
  atrMultiplierSL: number;
  atrMultiplierTP: number;
  // 변동성 조절
  volatilityScalingEnabled: boolean;
  targetVolatilityPct: number;
  // Phase 1.3: 프로덕션 안전 장치
  maxDrawdownPercent: number;           // MDD 킬스위치 (전체 계좌)
  maxDailyTradeCount: number;           // 일일 거래 횟수 상한
  maxCorrelatedExposurePercent: number; // 상관 노출 한도
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxTradeRiskPercent: 3,
  maxDailyRiskPercent: 5,
  maxWeeklyRiskPercent: 7,
  maxPositionSizePercent: 20,
  stopLossPercent: 2,
  takeProfitPercent: 6,
  trailingStopPercent: 1.5,
  maxOpenPositions: 5,
  maxConsecutiveLosses: 5,
  circuitBreakerCooldownMs: 3600000, // 1시간
  atrPositionSizingEnabled: true,
  atrMultiplierSL: 2.0,
  atrMultiplierTP: 3.0,
  volatilityScalingEnabled: true,
  targetVolatilityPct: 2.0,
  maxDrawdownPercent: 15,
  maxDailyTradeCount: 50,
  maxCorrelatedExposurePercent: 30,
};

export interface PositionSizeResult {
  positionSize: number;
  riskAmount: number;
  stopLossPrice: number;
  takeProfitLevels: { price: number; percentage: number }[];
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
  currentDailyLoss: number;
  currentWeeklyLoss: number;
}

export interface RiskCheckEnhancedResult extends RiskCheckResult {
  dailyTradeCount: number;
  drawdownPercent: number;
  shouldEmergencyStop: boolean; // MDD 킬스위치 발동 여부
}

export interface TieredTakeProfit {
  level: number;
  price: number;
  percentage: number;
  amount: number;
}

export class RiskManager {
  private riskConfig: RiskConfig;

  constructor(config?: Partial<RiskConfig>) {
    this.riskConfig = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  calculatePositionSize(
    capital: number,
    riskPercent: number,
    entryPrice: number,
    stopLossPrice: number
  ): PositionSizeResult {
    const effectiveRisk = Math.min(riskPercent, this.riskConfig.maxTradeRiskPercent);
    const riskAmount = capital * (effectiveRisk / 100);
    const priceDiff = Math.abs(entryPrice - stopLossPrice);

    if (priceDiff === 0) {
      logger.warn('Stop loss price equals entry price, returning zero position');
      return {
        positionSize: 0,
        riskAmount: 0,
        stopLossPrice,
        takeProfitLevels: [],
      };
    }

    const positionSize = riskAmount / priceDiff;
    const positionValue = positionSize * entryPrice;
    const maxPositionValue = capital * (this.riskConfig.maxPositionSizePercent / 100);

    const finalPositionSize = positionValue > maxPositionValue
      ? maxPositionValue / entryPrice
      : positionSize;

    const takeProfitLevels = this.calculateTieredTP(entryPrice, stopLossPrice);

    return {
      positionSize: finalPositionSize,
      riskAmount: finalPositionSize * priceDiff,
      stopLossPrice,
      takeProfitLevels,
    };
  }

  kellyCriterion(winRate: number, avgWin: number, avgLoss: number): number {
    if (avgLoss === 0 || winRate <= 0 || winRate >= 1) {
      return 0;
    }

    const b = avgWin / Math.abs(avgLoss);
    const kellyFraction = (winRate * b - (1 - winRate)) / b;

    const halfKelly = kellyFraction / 2;
    const capped = Math.max(0, Math.min(halfKelly, 0.25));

    logger.debug('Kelly criterion calculated', {
      winRate,
      avgWin,
      avgLoss,
      fullKelly: kellyFraction,
      halfKelly: capped,
    });

    return capped;
  }

  async checkRiskLimits(botId: string): Promise<RiskCheckResult> {
    const { startOfDay, startOfWeek } = getDateRanges();

    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { userId: true },
    });

    if (!bot) {
      return { allowed: false, reason: 'Bot not found', currentDailyLoss: 0, currentWeeklyLoss: 0 };
    }

    // 병렬 집계 쿼리 (findMany → aggregate)
    const [portfolio, dailyAgg, weeklyAgg] = await Promise.all([
      prisma.portfolio.findFirst({
        where: { userId: bot.userId },
        orderBy: { updatedAt: 'desc' },
        select: { totalValue: true },
      }),
      prisma.trade.aggregate({
        where: { botId, timestamp: { gte: startOfDay } },
        _sum: { pnl: true },
      }),
      prisma.trade.aggregate({
        where: { botId, timestamp: { gte: startOfWeek } },
        _sum: { pnl: true },
      }),
    ]);

    const totalCapital = portfolio?.totalValue ?? env.PAPER_INITIAL_BALANCE;
    const dailyPnL = dailyAgg._sum.pnl ?? 0;
    const weeklyPnL = weeklyAgg._sum.pnl ?? 0;

    const dailyLossPercent = totalCapital > 0 ? (Math.abs(Math.min(0, dailyPnL)) / totalCapital) * 100 : 0;
    const weeklyLossPercent = totalCapital > 0 ? (Math.abs(Math.min(0, weeklyPnL)) / totalCapital) * 100 : 0;

    if (dailyLossPercent >= this.riskConfig.maxDailyRiskPercent) {
      logger.warn('Daily risk limit reached', { botId, dailyLossPercent });
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${dailyLossPercent.toFixed(2)}% >= ${this.riskConfig.maxDailyRiskPercent}%`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
      };
    }

    if (weeklyLossPercent >= this.riskConfig.maxWeeklyRiskPercent) {
      logger.warn('Weekly risk limit reached', { botId, weeklyLossPercent });
      return {
        allowed: false,
        reason: `Weekly loss limit reached: ${weeklyLossPercent.toFixed(2)}% >= ${this.riskConfig.maxWeeklyRiskPercent}%`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
      };
    }

    return {
      allowed: true,
      reason: 'Within risk limits',
      currentDailyLoss: dailyLossPercent,
      currentWeeklyLoss: weeklyLossPercent,
    };
  }

  /**
   * 강화된 리스크 체크: 미실현 PnL 포함, MDD 킬스위치, 일일 거래 한도
   */
  async checkRiskLimitsEnhanced(
    botId: string,
    unrealizedPnl: number = 0,
    peakEquity?: number
  ): Promise<RiskCheckEnhancedResult> {
    const { startOfDay, startOfWeek } = getDateRanges();

    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { userId: true },
    });

    if (!bot) {
      return {
        allowed: false,
        reason: 'Bot not found',
        currentDailyLoss: 0,
        currentWeeklyLoss: 0,
        dailyTradeCount: 0,
        drawdownPercent: 0,
        shouldEmergencyStop: false,
      };
    }

    const [portfolio, dailyAgg, weeklyAgg, dailyTradeCount] = await Promise.all([
      prisma.portfolio.findFirst({
        where: { userId: bot.userId },
        orderBy: { updatedAt: 'desc' },
        select: { totalValue: true },
      }),
      prisma.trade.aggregate({
        where: { botId, timestamp: { gte: startOfDay } },
        _sum: { pnl: true },
      }),
      prisma.trade.aggregate({
        where: { botId, timestamp: { gte: startOfWeek } },
        _sum: { pnl: true },
      }),
      prisma.trade.count({
        where: { botId, timestamp: { gte: startOfDay } },
      }),
    ]);

    const totalCapital = portfolio?.totalValue ?? env.PAPER_INITIAL_BALANCE;
    // 실현 + 미실현 PnL 합산
    const dailyPnL = (dailyAgg._sum.pnl ?? 0) + unrealizedPnl;
    const weeklyPnL = (weeklyAgg._sum.pnl ?? 0) + unrealizedPnl;

    const dailyLossPercent = totalCapital > 0 ? (Math.abs(Math.min(0, dailyPnL)) / totalCapital) * 100 : 0;
    const weeklyLossPercent = totalCapital > 0 ? (Math.abs(Math.min(0, weeklyPnL)) / totalCapital) * 100 : 0;

    // MDD 킬스위치: 전체 계좌 기준
    const currentEquity = totalCapital + unrealizedPnl;
    const peak = peakEquity ?? totalCapital;
    const drawdownPercent = peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0;
    const shouldEmergencyStop = drawdownPercent >= this.riskConfig.maxDrawdownPercent;

    if (shouldEmergencyStop) {
      logger.error('MDD KILL SWITCH triggered', {
        botId, drawdownPercent, maxDrawdown: this.riskConfig.maxDrawdownPercent,
        peak, currentEquity,
      });
      return {
        allowed: false,
        reason: `MDD 킬스위치 발동: 낙폭 ${drawdownPercent.toFixed(2)}% >= ${this.riskConfig.maxDrawdownPercent}% (최고점 ${peak.toFixed(0)}, 현재 ${currentEquity.toFixed(0)})`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
        dailyTradeCount,
        drawdownPercent,
        shouldEmergencyStop: true,
      };
    }

    // 일일 거래 횟수 한도
    if (dailyTradeCount >= this.riskConfig.maxDailyTradeCount) {
      logger.warn('Daily trade count limit reached', { botId, dailyTradeCount });
      return {
        allowed: false,
        reason: `일일 거래 횟수 한도 초과: ${dailyTradeCount} >= ${this.riskConfig.maxDailyTradeCount}`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
        dailyTradeCount,
        drawdownPercent,
        shouldEmergencyStop: false,
      };
    }

    // 일일 손실 한도 (미실현 PnL 포함)
    if (dailyLossPercent >= this.riskConfig.maxDailyRiskPercent) {
      logger.warn('Daily risk limit reached (incl. unrealized)', { botId, dailyLossPercent });
      return {
        allowed: false,
        reason: `일일 손실 한도 초과 (미실현 포함): ${dailyLossPercent.toFixed(2)}% >= ${this.riskConfig.maxDailyRiskPercent}%`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
        dailyTradeCount,
        drawdownPercent,
        shouldEmergencyStop: false,
      };
    }

    // 주간 손실 한도 (미실현 PnL 포함)
    if (weeklyLossPercent >= this.riskConfig.maxWeeklyRiskPercent) {
      logger.warn('Weekly risk limit reached (incl. unrealized)', { botId, weeklyLossPercent });
      return {
        allowed: false,
        reason: `주간 손실 한도 초과 (미실현 포함): ${weeklyLossPercent.toFixed(2)}% >= ${this.riskConfig.maxWeeklyRiskPercent}%`,
        currentDailyLoss: dailyLossPercent,
        currentWeeklyLoss: weeklyLossPercent,
        dailyTradeCount,
        drawdownPercent,
        shouldEmergencyStop: false,
      };
    }

    return {
      allowed: true,
      reason: 'Within risk limits',
      currentDailyLoss: dailyLossPercent,
      currentWeeklyLoss: weeklyLossPercent,
      dailyTradeCount,
      drawdownPercent,
      shouldEmergencyStop: false,
    };
  }

  calculateTrailingStop(
    entryPrice: number,
    currentPrice: number,
    highestPrice: number,
    atr: number,
    multiplier: number = 2
  ): { stopPrice: number; triggered: boolean } {
    const trailDistance = atr * multiplier;
    const stopPrice = highestPrice - trailDistance;

    // 트레일링 스탑: 최고점에서 하락 시 발동 (수익/손실 무관)
    const triggered = currentPrice <= stopPrice;

    return { stopPrice, triggered };
  }

  calculateTieredTP(
    entryPrice: number,
    stopLossPrice: number
  ): { price: number; percentage: number }[] {
    const isLong = entryPrice > stopLossPrice;
    const riskDistance = Math.abs(entryPrice - stopLossPrice);

    if (isLong) {
      return [
        { price: entryPrice + riskDistance * 1, percentage: 25 },
        { price: entryPrice + riskDistance * 2, percentage: 50 },
        { price: entryPrice + riskDistance * 4, percentage: 25 },
      ];
    }

    return [
      { price: entryPrice - riskDistance * 1, percentage: 25 },
      { price: entryPrice - riskDistance * 2, percentage: 50 },
      { price: entryPrice - riskDistance * 4, percentage: 25 },
    ];
  }

  calculateTieredTPFromPercentages(
    entryPrice: number,
    totalAmount: number,
    isLong: boolean = true
  ): TieredTakeProfit[] {
    const tiers = [
      { level: 1, pct: 2, amountPct: 25 },
      { level: 2, pct: 4, amountPct: 50 },
      { level: 3, pct: 8, amountPct: 25 },
    ];

    return tiers.map((tier) => {
      const priceChange = entryPrice * (tier.pct / 100);
      const price = isLong ? entryPrice + priceChange : entryPrice - priceChange;
      const amount = totalAmount * (tier.amountPct / 100);

      return {
        level: tier.level,
        price,
        percentage: tier.amountPct,
        amount,
      };
    });
  }

  /**
   * ATR 기반 동적 포지션 사이징
   * 변동성이 높을수록 포지션 크기를 줄여 일정한 리스크 유지
   */
  calculateATRPositionSize(
    capital: number,
    riskPercent: number,
    entryPrice: number,
    atr: number,
    isLong: boolean = true
  ): PositionSizeResult {
    if (!this.riskConfig.atrPositionSizingEnabled || atr <= 0) {
      return this.calculatePositionSize(
        capital, riskPercent, entryPrice,
        entryPrice * (1 - this.riskConfig.stopLossPercent / 100)
      );
    }

    const effectiveRisk = Math.min(riskPercent, this.riskConfig.maxTradeRiskPercent);
    const riskAmount = capital * (effectiveRisk / 100);

    // ATR 기반 손절가 (롱/숏 구분)
    const stopLossDistance = atr * this.riskConfig.atrMultiplierSL;
    const stopLossPrice = isLong
      ? entryPrice - stopLossDistance
      : entryPrice + stopLossDistance;

    // ATR 손절거리 0 방어 (극단적 저변동성)
    if (stopLossDistance <= 0) {
      logger.warn('ATR stop loss distance is zero, falling back to percentage-based sizing');
      return this.calculatePositionSize(
        capital, riskPercent, entryPrice,
        entryPrice * (1 - this.riskConfig.stopLossPercent / 100)
      );
    }

    // 포지션 크기 = 리스크금액 / ATR손절거리
    let positionSize = riskAmount / stopLossDistance;
    const positionValue = positionSize * entryPrice;
    const maxPositionValue = capital * (this.riskConfig.maxPositionSizePercent / 100);

    if (positionValue > maxPositionValue) {
      positionSize = maxPositionValue / entryPrice;
    }

    // ATR 기반 익절가 (롱/숏 구분)
    const direction = isLong ? 1 : -1;
    const takeProfitLevels = [
      { price: entryPrice + direction * atr * this.riskConfig.atrMultiplierTP * 0.5, percentage: 30 },
      { price: entryPrice + direction * atr * this.riskConfig.atrMultiplierTP, percentage: 40 },
      { price: entryPrice + direction * atr * this.riskConfig.atrMultiplierTP * 1.5, percentage: 30 },
    ];

    logger.debug('ATR position sizing', {
      capital,
      atr,
      stopLossDistance,
      positionSize,
      positionValue: positionSize * entryPrice,
    });

    return {
      positionSize,
      riskAmount: positionSize * stopLossDistance,
      stopLossPrice,
      takeProfitLevels,
    };
  }

  /**
   * 변동성 스케일링: 목표 변동성 대비 현재 변동성으로 포지션 조절
   */
  volatilityScaledSize(
    basePositionSize: number,
    currentVolatility: number
  ): number {
    if (!this.riskConfig.volatilityScalingEnabled || currentVolatility <= 0) {
      return basePositionSize;
    }

    const scaleFactor = this.riskConfig.targetVolatilityPct / currentVolatility;
    const clampedScale = Math.max(0.2, Math.min(scaleFactor, 2.0));

    logger.debug('Volatility scaling', {
      target: this.riskConfig.targetVolatilityPct,
      current: currentVolatility,
      scaleFactor: clampedScale,
    });

    return basePositionSize * clampedScale;
  }

  // 메모리 기반 연속 손실 추적 (매 루프 DB 쿼리 제거)
  private consecutiveLossTracker: Map<string, { count: number; lastLossTime: number }> = new Map();

  /**
   * 거래 결과 기록 (서킷 브레이커용 메모리 추적)
   */
  recordTradeResult(botId: string, pnl: number): void {
    const tracker = this.consecutiveLossTracker.get(botId) ?? { count: 0, lastLossTime: 0 };
    if (pnl < 0) {
      tracker.count++;
      tracker.lastLossTime = Date.now();
    } else {
      tracker.count = 0;
    }
    this.consecutiveLossTracker.set(botId, tracker);
  }

  /**
   * 서킷 브레이커: 연속 손실 감지 시 거래 일시 중단 (메모리 기반, DB 쿼리 없음)
   */
  async checkCircuitBreaker(botId: string): Promise<{
    triggered: boolean;
    consecutiveLosses: number;
    cooldownRemainingMs: number;
  }> {
    const tracker = this.consecutiveLossTracker.get(botId);
    if (!tracker) {
      return { triggered: false, consecutiveLosses: 0, cooldownRemainingMs: 0 };
    }

    const consecutiveLosses = tracker.count;

    if (consecutiveLosses >= this.riskConfig.maxConsecutiveLosses) {
      const elapsed = Date.now() - tracker.lastLossTime;
      const remaining = this.riskConfig.circuitBreakerCooldownMs - elapsed;

      if (remaining > 0) {
        logger.warn('Circuit breaker active', {
          botId,
          consecutiveLosses,
          cooldownRemainingMs: remaining,
        });
        return { triggered: true, consecutiveLosses, cooldownRemainingMs: remaining };
      }
      // 쿨다운 만료 → 카운터 리셋
      tracker.count = 0;
    }

    return { triggered: false, consecutiveLosses, cooldownRemainingMs: 0 };
  }

  /**
   * 일일 실현 변동성 계산 (최근 N일 수익률의 표준편차 * sqrt(365))
   */
  calculateRealizedVolatility(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;

    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);

    return Math.sqrt(variance) * Math.sqrt(365) * 100;
  }

  /**
   * 포트폴리오 VaR (Value at Risk) - 파라메트릭 방법
   */
  calculateVaR(
    portfolioValue: number,
    dailyReturns: number[],
    confidenceLevel: number = 0.95
  ): number {
    if (dailyReturns.length < 10) return 0;

    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const std = Math.sqrt(
      dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
    );

    // Z-score 근사: 95% → 1.645, 99% → 2.326
    const zScore = confidenceLevel >= 0.99 ? 2.326 : 1.645;

    // VaR는 양수로 "잠재적 최대 손실"을 표현
    return portfolioValue * (zScore * std - mean);
  }

  getConfig(): RiskConfig {
    return { ...this.riskConfig };
  }

  updateConfig(updates: Partial<RiskConfig>): void {
    this.riskConfig = { ...this.riskConfig, ...updates };
    logger.info('Risk config updated', { config: this.riskConfig });
  }
}

export const riskManager = new RiskManager();
