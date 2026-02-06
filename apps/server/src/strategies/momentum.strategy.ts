import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class MomentumStrategy extends BaseStrategy {
  constructor(config?: Record<string, number>) {
    super('MOMENTUM', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      rsiPeriod: 14,
      rsiBuyThreshold: 40,
      rsiSellThreshold: 70,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      volumeMultiplier: 1.5,
      volumeLookback: 20,
      emaPeriod: 20,
      stopLossPct: 3,
      takeProfitPct: 6,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const rsiBuyThreshold = cfg['rsiBuyThreshold'] ?? 40;
    const rsiSellThreshold = cfg['rsiSellThreshold'] ?? 70;
    const macdFast = cfg['macdFast'] ?? 12;
    const macdSlow = cfg['macdSlow'] ?? 26;
    const macdSignal = cfg['macdSignal'] ?? 9;
    const volumeMultiplier = cfg['volumeMultiplier'] ?? 1.5;
    const volumeLookback = cfg['volumeLookback'] ?? 20;
    const emaPeriod = cfg['emaPeriod'] ?? 20;
    const stopLossPct = cfg['stopLossPct'] ?? 3;
    const takeProfitPct = cfg['takeProfitPct'] ?? 6;

    const minRequired = Math.max(macdSlow + macdSignal, volumeLookback, emaPeriod) + 2;
    if (data.length < minRequired) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume);
    const currentCandle = data[data.length - 1]!;
    const currentPrice = currentCandle.close;

    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const macdValues = indicatorsService.calculateMACD(closes, macdFast, macdSlow, macdSignal);
    const emaValues = indicatorsService.calculateEMA(closes, emaPeriod);

    if (rsiValues.length < 2 || macdValues.length < 2 || emaValues.length < 1) {
      return null;
    }

    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = rsiValues[rsiValues.length - 2]!;

    const currentMACD = macdValues[macdValues.length - 1]!;
    const prevMACD = macdValues[macdValues.length - 2]!;

    const currentEMA = emaValues[emaValues.length - 1]!;

    const recentVolumes = volumes.slice(-volumeLookback);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const currentVolume = currentCandle.volume;
    const volumeConfirmed = currentVolume >= avgVolume * volumeMultiplier;

    const macdCrossUp =
      currentMACD.MACD !== undefined &&
      currentMACD.signal !== undefined &&
      prevMACD.MACD !== undefined &&
      prevMACD.signal !== undefined &&
      prevMACD.MACD <= prevMACD.signal &&
      currentMACD.MACD > currentMACD.signal;

    const macdCrossDown =
      currentMACD.MACD !== undefined &&
      currentMACD.signal !== undefined &&
      prevMACD.MACD !== undefined &&
      prevMACD.signal !== undefined &&
      prevMACD.MACD >= prevMACD.signal &&
      currentMACD.MACD < currentMACD.signal;

    const macdHistogram = currentMACD.histogram ?? 0;
    const macdBullish = macdHistogram > 0;
    const macdBearish = macdHistogram < 0;

    const rsiRising = currentRSI > prevRSI;
    const rsiFalling = currentRSI < prevRSI;
    const rsiInBuyZone = currentRSI < rsiBuyThreshold && rsiRising;
    const rsiInSellZone = currentRSI > rsiSellThreshold && rsiFalling;

    const aboveEMA = currentPrice > currentEMA;
    const belowEMA = currentPrice < currentEMA;

    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    if (macdCrossUp) {
      buyScore += 30;
      buyReasons.push('MACD cross up');
    } else if (macdBullish) {
      buyScore += 15;
      buyReasons.push('MACD bullish');
    }

    if (rsiInBuyZone) {
      buyScore += 25;
      buyReasons.push(`RSI rising from ${currentRSI.toFixed(1)}`);
    }

    if (aboveEMA) {
      buyScore += 20;
      buyReasons.push('Price above EMA');
    }

    if (volumeConfirmed) {
      buyScore += 25;
      buyReasons.push('Volume confirmed');
    }

    if (macdCrossDown) {
      sellScore += 30;
      sellReasons.push('MACD cross down');
    } else if (macdBearish) {
      sellScore += 15;
      sellReasons.push('MACD bearish');
    }

    if (rsiInSellZone) {
      sellScore += 25;
      sellReasons.push(`RSI falling from ${currentRSI.toFixed(1)}`);
    }

    if (belowEMA) {
      sellScore += 20;
      sellReasons.push('Price below EMA');
    }

    if (volumeConfirmed && sellScore > 0) {
      sellScore += 25;
      sellReasons.push('Volume confirmed');
    }

    if (buyScore >= 60) {
      return {
        action: 'buy',
        confidence: Math.min(buyScore / 100, 0.95),
        reason: `Momentum BUY: ${buyReasons.join(', ')}`,
        price: currentPrice,
        stopLoss: currentPrice * (1 - stopLossPct / 100),
        takeProfit: currentPrice * (1 + takeProfitPct / 100),
        metadata: {
          rsi: Math.round(currentRSI * 100) / 100,
          macdHistogram: Math.round(macdHistogram * 10000) / 10000,
          volumeRatio: Math.round((currentVolume / avgVolume) * 100) / 100,
          score: buyScore,
        },
      };
    }

    if (sellScore >= 60) {
      return {
        action: 'sell',
        confidence: Math.min(sellScore / 100, 0.95),
        reason: `Momentum SELL: ${sellReasons.join(', ')}`,
        price: currentPrice,
        metadata: {
          rsi: Math.round(currentRSI * 100) / 100,
          macdHistogram: Math.round(macdHistogram * 10000) / 10000,
          volumeRatio: Math.round((currentVolume / avgVolume) * 100) / 100,
          score: sellScore,
        },
      };
    }

    return null;
  }
}
