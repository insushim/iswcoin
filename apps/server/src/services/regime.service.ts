import { DetailedMarketRegime } from '@cryptosentinel/shared';
import { logger } from '../utils/logger.js';
import { indicatorsService, type OHLCVData } from './indicators.service.js';

/**
 * 마켓 레짐 분류 (DetailedMarketRegime from @cryptosentinel/shared)
 * - TRENDING_UP: 강한 상승 트렌드 (추세추종 전략 유리)
 * - TRENDING_DOWN: 강한 하락 트렌드 (숏/헤지 전략 유리)
 * - RANGING: 횡보 (평균회귀/그리드 전략 유리)
 * - VOLATILE: 높은 변동성 (포지션 축소, 스캘핑)
 * - QUIET: 낮은 변동성 (브레이크아웃 대기)
 */
export type MarketRegime = DetailedMarketRegime;

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number; // 0-100
  volatilityPercentile: number; // 현재 변동성이 역사적으로 어디 위치하는지 (0-100)
  trendStrength: number; // ADX 기반 (0-100)
  meanReversionScore: number; // 평균 회귀 가능성 (0-100)
  description: string;
  recommendedStrategies: string[];
  timestamp: number;
}

export interface RegimeTransition {
  from: MarketRegime;
  to: MarketRegime;
  probability: number;
  timestamp: number;
}

export class MarketRegimeService {
  private regimeHistory: { regime: MarketRegime; timestamp: number }[] = [];
  private readonly MAX_HISTORY = 500;

  detect(ohlcv: OHLCVData[]): RegimeResult {
    if (ohlcv.length < 50) {
      return this.defaultResult();
    }

    const closes = ohlcv.map((d) => d.close);
    const highs = ohlcv.map((d) => d.high);
    const lows = ohlcv.map((d) => d.low);

    // 1) ADX → 트렌드 강도
    const adxValues = indicatorsService.calculateADX(highs, lows, closes, 14);
    const lastADX = adxValues.length > 0 ? adxValues[adxValues.length - 1]! : { adx: 0, ppiDI: 0, mdi: 0 };
    const trendStrength = lastADX.adx;
    const bullishTrend = lastADX.ppiDI > lastADX.mdi;

    // 2) ATR 퍼센타일 → 변동성 위치
    const atrValues = indicatorsService.calculateATR(highs, lows, closes, 14);
    const volatilityPercentile = this.calculatePercentile(atrValues);

    // 3) 볼린저 밴드 너비 → 변동성 확인
    const bb = indicatorsService.calculateBollingerBands(closes, 20, 2);
    const lastBB = bb.length > 0 ? bb[bb.length - 1]! : null;
    const bbWidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle * 100 : 0;

    // 4) RSI → 과매수/과매도
    const rsiValues = indicatorsService.calculateRSI(closes, 14);
    const lastRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : 50;

    // 5) 평균 회귀 점수: 가격이 BB 중간에서 얼마나 벗어났는지
    let meanReversionScore = 0;
    if (lastBB) {
      const distFromMiddle = Math.abs(closes[closes.length - 1]! - lastBB.middle);
      const halfBand = (lastBB.upper - lastBB.lower) / 2;
      meanReversionScore = halfBand > 0 ? Math.min(100, (distFromMiddle / halfBand) * 100) : 0;
    }

    // 레짐 분류
    const regime = this.classifyRegime(trendStrength, bullishTrend, volatilityPercentile, bbWidth, lastRSI);

    // 신뢰도 계산
    const confidence = this.calculateConfidence(regime, trendStrength, volatilityPercentile);

    // 레짐 히스토리 추가
    this.addToHistory(regime);

    const result: RegimeResult = {
      regime,
      confidence,
      volatilityPercentile,
      trendStrength,
      meanReversionScore,
      description: this.getDescription(regime),
      recommendedStrategies: this.getRecommendedStrategies(regime),
      timestamp: Date.now(),
    };

    logger.info('Market regime detected', {
      regime,
      confidence,
      trendStrength: trendStrength.toFixed(1),
      volatilityPercentile: volatilityPercentile.toFixed(1),
    });

    return result;
  }

  private classifyRegime(
    adx: number,
    bullish: boolean,
    volPercentile: number,
    bbWidth: number,
    rsi: number
  ): MarketRegime {
    // 강한 트렌드: ADX > 25
    if (adx > 25) {
      // 높은 변동성 + 강한 트렌드 → VOLATILE
      if (volPercentile > 80) {
        return DetailedMarketRegime.VOLATILE;
      }
      return bullish ? DetailedMarketRegime.TRENDING_UP : DetailedMarketRegime.TRENDING_DOWN;
    }

    // 높은 변동성이지만 방향 없음
    if (volPercentile > 75 || bbWidth > 8) {
      return DetailedMarketRegime.VOLATILE;
    }

    // 매우 낮은 변동성
    if (volPercentile < 20 && bbWidth < 3) {
      return DetailedMarketRegime.QUIET;
    }

    // 나머지: 횡보
    return DetailedMarketRegime.RANGING;
  }

