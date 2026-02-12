import {
  RSI,
  MACD,
  BollingerBands,
  ATR,
  EMA,
  SMA,
  Stochastic,
  ADX,
  OBV,
  VWAP,
} from 'technicalindicators';
import { logger } from '../utils/logger.js';

export interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorResults {
  rsi: number[];
  macd: { MACD?: number; signal?: number; histogram?: number }[];
  bollingerBands: { upper: number; middle: number; lower: number; pb: number }[];
  atr: number[];
  ema20: number[];
  ema50: number[];
  sma20: number[];
  sma50: number[];
  stochastic: { k: number; d: number }[];
  adx: { adx: number; ppiDI: number; mdi: number }[];
  obv: number[];
  vwap: number[];
  supertrend: { value: number; direction: 'up' | 'down' }[];
}

export class IndicatorsService {
  calculateRSI(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) {
      return [];
    }
    const result = RSI.calculate({ values: closes, period });
    return result;
  }

  calculateMACD(
    closes: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { MACD?: number; signal?: number; histogram?: number }[] {
    if (closes.length < slowPeriod + signalPeriod) {
      return [];
    }
    const result = MACD.calculate({
      values: closes,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    return result;
  }

  calculateBollingerBands(
    closes: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number; middle: number; lower: number; pb: number }[] {
    if (closes.length < period) {
      return [];
    }
    const result = BollingerBands.calculate({
      values: closes,
      period,
      stdDev,
    });
    // [FIX-6] %B: 각 데이터 포인트에 해당하는 종가 사용 (마지막 종가 고정 버그 수정)
    const offset = closes.length - result.length;
    return result.map((bb, i) => ({
      upper: bb.upper,
      middle: bb.middle,
      lower: bb.lower,
      pb: bb.upper !== bb.lower ? (closes[offset + i]! - bb.lower) / (bb.upper - bb.lower) : 0.5,
    }));
  }

  calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
    if (highs.length < period + 1) {
      return [];
    }
    const result = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });
    return result;
  }

  calculateEMA(closes: number[], period: number): number[] {
    if (closes.length < period) {
      return [];
    }
    const result = EMA.calculate({ values: closes, period });
    return result;
  }

  calculateSMA(closes: number[], period: number): number[] {
    if (closes.length < period) {
      return [];
    }
    const result = SMA.calculate({ values: closes, period });
    return result;
  }

  calculateStochastic(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14,
    signalPeriod: number = 3
  ): { k: number; d: number }[] {
    if (highs.length < period + signalPeriod) {
      return [];
    }
    const result = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
      signalPeriod,
    });
    return result;
  }

  calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): { adx: number; ppiDI: number; mdi: number }[] {
    if (highs.length < period * 2) {
      return [];
    }
    const result = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });
    return result.map((r) => ({
      adx: r.adx,
      ppiDI: r.pdi,
      mdi: r.mdi,
    }));
  }

  calculateOBV(closes: number[], volumes: number[]): number[] {
    if (closes.length < 2) {
      return [];
    }
    const result = OBV.calculate({
      close: closes,
      volume: volumes,
    });
    return result;
  }

  calculateVWAP(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[]
  ): number[] {
    if (closes.length < 1) {
      return [];
    }
    const result = VWAP.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: volumes,
    });
    return result;
  }

  calculateSupertrend(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 10,
    multiplier: number = 3
  ): { value: number; direction: 'up' | 'down' }[] {
    const atrValues = this.calculateATR(highs, lows, closes, period);

    if (atrValues.length === 0) {
      return [];
    }

    const offset = closes.length - atrValues.length;
    const results: { value: number; direction: 'up' | 'down' }[] = [];

    let prevUpperBand = 0;
    let prevLowerBand = 0;
    let prevSupertrend = 0;
    let prevDirection: 'up' | 'down' = 'up';

    for (let i = 0; i < atrValues.length; i++) {
      const idx = i + offset;
      const high = highs[idx]!;
      const low = lows[idx]!;
      const close = closes[idx]!;
      const atr = atrValues[i]!;

      const midPrice = (high + low) / 2;
      let upperBand = midPrice + multiplier * atr;
      let lowerBand = midPrice - multiplier * atr;

      if (i > 0) {
        const prevClose = closes[idx - 1]!;

        if (lowerBand > prevLowerBand || prevClose < prevLowerBand) {
          lowerBand = lowerBand;
        } else {
          lowerBand = prevLowerBand;
        }

        if (upperBand < prevUpperBand || prevClose > prevUpperBand) {
          upperBand = upperBand;
        } else {
          upperBand = prevUpperBand;
        }
      }

      let direction: 'up' | 'down';
      let supertrendValue: number;

      if (i === 0) {
        direction = close > upperBand ? 'up' : 'down';
        supertrendValue = direction === 'up' ? lowerBand : upperBand;
      } else {
        if (prevSupertrend === prevUpperBand) {
          direction = close > upperBand ? 'up' : 'down';
        } else {
          direction = close < lowerBand ? 'down' : 'up';
        }
        supertrendValue = direction === 'up' ? lowerBand : upperBand;
      }

      prevUpperBand = upperBand;
      prevLowerBand = lowerBand;
      prevSupertrend = supertrendValue;
      prevDirection = direction;

      results.push({ value: supertrendValue, direction });
    }

    return results;
  }

  getAllIndicators(ohlcvData: OHLCVData[]): IndicatorResults {
    const closes = ohlcvData.map((d) => d.close);
    const highs = ohlcvData.map((d) => d.high);
    const lows = ohlcvData.map((d) => d.low);
    const volumes = ohlcvData.map((d) => d.volume);

    logger.debug('Calculating all indicators', { dataPoints: ohlcvData.length });

    return {
      rsi: this.calculateRSI(closes),
      macd: this.calculateMACD(closes),
      bollingerBands: this.calculateBollingerBands(closes),
      atr: this.calculateATR(highs, lows, closes),
      ema20: this.calculateEMA(closes, 20),
      ema50: this.calculateEMA(closes, 50),
      sma20: this.calculateSMA(closes, 20),
      sma50: this.calculateSMA(closes, 50),
      stochastic: this.calculateStochastic(highs, lows, closes),
      adx: this.calculateADX(highs, lows, closes),
      obv: this.calculateOBV(closes, volumes),
      vwap: this.calculateVWAP(highs, lows, closes, volumes),
      supertrend: this.calculateSupertrend(highs, lows, closes),
    };
  }

  parseOHLCV(raw: number[][]): OHLCVData[] {
    return raw.map((candle) => ({
      timestamp: candle[0]!,
      open: candle[1]!,
      high: candle[2]!,
      low: candle[3]!,
      close: candle[4]!,
      volume: candle[5]!,
    }));
  }
}

export const indicatorsService = new IndicatorsService();
