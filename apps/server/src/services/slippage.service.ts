import { logger } from '../utils/logger.js';

/**
 * 동적 슬리피지 모델
 * ATR(변동성) + 거래량 + 주문 크기를 기반으로 현실적인 슬리피지 계산
 */
export class SlippageService {
  /**
   * @param baseSlippagePct - 기본 슬리피지 (기본 0.0005 = 0.05%)
   * @param currentATR - 현재 ATR 값
   * @param currentPrice - 현재 가격
   * @param currentVolume - 현재 캔들 거래량
   * @param avgVolume - 평균 거래량 (lookback 기간)
   * @param orderSizeUSD - 주문 규모 (USD)
   */
  calculateDynamicSlippage(
    baseSlippagePct: number,
    currentATR: number,
    currentPrice: number,
    currentVolume: number,
    avgVolume: number,
    orderSizeUSD: number
  ): number {
    // 1. 기본 슬리피지
    let slippage = baseSlippagePct;

    // 2. ATR 기반 변동성 컴포넌트: 변동성 높을수록 슬리피지 증가
    if (currentPrice > 0 && currentATR > 0) {
      const atrPct = currentATR / currentPrice;
      slippage += atrPct * 0.1; // ATR의 10%를 추가 슬리피지로
    }

    // 3. 거래량 영향: 거래량 낮을수록 슬리피지 증가
    if (avgVolume > 0) {
      const volumeRatio = currentVolume / avgVolume;
      if (volumeRatio < 0.3) {
        slippage *= 3.0; // 매우 낮은 거래량
      } else if (volumeRatio < 0.5) {
        slippage *= 2.0; // 낮은 거래량
      } else if (volumeRatio < 1.0) {
        slippage *= 1.3; // 평균 이하
      }
      // 높은 거래량이면 슬리피지 감소 없음 (보수적 모델)
    }

    // 4. 시장 충격: 주문 크기가 클수록 슬리피지 증가
    const avgCandleValueUSD = avgVolume * currentPrice;
    if (avgCandleValueUSD > 0) {
      const impactRatio = orderSizeUSD / avgCandleValueUSD;
      // 주문이 평균 캔들 거래대금의 N%일 때 추가 슬리피지
      slippage += impactRatio * 0.005; // 0.5% per 100% of avg candle value
    }

    // 5. 상한: 최대 2% (극단적 상황)
    const finalSlippage = Math.min(slippage, 0.02);

    logger.debug('Dynamic slippage calculated', {
      base: baseSlippagePct,
      final: finalSlippage,
      atr: currentATR,
      volumeRatio: avgVolume > 0 ? currentVolume / avgVolume : 0,
      orderImpact: avgCandleValueUSD > 0 ? orderSizeUSD / avgCandleValueUSD : 0,
    });

    return finalSlippage;
  }

  /**
   * OHLCV 데이터에서 슬리피지 계산에 필요한 통계 추출
   */
  extractSlippageInputs(
    data: { high: number; low: number; close: number; volume: number }[],
    atrPeriod: number = 14,
    volumeLookback: number = 20
  ): { currentATR: number; avgVolume: number } {
    if (data.length < atrPeriod + 1) {
      return { currentATR: 0, avgVolume: 0 };
    }

    // Simple ATR calculation (without importing full indicators service to avoid circular deps)
    const trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const high = data[i]!.high;
      const low = data[i]!.low;
      const prevClose = data[i - 1]!.close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // ATR = SMA of last atrPeriod true ranges
    const recentTR = trueRanges.slice(-atrPeriod);
    const currentATR = recentTR.length > 0
      ? recentTR.reduce((a, b) => a + b, 0) / recentTR.length
      : 0;

    // Average volume
    const recentVolumes = data.slice(-volumeLookback).map(d => d.volume);
    const avgVolume = recentVolumes.length > 0
      ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
      : 0;

    return { currentATR, avgVolume };
  }
}

export const slippageService = new SlippageService();