  private calculatePercentile(values: number[]): number {
    if (values.length < 2) return 50;

    const sorted = [...values].sort((a, b) => a - b);
    const lastValue = values[values.length - 1]!;
    const rank = sorted.findIndex((v) => v >= lastValue);

    return (rank / sorted.length) * 100;
  }

  private calculateConfidence(regime: MarketRegime, adx: number, volPercentile: number): number {
    switch (regime) {
      case DetailedMarketRegime.TRENDING_UP:
      case DetailedMarketRegime.TRENDING_DOWN:
        // ADX가 높을수록 트렌드 확신
        return Math.min(100, Math.round(adx * 2));
      case DetailedMarketRegime.VOLATILE:
        return Math.min(100, Math.round(volPercentile));
      case DetailedMarketRegime.QUIET:
        return Math.min(100, Math.round(100 - volPercentile));
      case DetailedMarketRegime.RANGING:
        // ADX 낮을수록 횡보 확신
        return Math.min(100, Math.round(100 - adx * 2));
    }
  }

  private getDescription(regime: MarketRegime): string {
    const descriptions: Record<MarketRegime, string> = {
      [DetailedMarketRegime.TRENDING_UP]: '강한 상승 추세. 추세추종(모멘텀, 트레일링) 전략이 유리합니다.',
      [DetailedMarketRegime.TRENDING_DOWN]: '강한 하락 추세. 숏 포지션이나 헤지 전략이 유리합니다.',
      [DetailedMarketRegime.RANGING]: '횡보 구간. 그리드, 평균회귀, 통계적 차익거래 전략이 유리합니다.',
      [DetailedMarketRegime.VOLATILE]: '높은 변동성. 포지션 사이즈를 줄이고 스캘핑이나 단타를 고려하세요.',
      [DetailedMarketRegime.QUIET]: '낮은 변동성. 브레이크아웃을 대기하거나 DCA 적립이 유리합니다.',
    };
    return descriptions[regime];
  }

  private getRecommendedStrategies(regime: MarketRegime): string[] {
    const strategies: Record<MarketRegime, string[]> = {
      [DetailedMarketRegime.TRENDING_UP]: ['MOMENTUM', 'TRAILING', 'DCA'],
      [DetailedMarketRegime.TRENDING_DOWN]: ['TRAILING', 'MEAN_REVERSION', 'GRID'],
      [DetailedMarketRegime.RANGING]: ['GRID', 'MEAN_REVERSION', 'STAT_ARB', 'SCALPING'],
      [DetailedMarketRegime.VOLATILE]: ['SCALPING', 'GRID', 'MARTINGALE'],
      [DetailedMarketRegime.QUIET]: ['DCA', 'GRID', 'STAT_ARB'],
    };
    return strategies[regime];
  }

  private addToHistory(regime: MarketRegime): void {
    this.regimeHistory.push({ regime, timestamp: Date.now() });
    if (this.regimeHistory.length > this.MAX_HISTORY) {
      this.regimeHistory = this.regimeHistory.slice(-this.MAX_HISTORY);
    }
  }

  /**
   * 레짐 전환 확률 행렬 (최근 히스토리 기반)
   */
  getTransitionProbabilities(): Map<MarketRegime, Map<MarketRegime, number>> {
    const transitions = new Map<MarketRegime, Map<MarketRegime, number>>();
    const regimes: MarketRegime[] = [
      DetailedMarketRegime.TRENDING_UP,
      DetailedMarketRegime.TRENDING_DOWN,
      DetailedMarketRegime.RANGING,
      DetailedMarketRegime.VOLATILE,
      DetailedMarketRegime.QUIET,
    ];

    for (const r of regimes) {
      transitions.set(r, new Map());
    }

    for (let i = 1; i < this.regimeHistory.length; i++) {
      const from = this.regimeHistory[i - 1]!.regime;
      const to = this.regimeHistory[i]!.regime;
      const counts = transitions.get(from)!;
      counts.set(to, (counts.get(to) ?? 0) + 1);
    }

    // 정규화
    for (const [from, counts] of transitions) {
      const total = Array.from(counts.values()).reduce((s, c) => s + c, 0);
      if (total > 0) {
        for (const [to, count] of counts) {
          counts.set(to, count / total);
        }
      }
    }

    return transitions;
  }

  getHistory(): { regime: MarketRegime; timestamp: number }[] {
    return [...this.regimeHistory];
  }

  private defaultResult(): RegimeResult {
    return {
      regime: DetailedMarketRegime.RANGING,
      confidence: 0,
      volatilityPercentile: 50,
      trendStrength: 0,
      meanReversionScore: 0,
      description: '데이터 부족으로 분석 불가',
      recommendedStrategies: ['DCA'],
      timestamp: Date.now(),
    };
  }
}

export const marketRegimeService = new MarketRegimeService();
