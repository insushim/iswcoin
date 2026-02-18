import { logger } from '../../utils/logger.js';
import { riskManager } from '../risk.service.js';
import type { TrackedPosition } from './types.js';

/**
 * OrderCalculator: 순수 계산 로직 (포지션 컨텍스트, SL/TP 체크, 주문 수량)
 */
export class OrderCalculator {
  /**
   * 전략에 전달할 포지션 컨텍스트 생성 (백테스터와 동일한 방식)
   */
  enrichConfigWithPosition(
    config: Record<string, number>,
    position: TrackedPosition | null,
    currentPrice: number
  ): Record<string, number> {
    const enriched = { ...config };

    if (position && position.isOpen) {
      enriched['_hasPosition'] = 1;
      enriched['_avgEntryPrice'] = position.entryPrice;
      enriched['_positionAmount'] = position.amount;
      enriched['_positionSide'] = position.side === 'long' ? 1 : -1;

      const pnl = position.side === 'long'
        ? (currentPrice - position.entryPrice) * position.amount
        : (position.entryPrice - currentPrice) * position.amount;
      const pnlPct = position.entryPrice > 0
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'long' ? 1 : -1)
        : 0;

      enriched['_unrealizedPnl'] = pnl;
      enriched['_unrealizedPnlPct'] = pnlPct;
    } else {
      enriched['_hasPosition'] = 0;
      enriched['_avgEntryPrice'] = 0;
      enriched['_positionAmount'] = 0;
      enriched['_positionSide'] = 0;
      enriched['_unrealizedPnl'] = 0;
      enriched['_unrealizedPnlPct'] = 0;
    }

    return enriched;
  }

  /**
   * 스탑로스/테이크프로핏 확인
   */
  checkStopLossTakeProfit(
    position: TrackedPosition,
    currentPrice: number
  ): { triggered: boolean; action: 'sell' | 'buy'; reason: string } | null {
    if (!position.isOpen) return null;

    const isLong = position.side === 'long';

    // 스탑로스 체크
    if (position.stopLossPrice) {
      const slTriggered = isLong
        ? currentPrice <= position.stopLossPrice
        : currentPrice >= position.stopLossPrice;

      if (slTriggered) {
        const lossPct = Math.abs((currentPrice - position.entryPrice) / position.entryPrice * 100);
        return {
          triggered: true,
          action: isLong ? 'sell' : 'buy',
          reason: `스탑로스 발동: ${currentPrice.toFixed(2)} (진입: ${position.entryPrice.toFixed(2)}, 손실: -${lossPct.toFixed(2)}%)`,
        };
      }
    }

    // 테이크프로핏 체크
    if (position.takeProfitPrice) {
      const tpTriggered = isLong
        ? currentPrice >= position.takeProfitPrice
        : currentPrice <= position.takeProfitPrice;

      if (tpTriggered) {
        const profitPct = Math.abs((currentPrice - position.entryPrice) / position.entryPrice * 100);
        return {
          triggered: true,
          action: isLong ? 'sell' : 'buy',
          reason: `테이크프로핏 달성: ${currentPrice.toFixed(2)} (진입: ${position.entryPrice.toFixed(2)}, 수익: +${profitPct.toFixed(2)}%)`,
        };
      }
    }

    return null;
  }

  /**
   * 리스크 관리 기반 동적 주문 수량 계산 (포지션 누적 상한 적용)
   */
  calculateOrderAmount(
    capital: number,
    entryPrice: number,
    atr: number,
    signal: { stopLoss?: number; confidence: number },
    currentPosition?: TrackedPosition | null
  ): number {
    if (entryPrice <= 0 || capital <= 0) return 0;

    const riskConfig = riskManager.getConfig();
    const riskPercent = Math.min(2, riskConfig.maxTradeRiskPercent);

    let orderAmount: number;

    // ATR 기반 포지션 사이징
    if (atr > 0) {
      const sizing = riskManager.calculateATRPositionSize(capital, riskPercent, entryPrice, atr);
      orderAmount = Math.max(0, sizing.positionSize);
    } else if (signal.stopLoss && signal.stopLoss > 0) {
      // ATR 없으면 고정 비율 사이징 (자본의 2% 리스크)
      const stopDistance = Math.abs(entryPrice - signal.stopLoss);
      if (stopDistance > 0) {
        const riskAmount = capital * (riskPercent / 100);
        orderAmount = riskAmount / stopDistance;
      } else {
        orderAmount = (capital * 0.05) / entryPrice;
      }
    } else {
      // Fallback: 자본의 5% 이내
      orderAmount = (capital * 0.05) / entryPrice;
    }

    // 포지션 누적 상한: 기존 포지션 + 신규 주문 <= maxPositionSizePercent
    if (currentPosition && currentPosition.isOpen) {
      const existingValue = currentPosition.amount * entryPrice;
      const newOrderValue = orderAmount * entryPrice;
      const maxPositionValue = capital * (riskConfig.maxPositionSizePercent / 100);

      if (existingValue + newOrderValue > maxPositionValue) {
        const remainingValue = Math.max(0, maxPositionValue - existingValue);
        const cappedAmount = remainingValue / entryPrice;
        if (cappedAmount <= 0) {
          logger.warn('Position size limit reached, cannot add more', {
            existingValue, maxPositionValue,
          });
          return 0;
        }
        logger.info('Order amount capped by position limit', {
          original: orderAmount, capped: cappedAmount, maxPositionValue,
        });
        orderAmount = cappedAmount;
      }
    }

    return orderAmount;
  }
}
