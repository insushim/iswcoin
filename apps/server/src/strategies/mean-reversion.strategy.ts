import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class MeanReversionStrategy extends BaseStrategy {
  constructor(config?: Record<string, number>) {
    super('MEAN_REVERSION', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      bbPeriod: 20,
      bbStdDev: 2,
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      smaPeriod: 50,
      stopLossPct: 2.5,
      takeProfitPct: 4,
      confirmationCandles: 2,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const bbPeriod = cfg['bbPeriod'] ?? 20;
    const bbStdDev = cfg['bbStdDev'] ?? 2;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const rsiOversold = cfg['rsiOversold'] ?? 30;
    const rsiOverbought = cfg['rsiOverbought'] ?? 70;
    const smaPeriod = cfg['smaPeriod'] ?? 50;
    const stopLossPct = cfg['stopLossPct'] ?? 2.5;
    const takeProfitPct = cfg['takeProfitPct'] ?? 4;
    const confirmationCandles = cfg['confirmationCandles'] ?? 2;

    const minRequired = Math.max(bbPeriod, rsiPeriod, smaPeriod) + confirmationCandles + 2;
    if (data.length < minRequired) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const currentCandle = data[data.length - 1]!;
    const currentPrice = currentCandle.close;

    const bbValues = indicatorsService.calculateBollingerBands(closes, bbPeriod, bbStdDev);
    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const smaValues = indicatorsService.calculateSMA(closes, smaPeriod);

    if (bbValues.length < confirmationCandles + 1 || rsiValues.length < 2 || smaValues.length < 1) {
      return null;
    }

    const currentBB = bbValues[bbValues.length - 1]!;
    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = rsiValues[rsiValues.length - 2]!;
    const currentSMA = smaValues[smaValues.length - 1]!;

    const pctB = currentBB.upper !== currentBB.lower
      ? (currentPrice - currentBB.lower) / (currentBB.upper - currentBB.lower)
      : 0.5;

    const touchedLowerBand = currentPrice <= currentBB.lower * 1.015;
    const touchedUpperBand = currentPrice >= currentBB.upper * 0.985;

    let lowerBandBounce = false;
    if (touchedLowerBand) {
      let touchCount = 0;
      for (let i = 1; i <= confirmationCandles && i < data.length; i++) {
        const pastCandle = data[data.length - 1 - i]!;
        const pastBB = bbValues[bbValues.length - 1 - i];
        if (pastBB && pastCandle.low <= pastBB.lower * 1.01) {
          touchCount++;
        }
      }
      lowerBandBounce = touchCount >= 1;
    }

    let upperBandBounce = false;
    if (touchedUpperBand) {
      let touchCount = 0;
      for (let i = 1; i <= confirmationCandles && i < data.length; i++) {
        const pastCandle = data[data.length - 1 - i]!;
        const pastBB = bbValues[bbValues.length - 1 - i];
        if (pastBB && pastCandle.high >= pastBB.upper * 0.99) {
          touchCount++;
        }
      }
      upperBandBounce = touchCount >= 1;
    }

    const isOversold = currentRSI < rsiOversold;
    const isOverbought = currentRSI > rsiOverbought;
    const rsiReversingUp = isOversold && currentRSI > prevRSI;
    const rsiReversingDown = isOverbought && currentRSI < prevRSI;

    const nearSMA = Math.abs(currentPrice - currentSMA) / currentSMA < 0.02;
    const belowSMA = currentPrice < currentSMA;

    // RSI가 중립이지만 BB 하단 터치하고 RSI가 하락 후 반등 시작한 경우도 허용
    const rsiModerateUp = currentRSI < 45 && currentRSI > prevRSI;

    if ((touchedLowerBand || lowerBandBounce) && (rsiReversingUp || rsiModerateUp)) {
      const confidence = this.calculateConfidence(pctB, currentRSI, 'buy', nearSMA);
      const targetPrice = currentBB.middle;
      const effectiveTP = Math.max(
        currentPrice * (1 + takeProfitPct / 100),
        targetPrice
      );

      return {
        action: 'buy',
        confidence,
        reason: `Mean reversion BUY: BB lower band bounce (pctB=${pctB.toFixed(3)}), RSI reversing from ${currentRSI.toFixed(1)}`,
        price: currentPrice,
        stopLoss: currentPrice * (1 - stopLossPct / 100),
        takeProfit: effectiveTP,
        metadata: {
          pctB: Math.round(pctB * 1000) / 1000,
          rsi: Math.round(currentRSI * 100) / 100,
          bbLower: Math.round(currentBB.lower * 100) / 100,
          bbMiddle: Math.round(currentBB.middle * 100) / 100,
          bbUpper: Math.round(currentBB.upper * 100) / 100,
        },
      };
    }

    const rsiModerateDown = currentRSI > 55 && currentRSI < prevRSI;

    if ((touchedUpperBand || upperBandBounce) && (rsiReversingDown || rsiModerateDown)) {
      const confidence = this.calculateConfidence(1 - pctB, 100 - currentRSI, 'sell', nearSMA);

      return {
        action: 'sell',
        confidence,
        reason: `Mean reversion SELL: BB upper band rejection (pctB=${pctB.toFixed(3)}), RSI reversing from ${currentRSI.toFixed(1)}`,
        price: currentPrice,
        metadata: {
          pctB: Math.round(pctB * 1000) / 1000,
          rsi: Math.round(currentRSI * 100) / 100,
          bbLower: Math.round(currentBB.lower * 100) / 100,
          bbMiddle: Math.round(currentBB.middle * 100) / 100,
          bbUpper: Math.round(currentBB.upper * 100) / 100,
        },
      };
    }

    return null;
  }

  private calculateConfidence(
    bandDistance: number,
    rsi: number,
    side: 'buy' | 'sell',
    nearSMA: boolean
  ): number {
    let score = 0.4;

    if (side === 'buy') {
      if (bandDistance < 0) score += 0.2;
      if (rsi < 25) score += 0.15;
      else if (rsi < 30) score += 0.1;
    } else {
      if (bandDistance < 0) score += 0.2;
      if (rsi < 25) score += 0.15;
      else if (rsi < 30) score += 0.1;
    }

    if (nearSMA) score += 0.1;

    return Math.min(score, 0.95);
  }
}
