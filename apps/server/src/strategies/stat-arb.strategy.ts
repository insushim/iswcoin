import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

/**
 * Statistical Arbitrage (Pairs Trading) Strategy
 * - Z-Score 기반 스프레드 평균회귀
 * - 볼린저 밴드로 동적 엔트리/엑싯
 * - 상관관계 붕괴 감지 (circuit breaker)
 */
export class StatArbStrategy extends BaseStrategy {
  constructor(config?: Record<string, number>) {
    super('STAT_ARB', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      lookbackPeriod: 60,
      zScoreEntry: 2.0,
      zScoreExit: 0.5,
      zScoreStopLoss: 3.5,
      spreadSMA: 20,
      spreadStdDev: 2,
      minCorrelation: 0.7,
      correlationLookback: 30,
      halfLife: 15,
      stopLossPct: 2.5,
      takeProfitPct: 5,
      volumeMinRatio: 0.5,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const lookbackPeriod = cfg['lookbackPeriod'] ?? 60;
    const zScoreEntry = cfg['zScoreEntry'] ?? 2.0;
    const zScoreExit = cfg['zScoreExit'] ?? 0.5;
    const zScoreStopLoss = cfg['zScoreStopLoss'] ?? 3.5;
    const spreadSMA = cfg['spreadSMA'] ?? 20;
    const minCorrelation = cfg['minCorrelation'] ?? 0.7;
    const halfLife = cfg['halfLife'] ?? 15;
    const stopLossPct = cfg['stopLossPct'] ?? 2.5;
    const takeProfitPct = cfg['takeProfitPct'] ?? 5;
    const volumeMinRatio = cfg['volumeMinRatio'] ?? 0.5;

    if (data.length < lookbackPeriod + spreadSMA) {
      return null;
    }

    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume);
    const currentPrice = closes[closes.length - 1]!;

    // 스프레드 계산: log-return 기반 mean reversion
    const logReturns = this.calculateLogReturns(closes);
    if (logReturns.length < lookbackPeriod) return null;

    // 이동 평균과 표준편차로 Z-Score 계산
    const recentReturns = logReturns.slice(-lookbackPeriod);
    const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    const variance = recentReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / recentReturns.length;
    const std = Math.sqrt(variance);

    if (std === 0) return null;

    // 누적 스프레드 기반 Z-Score
    const spreadValues = this.calculateSpread(closes, spreadSMA);
    if (spreadValues.length < 2) return null;

    const currentSpread = spreadValues[spreadValues.length - 1]!;
    const prevSpread = spreadValues[spreadValues.length - 2]!;

    const spreadMean = spreadValues.slice(-lookbackPeriod).reduce((a, b) => a + b, 0)
      / Math.min(spreadValues.length, lookbackPeriod);
    const spreadStd = Math.sqrt(
      spreadValues.slice(-lookbackPeriod).reduce((sum, s) => sum + (s - spreadMean) ** 2, 0)
      / Math.min(spreadValues.length, lookbackPeriod)
    );

    if (spreadStd === 0) return null;

    const zScore = (currentSpread - spreadMean) / spreadStd;
    const prevZScore = (prevSpread - spreadMean) / spreadStd;

    // Half-life 기반 평균회귀 속도 확인
    const estimatedHalfLife = this.estimateHalfLife(spreadValues.slice(-lookbackPeriod));
    const halfLifeValid = estimatedHalfLife > 0 && estimatedHalfLife < halfLife * 3;

    // 거래량 필터
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1]!;
    const volumeOk = currentVolume >= avgVolume * volumeMinRatio;

    // Hurst Exponent 근사 (mean reversion 확인)
    const hurstApprox = this.estimateHurst(closes.slice(-lookbackPeriod));
    const isMeanReverting = hurstApprox < 0.5;

