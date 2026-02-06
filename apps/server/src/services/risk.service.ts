import { logger } from '../utils/logger.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface RiskConfig {
  maxTradeRiskPercent: number;
  maxDailyRiskPercent: number;
  maxWeeklyRiskPercent: number;
  maxPositionSizePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent: number;
  maxOpenPositions: number;
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
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      include: { user: true },
    });

    if (!bot) {
      return { allowed: false, reason: 'Bot not found', currentDailyLoss: 0, currentWeeklyLoss: 0 };
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId: bot.userId },
      orderBy: { updatedAt: 'desc' },
    });

    const totalCapital = portfolio?.totalValue ?? 10000;

    const dailyTrades = await prisma.trade.findMany({
      where: {
        botId,
        timestamp: { gte: startOfDay },
      },
    });

    const weeklyTrades = await prisma.trade.findMany({
      where: {
        botId,
        timestamp: { gte: startOfWeek },
      },
    });

    const dailyPnL = dailyTrades.reduce((sum: number, t: any) => sum + (t.pnl ?? 0), 0);
    const weeklyPnL = weeklyTrades.reduce((sum: number, t: any) => sum + (t.pnl ?? 0), 0);

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

    const triggered = currentPrice <= stopPrice && currentPrice < entryPrice * (1 + 0.001);

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

  getConfig(): RiskConfig {
    return { ...this.riskConfig };
  }

  updateConfig(updates: Partial<RiskConfig>): void {
    this.riskConfig = { ...this.riskConfig, ...updates };
    logger.info('Risk config updated', { config: this.riskConfig });
  }
}

export const riskManager = new RiskManager();
