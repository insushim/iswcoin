import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { logger } from "../../utils/logger.js";
import { exchangeService } from "../exchange.service.js";
import type { BotRunnerState, TrackedPosition } from "./types.js";

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
    side: "long" | "short",
    price: number,
    amount: number,
    stopLoss?: number,
    takeProfit?: number,
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
   * 포지션 대사: 거래소 실제 잔고 vs 내부 상태 비교 + 자동 보정 (REAL 모드 전용)
   * H4: 불일치 시 거래소 기준으로 내부 상태 자동 보정
   */
  async reconcilePosition(
    botId: string,
    symbol: string,
    exchange: ReturnType<typeof exchangeService.initExchange>,
    currentPrice: number,
  ): Promise<void> {
    try {
      const balances = await exchangeService.getBalance(exchange);
      const [base] = symbol.split("/") as [string, string];
      const exchangeBalance =
        (balances[base] as { total?: number } | undefined)?.total ?? 0;

      const internalPosition = this.getPosition(botId, symbol);
      const internalAmount = internalPosition?.isOpen
        ? internalPosition.amount
        : 0;

      const diff = Math.abs(exchangeBalance - internalAmount);
      const diffPercent =
        internalAmount > 0
          ? (diff / internalAmount) * 100
          : exchangeBalance > 0
            ? 100
            : 0;

      if (diffPercent >= 2) {
        logger.error("Position reconciliation mismatch - auto-correcting", {
          botId,
          symbol,
          exchangeBalance,
          internalAmount,
          diffPercent: diffPercent.toFixed(2),
        });

        // H4: 거래소 기준으로 내부 포지션 자동 보정
        const key = this.getPositionKey(botId, symbol);
        if (exchangeBalance > 0) {
          const existing = this.state.positions.get(key);
          if (existing && existing.isOpen) {
            existing.amount = exchangeBalance;
            existing.totalCost = existing.entryPrice * exchangeBalance;
          } else {
            // 내부 포지션 없는데 거래소에 있음 → 현재가 기준 복원
            this.state.positions.set(key, {
              isOpen: true,
              side: "long",
              entryPrice: currentPrice > 0 ? currentPrice : 0,
              amount: exchangeBalance,
              totalCost:
                (currentPrice > 0 ? currentPrice : 0) * exchangeBalance,
              timestamp: Date.now(),
            });
          }
        } else if (internalPosition?.isOpen) {
          // 거래소에 포지션 없는데 내부에 있음 → 내부 삭제
          this.state.positions.delete(key);
        }

        // 보정 후 DB에도 저장
        await this.persistRealPosition(botId, symbol);

        await prisma.botLog
          .create({
            data: {
              botId,
              level: "WARN",
              message: `포지션 불일치 자동 보정: 거래소 ${exchangeBalance.toFixed(6)} vs 내부 ${internalAmount.toFixed(6)} → 거래소 기준 동기화`,
              data: {
                exchangeBalance,
                internalAmount,
                diffPercent,
                symbol,
                corrected: true,
              } as Prisma.InputJsonValue,
            },
          })
          .catch((err) =>
            logger.debug("Background task failed", { error: String(err) }),
          );
      } else {
        logger.debug("Position reconciliation OK", {
          botId,
          symbol,
          exchangeBalance,
          internalAmount,
        });
      }
    } catch (err) {
      logger.warn("Position reconciliation failed", {
        botId,
        symbol,
        error: String(err),
      });
    }
  }

  /**
   * H3: REAL 모드 포지션 DB 영속화 (크래시 복구용)
   */
  async persistRealPosition(botId: string, symbol: string): Promise<void> {
    const position = this.getPosition(botId, symbol);
    try {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { riskConfig: true },
      });
      const rc = (bot?.riskConfig as Record<string, unknown>) ?? {};
      await prisma.bot.update({
        where: { id: botId },
        data: {
          riskConfig: {
            ...rc,
            realPosition:
              position && position.isOpen
                ? {
                    symbol,
                    side: position.side,
                    entryPrice: position.entryPrice,
                    amount: position.amount,
                    totalCost: position.totalCost,
                    timestamp: position.timestamp,
                    stopLossPrice: position.stopLossPrice,
                    takeProfitPrice: position.takeProfitPrice,
                  }
                : null,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      logger.warn("Failed to persist real position", {
        botId,
        error: String(err),
      });
    }
  }

  /**
   * H3: 서버 재시작 시 REAL 포지션 복원
   */
  restoreRealPosition(
    botId: string,
    riskConfig: Record<string, unknown> | null,
  ): void {
    const saved = riskConfig?.realPosition as
      | {
          symbol: string;
          side: "long" | "short";
          entryPrice: number;
          amount: number;
          totalCost: number;
          timestamp: number;
          stopLossPrice?: number;
          takeProfitPrice?: number;
        }
      | null
      | undefined;

    if (saved && saved.amount > 0 && saved.entryPrice > 0) {
      const key = this.getPositionKey(botId, saved.symbol);
      this.state.positions.set(key, {
        isOpen: true,
        side: saved.side,
        entryPrice: saved.entryPrice,
        amount: saved.amount,
        totalCost: saved.totalCost,
        timestamp: saved.timestamp,
        stopLossPrice: saved.stopLossPrice,
        takeProfitPrice: saved.takeProfitPrice,
      });
      logger.info("Real position restored from DB", {
        botId,
        symbol: saved.symbol,
        amount: saved.amount,
        entryPrice: saved.entryPrice,
      });
    }
  }
}
