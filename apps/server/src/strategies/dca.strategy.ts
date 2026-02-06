import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class DCAStrategy extends BaseStrategy {
  private lastBuyTimestamp: number = 0;

  constructor(config?: Record<string, number>) {
    super('DCA', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      intervalCandles: 24,
      dipThresholdPct: 5,
      dipMultiplier: 2,
      rsiOversold: 30,
      rsiPeriod: 14,
      maxPositions: 10,
      currentPositions: 0,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const intervalCandles = cfg['intervalCandles'] ?? 24;
    const dipThresholdPct = cfg['dipThresholdPct'] ?? 5;
    const dipMultiplier = cfg['dipMultiplier'] ?? 2;
    const rsiOversold = cfg['rsiOversold'] ?? 30;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const maxPositions = cfg['maxPositions'] ?? 10;
    const currentPositions = cfg['currentPositions'] ?? 0;

    if (data.length < rsiPeriod + 1) {
      return null;
    }

    if (currentPositions >= maxPositions) {
      return null;
    }

    const currentCandle = data[data.length - 1]!;
    const closes = data.map((d) => d.close);
    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);

    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : 50;

    const recentHigh = Math.max(...data.slice(-intervalCandles).map((d) => d.high));
    const dipPct = recentHigh > 0
      ? ((recentHigh - currentCandle.close) / recentHigh) * 100
      : 0;

    const isDip = dipPct >= dipThresholdPct;
    const isRSIOversold = currentRSI < rsiOversold;

    const candlesSinceLastBuy = data.length - 1;
    const isScheduledBuy = candlesSinceLastBuy >= intervalCandles || this.lastBuyTimestamp === 0;

    if (isDip && isRSIOversold) {
      this.lastBuyTimestamp = currentCandle.timestamp;
      return {
        action: 'buy',
        confidence: 0.85,
        reason: `DCA dip buy: price dropped ${dipPct.toFixed(1)}% from recent high, RSI=${currentRSI.toFixed(1)}`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.9,
        metadata: {
          type: 'dip_buy',
          dipPct: Math.round(dipPct * 100) / 100,
          rsi: Math.round(currentRSI * 100) / 100,
          multiplier: dipMultiplier,
        },
      };
    }

    if (isDip) {
      this.lastBuyTimestamp = currentCandle.timestamp;
      return {
        action: 'buy',
        confidence: 0.7,
        reason: `DCA dip buy: price dropped ${dipPct.toFixed(1)}% from recent high`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.92,
        metadata: {
          type: 'dip_buy',
          dipPct: Math.round(dipPct * 100) / 100,
          multiplier: dipMultiplier,
        },
      };
    }

    if (isScheduledBuy) {
      this.lastBuyTimestamp = currentCandle.timestamp;
      return {
        action: 'buy',
        confidence: 0.5,
        reason: `DCA scheduled buy at interval of ${intervalCandles} candles`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.95,
        metadata: {
          type: 'scheduled',
          rsi: Math.round(currentRSI * 100) / 100,
        },
      };
    }

    return null;
  }
}
