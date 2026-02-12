import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { indicatorsService } from '../services/indicators.service.js';

export class DCAStrategy extends BaseStrategy {
  constructor(config?: Record<string, number>) {
    super('DCA', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      intervalCandles: 24,
      dipThresholdPct: 5,
      dipMultiplier: 2,
      rsiOversold: 30,
      rsiPeriod: 14,
      maxPositions: 10,
      currentPositions: 0,
      takeProfitPct: 15,    // 15% 수익 시 매도
      stopLossPct: 10,      // 10% 손실 시 손절
      rsiOverbought: 75,    // RSI 과매수 시 매도 고려
      maxHoldCandles: 168,  // 최대 보유 기간 (7일 in 1h candles)
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const intervalCandles = cfg['intervalCandles'] ?? 24;
    const dipThresholdPct = cfg['dipThresholdPct'] ?? 5;
    const dipMultiplier = cfg['dipMultiplier'] ?? 2;
    const rsiOversold = cfg['rsiOversold'] ?? 30;
    const rsiPeriod = cfg['rsiPeriod'] ?? 14;
    const maxPositions = cfg['maxPositions'] ?? 10;
    const currentPositions = cfg['currentPositions'] ?? 0;

    if (data.length < rsiPeriod + 1) {
      return null;
    }

    // RSI 및 현재 캔들을 매도/매수 모두에서 사용하므로 먼저 계산
    const currentCandle = data[data.length - 1]!;
    const closes = data.map((d) => d.close);
    const rsiValues = indicatorsService.calculateRSI(closes, rsiPeriod);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : 50;

    // === 매도 조건 체크 (포지션 보유 시) ===
    const hasPosition = (cfg['_hasPosition'] ?? 0) === 1;
    const avgEntryPrice = cfg['_avgEntryPrice'] ?? 0;
    const unrealizedPnlPct = cfg['_unrealizedPnlPct'] ?? 0;
    const holdingCandles = cfg['_holdingCandles'] ?? 0;
    const takeProfitPct = cfg['takeProfitPct'] ?? 15;
    const stopLossPct = cfg['stopLossPct'] ?? 10;
    const rsiOverbought = cfg['rsiOverbought'] ?? 75;
    const maxHoldCandles = cfg['maxHoldCandles'] ?? 168;

    if (hasPosition && avgEntryPrice > 0) {
      // 1. 익절: 목표 수익률 도달
      if (unrealizedPnlPct >= takeProfitPct) {
        return {
          action: 'sell',
          confidence: 0.9,
          reason: `DCA take profit: +${unrealizedPnlPct.toFixed(1)}% (target: ${takeProfitPct}%)`,
          price: currentCandle.close,
          metadata: {
            type: 'take_profit',
            pnlPct: Math.round(unrealizedPnlPct * 100) / 100,
            avgEntry: Math.round(avgEntryPrice * 100) / 100,
          },
        };
      }

      // 2. 손절: 손실 한도 초과
      if (unrealizedPnlPct <= -stopLossPct) {
        return {
          action: 'sell',
          confidence: 0.85,
          reason: `DCA stop loss: ${unrealizedPnlPct.toFixed(1)}% (limit: -${stopLossPct}%)`,
          price: currentCandle.close,
          metadata: {
            type: 'stop_loss',
            pnlPct: Math.round(unrealizedPnlPct * 100) / 100,
            avgEntry: Math.round(avgEntryPrice * 100) / 100,
          },
        };
      }

      // 3. RSI 과매수 + 수익 중이면 매도
      if (currentRSI > rsiOverbought && unrealizedPnlPct > 3) {
        return {
          action: 'sell',
          confidence: 0.7,
          reason: `DCA RSI overbought exit: RSI=${currentRSI.toFixed(1)}, PnL=+${unrealizedPnlPct.toFixed(1)}%`,
          price: currentCandle.close,
          metadata: {
            type: 'rsi_exit',
            rsi: Math.round(currentRSI * 100) / 100,
            pnlPct: Math.round(unrealizedPnlPct * 100) / 100,
          },
        };
      }

      // 4. 최대 보유 기간 초과 + 수익 중이면 매도
      if (holdingCandles >= maxHoldCandles && unrealizedPnlPct > 0) {
        return {
          action: 'sell',
          confidence: 0.65,
          reason: `DCA max hold exit: ${holdingCandles} candles, PnL=+${unrealizedPnlPct.toFixed(1)}%`,
          price: currentCandle.close,
          metadata: {
            type: 'time_exit',
            holdingCandles,
            pnlPct: Math.round(unrealizedPnlPct * 100) / 100,
          },
        };
      }
    }

    // === 매수 조건 체크 ===
    if (currentPositions >= maxPositions) {
      return null;
    }

    const recentHigh = Math.max(...data.slice(-intervalCandles).map((d) => d.high));
    const dipPct = recentHigh > 0
      ? ((recentHigh - currentCandle.close) / recentHigh) * 100
      : 0;

    const isDip = dipPct >= dipThresholdPct;
    const isRSIOversold = currentRSI < rsiOversold;

    // holdingCandles === 0 이면 포지션 없음 → 정기 매수 가능
    const candlesSinceLastBuy = data.length - 1;
    const isScheduledBuy = candlesSinceLastBuy >= intervalCandles || holdingCandles === 0;

    if (isDip && isRSIOversold) {
      return {
        action: 'buy',
        confidence: 0.85,
        reason: `DCA dip buy: price dropped ${dipPct.toFixed(1)}% from recent high, RSI=${currentRSI.toFixed(1)}`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.9,
        metadata: {
          type: 'dip_buy',
          dipPct: Math.round(dipPct * 100) / 100,
          rsi: Math.round(currentRSI * 100) / 100,
          multiplier: dipMultiplier,
        },
      };
    }

    if (isDip) {
      return {
        action: 'buy',
        confidence: 0.7,
        reason: `DCA dip buy: price dropped ${dipPct.toFixed(1)}% from recent high`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.92,
        metadata: {
          type: 'dip_buy',
          dipPct: Math.round(dipPct * 100) / 100,
          multiplier: dipMultiplier,
        },
      };
    }

    if (isScheduledBuy) {
      return {
        action: 'buy',
        confidence: 0.5,
        reason: `DCA scheduled buy at interval of ${intervalCandles} candles`,
        price: currentCandle.close,
        stopLoss: currentCandle.close * 0.95,
        metadata: {
          type: 'scheduled',
          rsi: Math.round(currentRSI * 100) / 100,
        },
      };
    }

    return null;
  }
}
