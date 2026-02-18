import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class MartingaleStrategy extends BaseStrategy {
  private currentLevel: number = 0;
  private lastEntryPrice: number = 0;
  private positionActive: boolean = false;
  private consecutiveLosses: number = 0;

  constructor(config?: Record<string, number>) {
    super('MARTINGALE', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      maxLevel: 5,
      baseMultiplier: 2,
      dropThresholdPct: 3,
      takeProfitPct: 2,
      rsiPeriod: 14,
      rsiEntryThreshold: 45,
      emaPeriod: 50,
      maxDrawdownPct: 15,
      cooldownCandles: 5,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const maxLevel = cfg['maxLevel'] ?? 5;
    const baseMultiplier = cfg['baseMultiplier'] ?? 2;
    const dropThresholdPct = cfg['dropThresholdPct'] ?? 3;
    const takeProfitPct = cfg['takeProfitPct'] ?? 2;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const rsiEntryThreshold = cfg['rsiEntryThreshold'] ?? 35;
    const emaPeriod = cfg['emaPeriod'] ?? 50;
    const maxDrawdownPct = cfg['maxDrawdownPct'] ?? 15;

    const minRequired = Math.max(rsiPeriod, emaPeriod) + 5;
    if (data.length < minRequired) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const currentCandle = data[data.length - 1]!;
    const currentPrice = currentCandle.close;

    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const emaValues = indicatorsService.calculateEMA(closes, emaPeriod);

    if (rsiValues.length < 1 || emaValues.length < 1) {
      return null;
    }

    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const currentEMA = emaValues[emaValues.length - 1]!;

    if (this.positionActive) {
      const profitPct = ((currentPrice - this.lastEntryPrice) / this.lastEntryPrice) * 100;

      if (profitPct >= takeProfitPct) {
        this.positionActive = false;
        this.currentLevel = 0;
        this.consecutiveLosses = 0;

        return {
          action: 'sell',
          confidence: 0.85,
          reason: `Martingale TP hit: +${profitPct.toFixed(2)}% at level ${this.currentLevel}`,
          price: currentPrice,
          metadata: {
            level: this.currentLevel,
            profitPct: Math.round(profitPct * 100) / 100,
            entryPrice: this.lastEntryPrice,
          },
        };
      }

      const dropFromEntry = ((this.lastEntryPrice - currentPrice) / this.lastEntryPrice) * 100;

      if (dropFromEntry >= dropThresholdPct && this.currentLevel < maxLevel) {
        if (dropFromEntry >= maxDrawdownPct) {
          this.positionActive = false;
          this.currentLevel = 0;
          this.consecutiveLosses++;

          return {
            action: 'sell',
            confidence: 0.9,
            reason: `Martingale max drawdown stop: -${dropFromEntry.toFixed(2)}%, cutting losses`,
            price: currentPrice,
            metadata: {
              level: this.currentLevel,
              drawdownPct: Math.round(dropFromEntry * 100) / 100,
              consecutiveLosses: this.consecutiveLosses,
            },
          };
        }

        this.currentLevel++;
        this.lastEntryPrice = currentPrice;
        const multiplier = Math.pow(baseMultiplier, this.currentLevel);

        return {
          action: 'buy',
          confidence: 0.55 + this.currentLevel * 0.05,
          reason: `Martingale level ${this.currentLevel}: doubling down (${multiplier}x), drop=${dropFromEntry.toFixed(1)}%`,
          price: currentPrice,
          metadata: {
            level: this.currentLevel,
            multiplier,
            dropPct: Math.round(dropFromEntry * 100) / 100,
            rsi: Math.round(currentRSI * 100) / 100,
          },
        };
      }

      return null;
    }

    const belowEMA = currentPrice < currentEMA;
    const isOversold = currentRSI < rsiEntryThreshold;

    if (belowEMA && isOversold) {
      this.positionActive = true;
      this.currentLevel = 0;
      this.lastEntryPrice = currentPrice;

      return {
        action: 'buy',
        confidence: 0.5,
        reason: `Martingale initial entry: RSI=${currentRSI.toFixed(1)}, price below EMA, starting level 0`,
        price: currentPrice,
        stopLoss: currentPrice * (1 - maxDrawdownPct / 100),
        metadata: {
          level: 0,
          rsi: Math.round(currentRSI * 100) / 100,
          ema: Math.round(currentEMA * 100) / 100,
          consecutiveLosses: this.consecutiveLosses,
        },
      };
    }

    return null;
  }

  resetState(): void {
    this.currentLevel = 0;
    this.lastEntryPrice = 0;
    this.positionActive = false;
    this.consecutiveLosses = 0;
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  serializeState(): Record<string, unknown> {
    return {
      currentLevel: this.currentLevel,
      lastEntryPrice: this.lastEntryPrice,
      positionActive: this.positionActive,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  restoreState(state: Record<string, unknown>): void {
    if (typeof state['currentLevel'] === 'number') this.currentLevel = state['currentLevel'];
    if (typeof state['lastEntryPrice'] === 'number') this.lastEntryPrice = state['lastEntryPrice'];
    if (typeof state['positionActive'] === 'boolean') this.positionActive = state['positionActive'];
    if (typeof state['consecutiveLosses'] === 'number') this.consecutiveLosses = state['consecutiveLosses'];
  }
}
