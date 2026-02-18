import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { exchangeService, type SupportedExchange } from '../exchange.service.js';
import { riskManager } from '../risk.service.js';
import { executionService } from '../execution.service.js';
import { env } from '../../config/env.js';
import type { TrackedPosition, TradeSignalInput } from './types.js';
import { MIN_ORDER_VALUE_USDT } from './types.js';
import type { PositionManager } from './position-manager.js';
import type { OrderCalculator } from './order-calculator.js';

/**
 * RealTradingService: 실거래 실행, SL/TP 청산
 */
export class RealTradingService {
  constructor(
    private positionManager: PositionManager,
    private orderCalculator: OrderCalculator
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
    userId: string
  ): Promise<void> {
    // 실제 잔고 조회
    let capital = env.PAPER_INITIAL_BALANCE; // fallback
    try {
      const balances = await exchangeService.getBalance(exchange);
      const usdtBalance = balances['USDT'] as { total?: number } | undefined;
      capital = usdtBalance?.total ?? env.PAPER_INITIAL_BALANCE;
    } catch (err) {
      logger.warn('Failed to fetch balance, using portfolio value', { error: String(err) });
      const portfolio = await prisma.portfolio.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { totalValue: true },
      });
      capital = portfolio?.totalValue ?? env.PAPER_INITIAL_BALANCE;
    }

    // 동적 주문 수량 계산 (포지션 누적 상한 적용)
    let orderAmount: number;
    if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
      orderAmount = currentPosition.amount;
    } else {
      orderAmount = this.orderCalculator.calculateOrderAmount(capital, currentPrice, atr, signal, currentPosition);

      // 변동성 스케일링 적용
      if (atr > 0) {
        const volatility = (atr / currentPrice) * 100;
        orderAmount = riskManager.volatilityScaledSize(orderAmount, volatility);
      }

      // 최소 주문 금액 체크
      if (orderAmount * currentPrice < MIN_ORDER_VALUE_USDT) {
        logger.debug('Order value too small, skipping', {
          botId, value: orderAmount * currentPrice, min: MIN_ORDER_VALUE_USDT,
        });
        return;
      }
    }

    if (orderAmount <= 0) return;

    // 사전 유동성 검사 (REAL 모드)
    try {
      const orderBook = await exchangeService.getOrderBook(exchange, symbol, 50);
      const bids = orderBook.bids as [number, number][];
      const asks = orderBook.asks as [number, number][];

      const preCheck = executionService.preTradeCheck(
        bids, asks, signal.action as 'buy' | 'sell', orderAmount, currentPrice
      );

      if (!preCheck.allowed) {
        logger.warn('Pre-trade check failed, skipping order', {
          botId, symbol, reason: preCheck.reason,
          estimatedSlippage: preCheck.estimatedSlippage,
        });
        await prisma.botLog.create({
          data: {
            botId,
            level: 'WARN',
            message: `유동성 검사 실패: ${preCheck.reason}`,
          },
        }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
        return;
      }

      // 최대 주문량으로 cap
      if (preCheck.maxSafeSize > 0 && orderAmount > preCheck.maxSafeSize) {
        logger.info('Order amount capped by liquidity', {
          original: orderAmount, capped: preCheck.maxSafeSize,
        });
        orderAmount = preCheck.maxSafeSize;
      }
    } catch (obErr) {
      logger.warn('Pre-trade check skipped (orderbook fetch failed)', { error: String(obErr) });
    }

    // 멱등성 키 생성
    const idempotencyKey = `${botId}:${signal.action}:${Date.now()}`;

    try {
      // OrderRecord 생성 (PENDING 상태)
      const orderRecord = await prisma.orderRecord.create({
        data: {
          botId,
          symbol,
          side: signal.action === 'buy' ? 'BUY' : 'SELL',
          type: 'MARKET',
          requestedAmount: orderAmount,
          idempotencyKey,
          status: 'PENDING',
        },
      });

      const order = await exchangeService.createOrder(
        exchange,
        symbol,
        signal.action as 'buy' | 'sell',
        'market',
        orderAmount,
        undefined,
        idempotencyKey
      );

      // 체결 확인: fetchOrder로 폴링
      let confirmedOrder = order;
      try {
        confirmedOrder = await exchangeService.fetchOrder(exchange, order.id, symbol);
      } catch (fetchErr) {
        logger.warn('fetchOrder failed, using initial order data', {
          orderId: order.id, error: String(fetchErr),
        });
      }

      const fillPrice = confirmedOrder.average ?? confirmedOrder.price ?? currentPrice;
      const filledAmount = confirmedOrder.filled ?? 0;
      const fee = confirmedOrder.fee?.cost ?? 0;

      // OrderRecord 업데이트
      const orderStatus = filledAmount <= 0 ? 'FAILED'
        : filledAmount < orderAmount ? 'PARTIALLY_FILLED'
        : 'FILLED';

      await prisma.orderRecord.update({
        where: { id: orderRecord.id },
        data: {
          exchangeOrderId: confirmedOrder.id,
          filledAmount,
          avgFillPrice: fillPrice,
          status: orderStatus as 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED',
        },
      }).catch((err) => logger.debug('Background task failed', { error: String(err) }));

      // 체결 실패 (filled=0): 포지션 업데이트 안 함
      if (filledAmount <= 0) {
        logger.warn('Order not filled, skipping position update', {
          botId, orderId: confirmedOrder.id, status: confirmedOrder.status,
        });
        return;
      }

      // 부분 체결 경고
      if (filledAmount < orderAmount * 0.99) {
        logger.warn('Partial fill detected', {
          botId, requested: orderAmount, filled: filledAmount,
          fillRatio: (filledAmount / orderAmount * 100).toFixed(1) + '%',
        });
      }

      // 포지션 업데이트 (실제 체결량 사용)
      if (signal.action === 'buy') {
        this.positionManager.openPosition(botId, symbol, 'long', fillPrice, filledAmount, signal.stopLoss, signal.takeProfit);
      } else {
        this.positionManager.closePosition(botId, symbol);
      }

      // PnL 계산 (매도 시)
      let realizedPnl: number | null = null;
      if (signal.action === 'sell' && currentPosition && currentPosition.isOpen) {
        realizedPnl = (fillPrice - currentPosition.entryPrice) * filledAmount - fee;
      }

      // TCA (Transaction Cost Analysis)
      const tca = executionService.calculateTCA(
        currentPrice, fillPrice, filledAmount, fee, signal.action as 'buy' | 'sell'
      );

      await prisma.trade.create({
        data: {
          botId,
          symbol,
          side: signal.action === 'buy' ? 'BUY' : 'SELL',
          type: 'MARKET',
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
      if (realizedPnl !== null) riskManager.recordTradeResult(botId, realizedPnl);

      logger.info('Real trade executed (confirmed)', {
        botId, symbol,
        side: signal.action,
        price: fillPrice,
        amount: filledAmount,
        requested: orderAmount,
        pnl: realizedPnl,
        tca,
      });
    } catch (err) {
      logger.error('Real trade execution failed', { botId, symbol, error: String(err) });

      await prisma.botLog.create({
        data: {
          botId,
          level: 'ERROR',
          message: `거래 실행 실패: ${String(err)}`,
        },
      }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
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
        ohlcvData?: { high: number; low: number; close: number; volume: number }[]
      ) => Promise<void>;
    }
  ): Promise<void> {
    const closeSignal: TradeSignalInput = {
      action: 'sell' as const,
      confidence: 1.0,
      reason,
      price: currentPrice,
    };

    if (mode === 'PAPER') {
      await paperTradingService.executePaperTrade(
        botId, symbol, exchangeName, closeSignal, currentPrice, position, 0
      );
    } else if (exchange) {
      try {
        const order = await exchangeService.createOrder(
          exchange, symbol, 'sell', 'market', position.amount
        );

        const fillPrice = order.average ?? order.price ?? currentPrice;
        const fee = order.fee?.cost ?? 0;
        const pnl = (fillPrice - position.entryPrice) * position.amount - fee;

        this.positionManager.closePosition(botId, symbol);

        await prisma.trade.create({
          data: {
            botId,
            symbol,
            side: 'SELL',
            type: 'MARKET',
            price: fillPrice,
            amount: position.amount,
            fee,
            pnl,
          },
        });

        // 서킷 브레이커 메모리 추적 업데이트
        riskManager.recordTradeResult(botId, pnl);

        logger.warn('Position closed by SL/TP', {
          botId, symbol, reason, pnl,
        });
      } catch (err) {
        logger.error('Failed to close position via SL/TP', {
          botId, symbol, error: String(err),
        });
      }
    }

    await prisma.botLog.create({
      data: {
        botId,
        level: 'WARN',
        message: reason,
      },
    }).catch((err) => logger.debug('Background task failed', { error: String(err) }));
  }
}
