import { logger } from '../utils/logger.js';
import { indicatorsService, type OHLCVData } from './indicators.service.js';
import { exchangeService } from './exchange.service.js';
import type { Exchange } from 'ccxt';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface TimeframeTrend {
  timeframe: Timeframe;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  rsi: number;
  emaAlignment: 'bullish' | 'bearish' | 'mixed';
  supertrend: 'up' | 'down';
  macdSignal: 'bullish' | 'bearish' | 'neutral';
}

export interface MTFAnalysisResult {
  trends: TimeframeTrend[];
  consensus: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  consensusScore: number; // -100 ~ +100
  alignment: number; // 0-100 (타임프레임 정렬도)
  dominantTimeframe: Timeframe;
  tradingBias: 'long' | 'short' | 'wait';
  confidence: number; // 0-100
  timestamp: number;
}

// 타임프레임별 가중치 (높은 TF일수록 중요)
const TF_WEIGHTS: Record<Timeframe, number> = {
  '1m': 0.05,
  '5m': 0.10,
  '15m': 0.15,
  '1h': 0.25,
  '4h': 0.25,
  '1d': 0.20,
};

export class MultiTimeframeService {
  async analyze(
    exchange: Exchange,
    symbol: string,
    timeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']
  ): Promise<MTFAnalysisResult> {
    logger.info('Running multi-timeframe analysis', { symbol, timeframes });

    const trends: TimeframeTrend[] = [];

    for (const tf of timeframes) {
      try {
        const rawOhlcv = await exchangeService.getOHLCV(exchange, symbol, tf, 100);
        const ohlcv = indicatorsService.parseOHLCV(rawOhlcv as number[][]);

        if (ohlcv.length < 50) {
          logger.debug(`Insufficient data for ${tf}, skipping`);
          continue;
        }

        const trend = this.analyzeSingleTimeframe(ohlcv, tf);
        trends.push(trend);
      } catch (err) {
        logger.warn(`Failed to analyze ${tf}`, { symbol, error: String(err) });
      }
    }

    if (trends.length === 0) {
      return {
        trends: [],
        consensus: 'neutral',
        consensusScore: 0,
        alignment: 0,
        dominantTimeframe: '1h',
        tradingBias: 'wait',
        confidence: 0,
        timestamp: Date.now(),
      };
    }

    return this.buildConsensus(trends);
  }

  analyzeSingleTimeframe(ohlcv: OHLCVData[], timeframe: Timeframe): TimeframeTrend {
    const closes = ohlcv.map((d) => d.close);
    const highs = ohlcv.map((d) => d.high);
    const lows = ohlcv.map((d) => d.low);

    // RSI
    const rsiValues = indicatorsService.calculateRSI(closes, 14);
    const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : 50;

    // EMA 정렬 (20 vs 50)
    const ema20 = indicatorsService.calculateEMA(closes, 20);
    const ema50 = indicatorsService.calculateEMA(closes, 50);
    const lastEma20 = ema20.length > 0 ? ema20[ema20.length - 1]! : 0;
    const lastEma50 = ema50.length > 0 ? ema50[ema50.length - 1]! : 0;
    const lastClose = closes[closes.length - 1]!;

    let emaAlignment: TimeframeTrend['emaAlignment'] = 'mixed';
    if (lastClose > lastEma20 && lastEma20 > lastEma50) {
      emaAlignment = 'bullish';
    } else if (lastClose < lastEma20 && lastEma20 < lastEma50) {
      emaAlignment = 'bearish';
    }

    // Supertrend
    const st = indicatorsService.calculateSupertrend(highs, lows, closes, 10, 3);
    const lastST = st.length > 0 ? st[st.length - 1]! : { direction: 'up' as const };
    const supertrend = lastST.direction;

    // MACD
    const macd = indicatorsService.calculateMACD(closes);
    let macdSignal: TimeframeTrend['macdSignal'] = 'neutral';
    if (macd.length >= 2) {
      const curr = macd[macd.length - 1]!;
      const prev = macd[macd.length - 2]!;
      if ((curr.histogram ?? 0) > 0 && (curr.histogram ?? 0) > (prev.histogram ?? 0)) {
        macdSignal = 'bullish';
      } else if ((curr.histogram ?? 0) < 0 && (curr.histogram ?? 0) < (prev.histogram ?? 0)) {
        macdSignal = 'bearish';
      }
    }

    // 종합 방향 & 강도 계산
    let score = 0;
    let signals = 0;

    // RSI 신호
    if (rsi > 60) { score += 1; signals++; }
    else if (rsi < 40) { score -= 1; signals++; }
    else { signals++; }

    // EMA 정렬
    if (emaAlignment === 'bullish') { score += 1.5; signals++; }
    else if (emaAlignment === 'bearish') { score -= 1.5; signals++; }
    else { signals++; }

    // Supertrend
    if (supertrend === 'up') { score += 1; signals++; }
    else { score -= 1; signals++; }

    // MACD
    if (macdSignal === 'bullish') { score += 1; signals++; }
    else if (macdSignal === 'bearish') { score -= 1; signals++; }
    else { signals++; }

    const normalizedScore = signals > 0 ? (score / signals) * 100 : 0;
    const direction: TimeframeTrend['direction'] =
      normalizedScore > 20 ? 'bullish' : normalizedScore < -20 ? 'bearish' : 'neutral';
    const strength = Math.min(100, Math.abs(normalizedScore));

    return {
      timeframe,
      direction,
      strength,
      rsi,
      emaAlignment,
      supertrend,
      macdSignal,
    };
  }

