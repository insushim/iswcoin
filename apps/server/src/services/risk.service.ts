import { logger } from '../utils/logger.js';
import { prisma } from '../db.js';
import { getDateRanges } from '../utils/date.js';

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

    const totalCapital = portfolio?.totalValue ?? 10000;
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

  /**
   * 서킷 브레이커: 연속 손실 감지 시 거래 일시 중단
   */
  async checkCircuitBreaker(botId: string): Promise<{
    triggered: boolean;
    consecutiveLosses: number;
    cooldownRemainingMs: number;
  }> {
    const recentTrades = await prisma.trade.findMany({
      where: { botId },
      orderBy: { timestamp: 'desc' },
      take: this.riskConfig.maxConsecutiveLosses + 1,
    });

    let consecutiveLosses = 0;
    for (const trade of recentTrades) {
      if ((trade.pnl ?? 0) < 0) {
        consecutiveLosses++;
      } else {
        break;
      }
    }

    if (consecutiveLosses >= this.riskConfig.maxConsecutiveLosses) {
      const lastLoss = recentTrades[0];
      if (lastLoss) {
        const elapsed = Date.now() - lastLoss.timestamp.getTime();
        const remaining = this.riskConfig.circuitBreakerCooldownMs - elapsed;

        if (remaining > 0) {
          logger.warn('Circuit breaker active', {
            botId,
            consecutiveLosses,
            cooldownRemainingMs: remaining,
          });
          return { triggered: true, consecutiveLosses, cooldownRemainingMs: remaining };
        }
      }
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