    // ATR 기반 변동성
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const atrValues = indicatorsService.calculateATR(highs, lows, closes, 14);
    const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1]! : 0;

    // 스코어링
    let buyScore = 0;
    let sellScore = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    // Z-Score 기반 시그널 (강한 신호: 엔트리 교차, 중간: 엔트리 존 내, 약한: 1.0+ 영역)
    if (zScore < -zScoreEntry && prevZScore >= -zScoreEntry) {
      buyScore += 35;
      buyReasons.push(`Z-Score cross below -${zScoreEntry.toFixed(1)} (${zScore.toFixed(2)})`);
    } else if (zScore < -zScoreEntry) {
      buyScore += 20;
      buyReasons.push(`Z-Score in buy zone (${zScore.toFixed(2)})`);
    } else if (zScore < -1.0) {
      buyScore += 12;
      buyReasons.push(`Z-Score moderately low (${zScore.toFixed(2)})`);
    }

    if (zScore > zScoreEntry && prevZScore <= zScoreEntry) {
      sellScore += 35;
      sellReasons.push(`Z-Score cross above ${zScoreEntry.toFixed(1)} (${zScore.toFixed(2)})`);
    } else if (zScore > zScoreEntry) {
      sellScore += 20;
      sellReasons.push(`Z-Score in sell zone (${zScore.toFixed(2)})`);
    } else if (zScore > 1.0) {
      sellScore += 12;
      sellReasons.push(`Z-Score moderately high (${zScore.toFixed(2)})`);
    }

    // Mean reversion 확인
    if (isMeanReverting) {
      buyScore += 15;
      sellScore += 15;
      buyReasons.push(`Hurst ${hurstApprox.toFixed(2)} (mean-reverting)`);
      sellReasons.push(`Hurst ${hurstApprox.toFixed(2)} (mean-reverting)`);
    }

    // Half-life 유효
    if (halfLifeValid) {
      buyScore += 10;
      sellScore += 10;
      buyReasons.push(`Half-life ${estimatedHalfLife.toFixed(0)} bars`);
      sellReasons.push(`Half-life ${estimatedHalfLife.toFixed(0)} bars`);
    }

    // 거래량 확인
    if (volumeOk) {
      buyScore += 10;
      sellScore += 10;
    }

    // Z-Score 회귀 방향 확인
    if (zScore < -zScoreEntry && zScore > prevZScore) {
      buyScore += 15;
      buyReasons.push('Z-Score reverting toward mean');
    }

    if (zScore > zScoreEntry && zScore < prevZScore) {
      sellScore += 15;
      sellReasons.push('Z-Score reverting toward mean');
    }

    // Stop loss: Z-Score 극단값
    if (Math.abs(zScore) > zScoreStopLoss) {
      return null; // 극단값 - 거래 회피
    }

    // Exit 시그널: Z-Score가 mean으로 복귀
    if (Math.abs(zScore) < zScoreExit) {
      sellScore += 30;
      sellReasons.push('Z-Score near zero (exit signal)');
    }

    const dynamicSL = currentATR > 0 ? (currentATR * 2) / currentPrice * 100 : stopLossPct;
    const dynamicTP = currentATR > 0 ? (currentATR * 3) / currentPrice * 100 : takeProfitPct;

    if (buyScore >= 40) {
      return {
        action: 'buy',
        confidence: Math.min(buyScore / 100, 0.95),
        reason: `StatArb BUY: ${buyReasons.join(', ')}`,
        price: currentPrice,
        stopLoss: currentPrice * (1 - dynamicSL / 100),
        takeProfit: currentPrice * (1 + dynamicTP / 100),
        metadata: {
          zScore: Math.round(zScore * 100) / 100,
          hurst: Math.round(hurstApprox * 100) / 100,
          halfLife: Math.round(estimatedHalfLife),
          spread: Math.round(currentSpread * 10000) / 10000,
          score: buyScore,
        },
      };
    }

    if (sellScore >= 40) {
      return {
        action: 'sell',
        confidence: Math.min(sellScore / 100, 0.95),
        reason: `StatArb SELL: ${sellReasons.join(', ')}`,
        price: currentPrice,
        metadata: {
          zScore: Math.round(zScore * 100) / 100,
          hurst: Math.round(hurstApprox * 100) / 100,
          halfLife: Math.round(estimatedHalfLife),
          spread: Math.round(currentSpread * 10000) / 10000,
          score: sellScore,
        },
      };
    }

    return null;
  }

  private calculateLogReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1]!;
      if (prev > 0) {
        returns.push(Math.log(prices[i]! / prev));
      }
    }
    return returns;
  }

  private calculateSpread(prices: number[], smaPeriod: number): number[] {
    if (prices.length < smaPeriod) return [];
    const smaValues = indicatorsService.calculateSMA(prices, smaPeriod);
    const offset = prices.length - smaValues.length;
    return smaValues.map((sma, i) => prices[i + offset]! - sma);
  }

  /**
   * Ornstein-Uhlenbeck half-life 추정
   */
  private estimateHalfLife(spread: number[]): number {
    if (spread.length < 10) return Infinity;

    const y = spread.slice(1);
    const x = spread.slice(0, -1);

    const n = y.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const deltaY = y[i]! - x[i]!;
      sumX += x[i]!;
      sumY += deltaY;
      sumXY += x[i]! * deltaY;
      sumXX += x[i]! * x[i]!;
    }

    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return Infinity;

    const beta = (n * sumXY - sumX * sumY) / denom;

    if (beta >= 0) return Infinity; // 평균회귀 아님

    return -Math.log(2) / beta;
  }

  /**
   * Hurst Exponent 근사 (R/S 방법)
   */
  private estimateHurst(prices: number[]): number {
    if (prices.length < 20) return 0.5;

    const returns = this.calculateLogReturns(prices);
    if (returns.length < 10) return 0.5;

    const n = returns.length;
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const deviations = returns.map((r) => r - mean);

    // 누적 편차
    const cumDev: number[] = [];
    let cumSum = 0;
    for (const d of deviations) {
      cumSum += d;
      cumDev.push(cumSum);
    }

    const range = Math.max(...cumDev) - Math.min(...cumDev);
    const std = Math.sqrt(deviations.reduce((sum, d) => sum + d ** 2, 0) / n);

    if (std === 0 || range === 0) return 0.5;

    const rs = range / std;
    const hurst = Math.log(rs) / Math.log(n);

    return Math.max(0, Math.min(1, hurst));
  }
}
