import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

/**
 * Scalping Strategy
 * - 초단타 매매: 작은 가격 변동에서 반복적으로 수익 실현
 * - EMA 크로스 + RSI + 볼린저 밴드 + 거래량 급등 + VWAP
 * - ATR 기반 동적 손절/익절
 */
export class ScalpingStrategy extends BaseStrategy {
  constructor(config?: Record<string, number>) {
    super('SCALPING', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      emaFast: 5,
      emaSlow: 13,
      rsiPeriod: 7,
      rsiBuyThreshold: 35,
      rsiSellThreshold: 65,
      bbPeriod: 15,
      bbStdDev: 2,
      atrPeriod: 10,
      atrTpMultiplier: 1.5,
      atrSlMultiplier: 1.0,
      volumeSpikeRatio: 2.0,
      volumeLookback: 10,
      vwapEnabled: 1,
      maxSpreadPct: 0.3,
      minADX: 20,
      stopLossPct: 0.5,
      takeProfitPct: 1.0,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const emaFast = cfg['emaFast'] ?? 5;
    const emaSlow = cfg['emaSlow'] ?? 13;
    const rsiPeriod = cfg['rsiPeriod'] ?? 7;
    const rsiBuyThreshold = cfg['rsiBuyThreshold'] ?? 35;
    const rsiSellThreshold = cfg['rsiSellThreshold'] ?? 65;
    const bbPeriod = cfg['bbPeriod'] ?? 15;
    const bbStdDev = cfg['bbStdDev'] ?? 2;
    const atrPeriod = cfg['atrPeriod'] ?? 10;
    const atrTpMultiplier = cfg['atrTpMultiplier'] ?? 1.5;
    const atrSlMultiplier = cfg['atrSlMultiplier'] ?? 1.0;
    const volumeSpikeRatio = cfg['volumeSpikeRatio'] ?? 2.0;
    const volumeLookback = cfg['volumeLookback'] ?? 10;
    const vwapEnabled = cfg['vwapEnabled'] ?? 1;
    const minADX = cfg['minADX'] ?? 20;
    const stopLossPct = cfg['stopLossPct'] ?? 0.5;
    const takeProfitPct = cfg['takeProfitPct'] ?? 1.0;

    const minRequired = Math.max(emaSlow, bbPeriod, atrPeriod * 2, volumeLookback, rsiPeriod) + 5;
    if (data.length < minRequired) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const volumes = data.map((d) => d.volume);
    const currentCandle = data[data.length - 1]!;
    const prevCandle = data[data.length - 2]!;
    const currentPrice = currentCandle.close;

    // 지표 계산
    const emaFastValues = indicatorsService.calculateEMA(closes, emaFast);
    const emaSlowValues = indicatorsService.calculateEMA(closes, emaSlow);
    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const bbValues = indicatorsService.calculateBollingerBands(closes, bbPeriod, bbStdDev);
    const atrValues = indicatorsService.calculateATR(highs, lows, closes, atrPeriod);
    const adxValues = indicatorsService.calculateADX(highs, lows, closes, 14);

    if (
      emaFastValues.length < 2 ||
      emaSlowValues.length < 2 ||
      rsiValues.length < 2 ||
      bbValues.length < 1 ||
      atrValues.length < 1
    ) {
      return null;
    }

    const currentEmaFast = emaFastValues[emaFastValues.length - 1]!;
    const prevEmaFast = emaFastValues[emaFastValues.length - 2]!;
    const currentEmaSlow = emaSlowValues[emaSlowValues.length - 1]!;
    const prevEmaSlow = emaSlowValues[emaSlowValues.length - 2]!;

    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = rsiValues[rsiValues.length - 2]!;

    const currentBB = bbValues[bbValues.length - 1]!;
    const currentATR = atrValues[atrValues.length - 1]!;

    const currentADX = adxValues.length > 0 ? adxValues[adxValues.length - 1]!.adx : 0;

    // VWAP
    let aboveVWAP = true;
    let belowVWAP = true;
    if (vwapEnabled) {
      const vwapValues = indicatorsService.calculateVWAP(highs, lows, closes, volumes);
      if (vwapValues.length > 0) {
        const currentVWAP = vwapValues[vwapValues.length - 1]!;
        aboveVWAP = currentPrice > currentVWAP;
        belowVWAP = currentPrice < currentVWAP;
      }
    }

    // 거래량 분석
    const recentVolumes = volumes.slice(-volumeLookback);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const currentVolume = currentCandle.volume;
    const volumeSpike = currentVolume >= avgVolume * volumeSpikeRatio;
    const volumeAboveAvg = currentVolume >= avgVolume;

    // EMA 크로스
    const emaCrossUp = prevEmaFast <= prevEmaSlow && currentEmaFast > currentEmaSlow;
    const emaCrossDown = prevEmaFast >= prevEmaSlow && currentEmaFast < currentEmaSlow;
    const emaAbove = currentEmaFast > currentEmaSlow;
    const emaBelow = currentEmaFast < currentEmaSlow;

    // 캔들 패턴: bullish/bearish engulfing
    const isBullishEngulfing =
      prevCandle.close < prevCandle.open &&
      currentCandle.close > currentCandle.open &&
      currentCandle.close > prevCandle.open &&
      currentCandle.open < prevCandle.close;

    const isBearishEngulfing =
      prevCandle.close > prevCandle.open &&
      currentCandle.close < currentCandle.open &&
      currentCandle.close < prevCandle.open &&
      currentCandle.open > prevCandle.close;

    // 볼린저 밴드 위치
    const bbWidth = currentBB.upper - currentBB.lower;
    const priceNearLowerBB = bbWidth > 0 && (currentPrice - currentBB.lower) / bbWidth < 0.15;
    const priceNearUpperBB = bbWidth > 0 && (currentBB.upper - currentPrice) / bbWidth < 0.15;

    // ADX 필터 (추세 강도)
    const trendStrong = currentADX >= minADX;

    // 스코어링
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    // EMA 크로스 시그널
    if (emaCrossUp) {
      buyScore += 30;
      buyReasons.push('EMA cross up');
    } else if (emaAbove) {
      buyScore += 10;
    }

    if (emaCrossDown) {
      sellScore += 30;
      sellReasons.push('EMA cross down');
    } else if (emaBelow) {
      sellScore += 10;
    }

    // RSI
    if (currentRSI < rsiBuyThreshold && currentRSI > prevRSI) {
      buyScore += 20;
      buyReasons.push(`RSI bounce (${currentRSI.toFixed(1)})`);
    }
    if (currentRSI > rsiSellThreshold && currentRSI < prevRSI) {
      sellScore += 20;
      sellReasons.push(`RSI overbought (${currentRSI.toFixed(1)})`);
    }

    // 볼린저 밴드
    if (priceNearLowerBB) {
      buyScore += 20;
      buyReasons.push('Price near lower BB');
    }
    if (priceNearUpperBB) {
      sellScore += 20;
      sellReasons.push('Price near upper BB');
    }

    // 거래량
    if (volumeSpike) {
      buyScore += 15;
      sellScore += 15;
      buyReasons.push('Volume spike');
      sellReasons.push('Volume spike');
    } else if (volumeAboveAvg) {
      buyScore += 5;
      sellScore += 5;
    }

    // VWAP
    if (vwapEnabled) {
      if (aboveVWAP) {
        buyScore += 10;
        buyReasons.push('Above VWAP');
      }
      if (belowVWAP) {
        sellScore += 10;
        sellReasons.push('Below VWAP');
      }
    }

    // 캔들 패턴
    if (isBullishEngulfing) {
      buyScore += 15;
      buyReasons.push('Bullish engulfing');
    }
    if (isBearishEngulfing) {
      sellScore += 15;
      sellReasons.push('Bearish engulfing');
    }

    // ADX 보너스
    if (trendStrong) {
      buyScore += 5;
      sellScore += 5;
    }

    // ATR 기반 동적 SL/TP
    const dynamicSL = currentATR > 0
      ? currentPrice - currentATR * atrSlMultiplier
      : currentPrice * (1 - stopLossPct / 100);
    const dynamicTP = currentATR > 0
      ? currentPrice + currentATR * atrTpMultiplier
      : currentPrice * (1 + takeProfitPct / 100);

    if (buyScore >= 55) {
      return {
        action: 'buy',
        confidence: Math.min(buyScore / 100, 0.95),
        reason: `Scalping BUY: ${buyReasons.join(', ')}`,
        price: currentPrice,
        stopLoss: dynamicSL,
        takeProfit: dynamicTP,
        metadata: {
          rsi: Math.round(currentRSI * 100) / 100,
          emaFast: Math.round(currentEmaFast * 100) / 100,
          emaSlow: Math.round(currentEmaSlow * 100) / 100,
          atr: Math.round(currentATR * 100) / 100,
          adx: Math.round(currentADX * 100) / 100,
          volumeRatio: Math.round((currentVolume / avgVolume) * 100) / 100,
          score: buyScore,
        },
      };
    }

    if (sellScore >= 55) {
      return {
        action: 'sell',
        confidence: Math.min(sellScore / 100, 0.95),
        reason: `Scalping SELL: ${sellReasons.join(', ')}`,
        price: currentPrice,
        metadata: {
          rsi: Math.round(currentRSI * 100) / 100,
          emaFast: Math.round(currentEmaFast * 100) / 100,
          emaSlow: Math.round(currentEmaSlow * 100) / 100,
          atr: Math.round(currentATR * 100) / 100,
          adx: Math.round(currentADX * 100) / 100,
          volumeRatio: Math.round((currentVolume / avgVolume) * 100) / 100,
          score: sellScore,
        },
      };
    }

    return null;
  }
}
