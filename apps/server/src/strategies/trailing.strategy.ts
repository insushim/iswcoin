import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class TrailingStrategy extends BaseStrategy {
  private inPosition: boolean = false;
  private entryPrice: number = 0;
  private highestSinceEntry: number = 0;

  constructor(config?: Record<string, number>) {
    super('TRAILING', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      atrPeriod: 14,
      atrMultiplier: 2.5,
      entryRSIThreshold: 40,
      rsiPeriod: 14,
      emaPeriod: 20,
      minTrailPct: 1,
      maxTrailPct: 8,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const atrPeriod = cfg['atrPeriod'] ?? 14;
    const atrMultiplier = cfg['atrMultiplier'] ?? 2.5;
    const entryRSIThreshold = cfg['entryRSIThreshold'] ?? 45;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const emaPeriod = cfg['emaPeriod'] ?? 20;
    const minTrailPct = cfg['minTrailPct'] ?? 1;
    const maxTrailPct = cfg['maxTrailPct'] ?? 8;

    const minRequired = Math.max(atrPeriod, rsiPeriod, emaPeriod) + 5;
    if (data.length < minRequired) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const currentCandle = data[data.length - 1]!;
    const currentPrice = currentCandle.close;

    const atrValues = indicatorsService.calculateATR(highs, lows, closes, atrPeriod);
    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const emaValues = indicatorsService.calculateEMA(closes, emaPeriod);

    if (atrValues.length < 1 || rsiValues.length < 2 || emaValues.length < 1) {
      return null;
    }

    const currentATR = atrValues[atrValues.length - 1]!;
    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = rsiValues[rsiValues.length - 2]!;
    const currentEMA = emaValues[emaValues.length - 1]!;

    if (this.inPosition) {
      if (currentCandle.high > this.highestSinceEntry) {
        this.highestSinceEntry = currentCandle.high;
      }

      const trailDistance = currentATR * atrMultiplier;
      let trailPct = (trailDistance / this.highestSinceEntry) * 100;
      trailPct = Math.max(minTrailPct, Math.min(maxTrailPct, trailPct));

      const trailingStopPrice = this.highestSinceEntry * (1 - trailPct / 100);

      if (currentPrice <= trailingStopPrice) {
        this.inPosition = false;
        const pnlPct = ((currentPrice - this.entryPrice) / this.entryPrice) * 100;

        return {
          action: 'sell',
          confidence: 0.9,
          reason: `Trailing stop triggered at ${trailingStopPrice.toFixed(2)} (trail: ${trailPct.toFixed(1)}%, PnL: ${pnlPct.toFixed(1)}%)`,
          price: currentPrice,
          metadata: {
            entryPrice: this.entryPrice,
            highestPrice: this.highestSinceEntry,
            trailingStopPrice: Math.round(trailingStopPrice * 100) / 100,
            trailPct: Math.round(trailPct * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
          },
        };
      }

      return null;
    }

    const aboveEMA = currentPrice > currentEMA;
    const rsiRecovering = currentRSI > prevRSI && currentRSI > entryRSIThreshold;
    const priceAbovePrevHigh = currentCandle.close > data[data.length - 2]!.high;

    // 3개 조건 중 2개 이상 충족 시 진입 (기존: 3개 모두 필요)
    const entryConditions = [aboveEMA, rsiRecovering, priceAbovePrevHigh].filter(Boolean).length;
    if (entryConditions >= 2) {
      this.inPosition = true;
      this.entryPrice = currentPrice;
      this.highestSinceEntry = currentCandle.high;

      const initialStop = currentPrice - currentATR * atrMultiplier;

      return {
        action: 'buy',
        confidence: 0.65,
        reason: `Trailing entry: price above EMA, RSI=${currentRSI.toFixed(1)} rising, breakout confirmed`,
        price: currentPrice,
        stopLoss: initialStop,
        metadata: {
          rsi: Math.round(currentRSI * 100) / 100,
          atr: Math.round(currentATR * 100) / 100,
          ema: Math.round(currentEMA * 100) / 100,
          initialStopDistance: Math.round((currentATR * atrMultiplier) * 100) / 100,
        },
      };
    }

    return null;
  }

  resetPosition(): void {
    this.inPosition = false;
    this.entryPrice = 0;
    this.highestSinceEntry = 0;
  }
}
