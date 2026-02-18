import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { exchangeService } from '../exchange.service.js';
import type { BotRunnerState, TrackedPosition } from './types.js';

/**
 * PositionManager: 포지션 추적, 오픈/클로즈, 거래소 대사
 */
export class PositionManager {
  constructor(private state: BotRunnerState) {}

  getPositionKey(botId: string, symbol: string): string {
    return `${botId}:${symbol}`;
  }

  getPosition(botId: string, symbol: string): TrackedPosition | null {
    return this.state.positions.get(this.getPositionKey(botId, symbol)) ?? null;
  }

  openPosition(
    botId: string,
    symbol: string,
    side: 'long' | 'short',
    price: number,
    amount: number,
    stopLoss?: number,
    takeProfit?: number
  ): TrackedPosition {
    const key = this.getPositionKey(botId, symbol);
    const existing = this.state.positions.get(key);

    if (existing && existing.isOpen && existing.side === side) {
      // 같은 방향 추가 매수 - 평균 진입가 업데이트
      const totalAmount = existing.amount + amount;
      const totalCost = existing.totalCost + price * amount;
      existing.amount = totalAmount;
      existing.totalCost = totalCost;
      existing.entryPrice = totalCost / totalAmount;
      existing.stopLossPrice = stopLoss ?? existing.stopLossPrice;
      existing.takeProfitPrice = takeProfit ?? existing.takeProfitPrice;
      return existing;
    }

    const position: TrackedPosition = {
      isOpen: true,
      side,
      entryPrice: price,
      amount,
      totalCost: price * amount,
      timestamp: Date.now(),
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit,
    };
    this.state.positions.set(key, position);
    return position;
  }

  closePosition(botId: string, symbol: string): TrackedPosition | null {
    const key = this.getPositionKey(botId, symbol);
    const position = this.state.positions.get(key);
    if (position) {
      position.isOpen = false;
      this.state.positions.delete(key);
    }
    return position ?? null;
  }

  /**
   * 포지션 대사: 거래소 실제 잔고 vs 내부 상태 비교 (REAL 모드 전용)
   */
  async reconcilePosition(
    botId: string,
    symbol: string,
    exchange: ReturnType<typeof exchangeService.initExchange>,
    _currentPrice: number
  ): Promise<void> {
    try {
      const balances = await exchangeService.getBalance(exchange);
      const [base] = symbol.split('/') as [string, string];
      const exchangeBalance = (balances[base] as { total?: number } | undefined)?.total ?? 0;

      const internalPosition = this.getPosition(botId, symbol);
      const internalAmount = internalPosition?.isOpen ? internalPosition.amount : 0;

      const diff = Math.abs(exchangeBalance - internalAmount);
      const diffPercent = internalAmount > 0 ? (diff / internalAmount) * 100 : (exchangeBalance > 0 ? 100 : 0);

      if (diffPercent >= 2) {
        logger.error('Position reconciliation mismatch', {
          botId, symbol,
          exchangeBalance, internalAmount,
          diffPercent: diffPercent.toFixed(2),
        });

        await prisma.botLog.create({
          data: {
            botId,
            level: 'ERROR',
            message: `포지션 불일치 감지: 거래소 ${exchangeBalance.toFixed(6)} vs 내부 ${internalAmount.toFixed(6)} (차이 ${diffPercent.toFixed(2)}%)`,
            data: { exchangeBalance, internalAmount, diffPercent, symbol } as Prisma.InputJsonValue,
          },
        }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
      } else {
        logger.debug('Position reconciliation OK', {
          botId, symbol, exchangeBalance, internalAmount,
        });
      }
    } catch (err) {
      logger.warn('Position reconciliation failed', { botId, symbol, error: String(err) });
    }
  }
}