  private buildConsensus(trends: TimeframeTrend[]): MTFAnalysisResult {
    // 가중 합산
    let weightedScore = 0;
    let totalWeight = 0;

    for (const trend of trends) {
      const weight = TF_WEIGHTS[trend.timeframe] ?? 0.1;
      const dirScore = trend.direction === 'bullish' ? 1 : trend.direction === 'bearish' ? -1 : 0;
      weightedScore += dirScore * trend.strength * weight;
      totalWeight += weight;
    }

    const consensusScore = totalWeight > 0
      ? Math.round((weightedScore / totalWeight))
      : 0;

    // 방향 일치도 (alignment)
    const bullishCount = trends.filter((t) => t.direction === 'bullish').length;
    const bearishCount = trends.filter((t) => t.direction === 'bearish').length;
    const maxSame = Math.max(bullishCount, bearishCount);
    const alignment = Math.round((maxSame / trends.length) * 100);

    // 합의
    let consensus: MTFAnalysisResult['consensus'];
    if (consensusScore > 50) consensus = 'strong_bullish';
    else if (consensusScore > 15) consensus = 'bullish';
    else if (consensusScore < -50) consensus = 'strong_bearish';
    else if (consensusScore < -15) consensus = 'bearish';
    else consensus = 'neutral';

    // 가장 영향력 있는 타임프레임
    let dominantTimeframe: Timeframe = '1h';
    let maxStrength = 0;
    for (const trend of trends) {
      const w = TF_WEIGHTS[trend.timeframe] ?? 0.1;
      const effective = trend.strength * w;
      if (effective > maxStrength) {
        maxStrength = effective;
        dominantTimeframe = trend.timeframe;
      }
    }

    // 매매 편향
    let tradingBias: MTFAnalysisResult['tradingBias'] = 'wait';
    if (consensus === 'strong_bullish' || (consensus === 'bullish' && alignment >= 70)) {
      tradingBias = 'long';
    } else if (consensus === 'strong_bearish' || (consensus === 'bearish' && alignment >= 70)) {
      tradingBias = 'short';
    }

    // 신뢰도: 정렬도 + 강도 기반
    const avgStrength = trends.reduce((s, t) => s + t.strength, 0) / trends.length;
    const confidence = Math.round((alignment * 0.6 + avgStrength * 0.4));

    logger.info('MTF analysis complete', {
      consensus,
      consensusScore,
      alignment,
      tradingBias,
      confidence,
    });

    return {
      trends,
      consensus,
      consensusScore,
      alignment,
      dominantTimeframe,
      tradingBias,
      confidence,
      timestamp: Date.now(),
    };
  }
}

export const multiTimeframeService = new MultiTimeframeService();
