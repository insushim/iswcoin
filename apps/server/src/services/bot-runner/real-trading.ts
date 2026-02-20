import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { logger } from "../../utils/logger.js";
import {
  exchangeService,
  type SupportedExchange,
} from "../exchange.service.js";
import { riskManager } from "../risk.service.js";
import { executionService } from "../execution.service.js";
import { notificationService } from "../notification.service.js";
import type { TrackedPosition, TradeSignalInput } from "./types.js";
import { MIN_ORDER_VALUE_USDT } from "./types.js";
import type { PositionManager } from "./position-manager.js";
import type { OrderCalculator } from "./order-calculator.js";

/**
 * RealTradingService: 실거래 실행, SL/TP 청산
 */
export class RealTradingService {
  constructor(
    private positionManager: PositionManager,
    private orderCalculator: OrderCalculator,
  ) {}

  /**
   * REAL 거래 실행 (리스크 관리 통합)
   */
  async executeRealTrade(
    botId: string,
    symbol: string,
    exchange: ReturnType<typeof exchangeService.initExchange>,
    signal: TradeSignalInput,
    currentPrice: number,
    currentPosition: TrackedPosition | null,
    atr: number,
    userId: string,
  ): Promise<void> {
    // H1: 실제 잔고 조회 (REAL 모드: PAPER_INITIAL_BALANCE 폴백 제거)
    let capital = 0;
    try {
      const balances = await exchangeService.getBalance(exchange);
      const usdtBalance = balances["USDT"] as { total?: number } | undefined;
      capital = usdtBalance?.total ?? 0;
    } catch (err) {
      logger.warn("Failed to fetch balance, checking portfolio DB", {
        error: String(err),
      });
      const portfolio = await prisma.portfolio.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: { totalValue: true },
      });
      capital = portfolio?.totalValue ?? 0;
    }

    // BUY 시 잔고 0이면 거래 불가
    if (signal.action === "buy" && capital <= 0) {
      logger.warn("No capital available for real trade, skipping", { botId });
      return;
    }

    // 동적 주문 수량 계산 (포지션 누적 상한 적용)
    let orderAmount: number;
    if (signal.action === "sell" && currentPosition && currentPosition.isOpen) {
      orderAmount = currentPosition.amount;
    } else {
      orderAmount = this.orderCalculator.calculateOrderAmount(
        capital,
        currentPrice,
        atr,
        signal,
        currentPosition,
      );

      // 변동성 스케일링 적용
      if (atr > 0) {
        const volatility = (atr / currentPrice) * 100;
        orderAmount = riskManager.volatilityScaledSize(orderAmount, volatility);
      }

      // 최소 주문 금액 체크
      if (orderAmount * currentPrice < MIN_ORDER_VALUE_USDT) {
        logger.debug("Order value too small, skipping", {
          botId,
          value: orderAmount * currentPrice,
          min: MIN_ORDER_VALUE_USDT,
        });
        return;
      }
    }

    if (orderAmount <= 0) return;

    // 사전 유동성 검사 (REAL 모드)
    try {
      const orderBook = await exchangeService.getOrderBook(
        exchange,
        symbol,
        50,
      );
      const bids = orderBook.bids as [number, number][];
      const asks = orderBook.asks as [number, number][];

      const preCheck = executionService.preTradeCheck(
        bids,
        asks,
        signal.action as "buy" | "sell",
        orderAmount,
        currentPrice,
      );

      if (!preCheck.allowed) {
        logger.warn("Pre-trade check failed, skipping order", {
          botId,
          symbol,
          reason: preCheck.reason,
          estimatedSlippage: preCheck.estimatedSlippage,
        });
        await prisma.botLog
          .create({
            data: {
              botId,
              level: "WARN",
              message: `유동성 검사 실패: ${preCheck.reason}`,
            },
          })
          .catch((err) =>
            logger.debug("Background task failed", { error: String(err) }),
          );
        return;
      }

      // 최대 주문량으로 cap
      if (preCheck.maxSafeSize > 0 && orderAmount > preCheck.maxSafeSize) {
        logger.info("Order amount capped by liquidity", {
          original: orderAmount,
          capped: preCheck.maxSafeSize,
        });
        orderAmount = preCheck.maxSafeSize;
      }
    } catch (obErr) {
      logger.warn("Pre-trade check skipped (orderbook fetch failed)", {
        error: String(obErr),
      });
    }

    // H2: 멱등성 키 - 1분 단위 캔들 기반 (같은 봉에서 중복 주문 방지)
    const candleKey = Math.floor(Date.now() / 60000);
    const idempotencyKey = `${botId}:${signal.action}:${candleKey}`;

    try {
      // OrderRecord 생성 (PENDING 상태)
      const orderRecord = await prisma.orderRecord.create({
        data: {
          botId,
          symbol,
          side: signal.action === "buy" ? "BUY" : "SELL",
          type: "MARKET",
          requestedAmount: orderAmount,
          idempotencyKey,
          status: "PENDING",
        },
      });

      const order = await exchangeService.createOrder(
        exchange,
        symbol,
        signal.action as "buy" | "sell",
        "market",
        orderAmount,
        undefined,
        idempotencyKey,
      );

      // 체결 확인: fetchOrder로 폴링
      let confirmedOrder = order;
      try {
        confirmedOrder = await exchangeService.fetchOrder(
          exchange,
          order.id,
          symbol,
        );
      } catch (fetchErr) {
        logger.warn("fetchOrder failed, using initial order data", {
          orderId: order.id,
          error: String(fetchErr),
        });
      }

      const fillPrice =
        confirmedOrder.average ?? confirmedOrder.price ?? currentPrice;
      const filledAmount = confirmedOrder.filled ?? 0;
      const fee = confirmedOrder.fee?.cost ?? 0;

      // OrderRecord 업데이트
      const orderStatus =
        filledAmount <= 0
          ? "FAILED"
          : filledAmount < orderAmount
            ? "PARTIALLY_FILLED"
            : "FILLED";

      await prisma.orderRecord
        .update({
          where: { id: orderRecord.id },
          data: {
            exchangeOrderId: confirmedOrder.id,
            filledAmount,
            avgFillPrice: fillPrice,
            status: orderStatus as
              | "PENDING"
              | "PARTIALLY_FILLED"
              | "FILLED"
              | "CANCELLED"
              | "FAILED",
          },
        })
        .catch((err) =>
          logger.debug("Background task failed", { error: String(err) }),
        );

      // 체결 실패 (filled=0): 포지션 업데이트 안 함
      if (filledAmount <= 0) {
        logger.warn("Order not filled, skipping position update", {
          botId,
          orderId: confirmedOrder.id,
          status: confirmedOrder.status,
        });
        return;
      }

      // 부분 체결 경고
      if (filledAmount < orderAmount * 0.99) {
        logger.warn("Partial fill detected", {
          botId,
          requested: orderAmount,
          filled: filledAmount,
          fillRatio: ((filledAmount / orderAmount) * 100).toFixed(1) + "%",
        });
      }

      // 포지션 업데이트 (실제 체결량 사용)
      if (signal.action === "buy") {
        this.positionManager.openPosition(
          botId,
          symbol,
          "long",
          fillPrice,
          filledAmount,
          signal.stopLoss,
          signal.takeProfit,
        );
      } else {
        this.positionManager.closePosition(botId, symbol);
      }

      // H3: REAL 모드 포지션 DB 영속화
      this.positionManager
        .persistRealPosition(botId, symbol)
        .catch((err) =>
          logger.debug("Position persist failed", { error: String(err) }),
        );

      // PnL 계산 (매도 시)
      let realizedPnl: number | null = null;
      if (
        signal.action === "sell" &&
        currentPosition &&
        currentPosition.isOpen
      ) {
        realizedPnl =
          (fillPrice - currentPosition.entryPrice) * filledAmount - fee;
      }

      // TCA (Transaction Cost Analysis)
      const tca = executionService.calculateTCA(
        currentPrice,
        fillPrice,
        filledAmount,
        fee,
        signal.action as "buy" | "sell",
      );

      await prisma.trade.create({
        data: {
          botId,
          symbol,
          side: signal.action === "buy" ? "BUY" : "SELL",
          type: "MARKET",
          price: fillPrice,
          amount: filledAmount,
          fee,
          pnl: realizedPnl,
          metadata: {
            idempotencyKey,
            orderRecordId: orderRecord.id,
            requestedAmount: orderAmount,
            exchangeOrderId: confirmedOrder.id,
            tca: {
              implementationShortfall: tca.implementationShortfall,
              effectiveSpread: tca.effectiveSpread,
              totalCost: tca.totalCost,
              marketImpact: tca.marketImpact,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // 서킷 브레이커 메모리 추적 업데이트
      if (realizedPnl !== null)
        riskManager.recordTradeResult(botId, realizedPnl);

      // 알림 생성
      notificationService
        .sendTradeNotification(
          userId,
          symbol,
          signal.action,
          fillPrice,
          filledAmount,
          realizedPnl ?? undefined,
        )
        .catch((err) =>
          logger.debug("Trade notification failed", { error: String(err) }),
        );

      logger.info("Real trade executed (confirmed)", {
        botId,
        symbol,
        side: signal.action,
        price: fillPrice,
        amount: filledAmount,
        requested: orderAmount,
        pnl: realizedPnl,
        tca,
      });
    } catch (err) {
      logger.error("Real trade execution failed", {
        botId,
        symbol,
        error: String(err),
      });

      await prisma.botLog
        .create({
          data: {
            botId,
            level: "ERROR",
            message: `거래 실행 실패: ${String(err)}`,
          },
        })
        .catch((err) =>
          logger.debug("Background task failed", { error: String(err) }),
        );
    }
  }

  /**
   * SL/TP로 인한 포지션 청산
   */
  async executeClose(
    botId: string,
    symbol: string,
    exchangeName: SupportedExchange,
    mode: string,
    exchange: ReturnType<typeof exchangeService.initExchange> | null,
    position: TrackedPosition,
    currentPrice: number,
    reason: string,
    paperTradingService: {
      executePaperTrade: (
        botId: string,
        symbol: string,
        exchangeName: SupportedExchange,
        signal: TradeSignalInput,
        currentPrice: number,
        currentPosition: TrackedPosition | null,
        atr: number,
        ohlcvData?: {
          high: number;
          low: number;
          close: number;
          volume: number;
        }[],
      ) => Promise<void>;
    },
  ): Promise<void> {
    const closeSignal: TradeSignalInput = {
      action: "sell" as const,
      confidence: 1.0,
      reason,
      price: currentPrice,
    };

    if (mode === "PAPER") {
      await paperTradingService.executePaperTrade(
        botId,
        symbol,
        exchangeName,
        closeSignal,
        currentPrice,
        position,
        0,
      );
    } else if (exchange) {
      // H5: SL/TP 청산 3회 재시도 (실패 시 자금 손실 방지)
      let closed = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const order = await exchangeService.createOrder(
            exchange,
            symbol,
            "sell",
            "market",
            position.amount,
          );

          const fillPrice = order.average ?? order.price ?? currentPrice;
          const fee = order.fee?.cost ?? 0;
          const pnl = (fillPrice - position.entryPrice) * position.amount - fee;

          this.positionManager.closePosition(botId, symbol);

          // H3: 포지션 변경 DB 영속화
          this.positionManager.persistRealPosition(botId, symbol).catch((err) =>
            logger.debug("Position persist failed", {
              error: String(err),
            }),
          );

          await prisma.trade.create({
            data: {
              botId,
              symbol,
              side: "SELL",
              type: "MARKET",
              price: fillPrice,
              amount: position.amount,
              fee,
              pnl,
            },
          });

          riskManager.recordTradeResult(botId, pnl);

          logger.warn("Position closed by SL/TP", {
            botId,
            symbol,
            reason,
            pnl,
            attempt,
          });
          closed = true;
          break;
        } catch (err) {
          logger.error(`SL/TP close attempt ${attempt}/3 failed`, {
            botId,
            symbol,
            error: String(err),
          });
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }
      if (!closed) {
        logger.error(
          "All SL/TP close attempts failed - MANUAL INTERVENTION NEEDED",
          {
            botId,
            symbol,
            positionAmount: position.amount,
            entryPrice: position.entryPrice,
          },
        );
        await prisma.botLog
          .create({
            data: {
              botId,
              level: "ERROR",
              message: `SL/TP 청산 3회 실패 - 수동 개입 필요! 포지션: ${position.amount} ${symbol} @ ${position.entryPrice}`,
            },
          })
          .catch((err) =>
            logger.debug("Background task failed", { error: String(err) }),
          );
      }
    }

    await prisma.botLog
      .create({
        data: {
          botId,
          level: "WARN",
          message: reason,
        },
      })
      .catch((err) =>
        logger.debug("Background task failed", { error: String(err) }),
      );
  }
}
