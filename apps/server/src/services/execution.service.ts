import { logger } from '../utils/logger.js';
import { exchangeService } from './exchange.service.js';
import type { Exchange, Order } from 'ccxt';

export interface TWAPOrder {
  symbol: string;
  side: 'buy' | 'sell';
  totalAmount: number;
  exchange: Exchange;
}

export interface VWAPOrder {
  symbol: string;
  side: 'buy' | 'sell';
  totalAmount: number;
  exchange: Exchange;
}

export interface IcebergOrder {
  symbol: string;
  side: 'buy' | 'sell';
  totalAmount: number;
  price: number;
  exchange: Exchange;
}

export interface ExecutionResult {
  orders: Array<{
    id: string;
    price: number;
    amount: number;
    filled: number;
    timestamp: number;
    status: string;
  }>;
  avgPrice: number;
  totalFilled: number;
  totalCost: number;
  slippage: number;
}

export interface PreTradeCheckResult {
  allowed: boolean;
  estimatedSlippage: number;   // 예상 슬리피지 (%)
  maxSafeSize: number;         // 0.1% 슬리피지 내 최대 주문량
  reason: string;
}

export interface TCAResult {
  implementationShortfall: number; // 기대가 vs 실제 체결가 차이 (%)
  effectiveSpread: number;         // 유효 스프레드 (%)
  totalCost: number;               // 총 거래 비용 ($)
  marketImpact: number;            // 시장 충격 (%)
}

export interface KimchiPremium {
  symbol: string;
  binancePrice: number;
  upbitPrice: number;
  premiumPercent: number;
  premiumAbsolute: number;
  timestamp: number;
}

export class ExecutionService {
  async executeTWAP(
    order: TWAPOrder,
    durationMs: number,
    slices: number
  ): Promise<ExecutionResult> {
    logger.info('Executing TWAP order', {
      symbol: order.symbol,
      side: order.side,
      totalAmount: order.totalAmount,
      durationMs,
      slices,
    });

    const sliceAmount = order.totalAmount / slices;
    const intervalMs = durationMs / slices;
    const executedOrders: ExecutionResult['orders'] = [];

    for (let i = 0; i < slices; i++) {
      try {
        const result = await exchangeService.createOrder(
          order.exchange,
          order.symbol,
          order.side,
          'market',
          sliceAmount
        );

        executedOrders.push({
          id: result.id,
          price: result.average ?? result.price ?? 0,
          amount: sliceAmount,
          filled: result.filled ?? sliceAmount,
          timestamp: result.timestamp ?? Date.now(),
          status: result.status ?? 'closed',
        });

        logger.debug(`TWAP slice ${i + 1}/${slices} executed`, {
          price: result.average ?? result.price,
          amount: sliceAmount,
        });

        if (i < slices - 1) {
          await this.sleep(intervalMs);
        }
      } catch (err) {
        logger.error(`TWAP slice ${i + 1} failed`, { error: String(err) });
      }
    }

    return this.aggregateResults(executedOrders);
  }

  async executeVWAP(
    order: VWAPOrder,
    volumeProfile: number[]
  ): Promise<ExecutionResult> {
    logger.info('Executing VWAP order', {
      symbol: order.symbol,
      side: order.side,
      totalAmount: order.totalAmount,
      buckets: volumeProfile.length,
    });

    const totalWeight = volumeProfile.reduce((sum, v) => sum + v, 0);
    if (totalWeight === 0) {
      return { orders: [], avgPrice: 0, totalFilled: 0, totalCost: 0, slippage: 0 };
    }

    const normalizedWeights = volumeProfile.map((v) => v / totalWeight);
    const executedOrders: ExecutionResult['orders'] = [];

    for (let i = 0; i < normalizedWeights.length; i++) {
      const weight = normalizedWeights[i]!;
      const sliceAmount = order.totalAmount * weight;

      if (sliceAmount <= 0) continue;

      try {
        const result = await exchangeService.createOrder(
          order.exchange,
          order.symbol,
          order.side,
          'market',
          sliceAmount
        );

        executedOrders.push({
          id: result.id,
          price: result.average ?? result.price ?? 0,
          amount: sliceAmount,
          filled: result.filled ?? sliceAmount,
          timestamp: result.timestamp ?? Date.now(),
          status: result.status ?? 'closed',
        });

        logger.debug(`VWAP bucket ${i + 1}/${volumeProfile.length} executed`, {
          weight: weight.toFixed(4),
          amount: sliceAmount,
        });

        if (i < normalizedWeights.length - 1) {
          await this.sleep(1000);
        }
      } catch (err) {
        logger.error(`VWAP bucket ${i + 1} failed`, { error: String(err) });
      }
    }

    return this.aggregateResults(executedOrders);
  }

  async executeIceberg(
    order: IcebergOrder,
    visibleSize: number
  ): Promise<ExecutionResult> {
    logger.info('Executing Iceberg order', {
      symbol: order.symbol,
      side: order.side,
      totalAmount: order.totalAmount,
      visibleSize,
      price: order.price,
    });

    const executedOrders: ExecutionResult['orders'] = [];
    let remainingAmount = order.totalAmount;
    const maxIterations = Math.ceil(order.totalAmount / visibleSize) * 3; // 안전 상한
    let iterations = 0;
    let consecutiveZeroFills = 0;

    while (remainingAmount > 0 && iterations < maxIterations) {
      iterations++;
      const sliceAmount = Math.min(visibleSize, remainingAmount);

      try {
        const result = await exchangeService.createOrder(
          order.exchange,
          order.symbol,
          order.side,
          'limit',
          sliceAmount,
          order.price
        );

        const filled = result.filled ?? 0;

        executedOrders.push({
          id: result.id,
          price: result.average ?? result.price ?? order.price,
          amount: sliceAmount,
          filled,
          timestamp: result.timestamp ?? Date.now(),
          status: result.status ?? 'open',
        });

        if (filled > 0) {
          remainingAmount -= filled;
          consecutiveZeroFills = 0;
        } else {
          consecutiveZeroFills++;
          if (consecutiveZeroFills >= 5) {
            logger.warn('Iceberg: 5 consecutive zero-fill slices, stopping', {
              remaining: remainingAmount,
            });
            break;
          }
        }

        logger.debug('Iceberg slice executed', {
          filled,
          remaining: remainingAmount,
          iteration: iterations,
        });

        await this.sleep(500);
      } catch (err) {
        logger.error('Iceberg slice failed', { error: String(err), remaining: remainingAmount });
        break;
      }
    }

    if (iterations >= maxIterations) {
      logger.warn('Iceberg: max iterations reached', { remaining: remainingAmount });
    }

    return this.aggregateResults(executedOrders);
  }

  async calculateKimchiPremium(symbol: string): Promise<KimchiPremium> {
    logger.debug('Calculating kimchi premium', { symbol });

    let binancePrice = 0;
    let upbitPrice = 0;

    try {
      const binanceResponse = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('/', '')}`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (binanceResponse.ok) {
        const binanceData = (await binanceResponse.json()) as { price: string };
        binancePrice = parseFloat(binanceData.price);
      }
    } catch (err) {
      logger.warn('Failed to fetch Binance price for premium', { error: String(err) });
    }

    try {
      const baseSymbol = symbol.split('/')[0] ?? 'BTC';
      const upbitResponse = await fetch(
        `https://api.upbit.com/v1/ticker?markets=KRW-${baseSymbol}`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (upbitResponse.ok) {
        const upbitData = (await upbitResponse.json()) as Array<{ trade_price: number }>;
        if (upbitData.length > 0) {
          const krwPrice = upbitData[0]!.trade_price;

          let usdKrw = 1350;
          try {
            const fxResponse = await fetch(
              'https://api.upbit.com/v1/ticker?markets=CRIX.UPBIT.FRX.KRWUSD',
              { signal: AbortSignal.timeout(5000) }
            );
            if (fxResponse.ok) {
              const fxData = (await fxResponse.json()) as Array<{ trade_price: number }>;
              if (fxData.length > 0) {
                usdKrw = fxData[0]!.trade_price;
              }
            }
          } catch {
            logger.debug('Using default KRW/USD rate');
          }

          upbitPrice = krwPrice / usdKrw;
        }
      }
    } catch (err) {
      logger.warn('Failed to fetch Upbit price for premium', { error: String(err) });
    }

    // 가격 중 하나라도 0이면 프리미엄 계산 불가
    if (binancePrice <= 0 || upbitPrice <= 0) {
      logger.warn('Cannot calculate kimchi premium: missing price data', {
        symbol, binancePrice, upbitPrice,
      });
      return {
        symbol, binancePrice, upbitPrice,
        premiumPercent: 0, premiumAbsolute: 0, timestamp: Date.now(),
      };
    }

    const premiumAbsolute = upbitPrice - binancePrice;
    const premiumPercent = (premiumAbsolute / binancePrice) * 100;

    const result: KimchiPremium = {
      symbol,
      binancePrice,
      upbitPrice,
      premiumPercent,
      premiumAbsolute,
      timestamp: Date.now(),
    };

    logger.info('Kimchi premium calculated', {
      symbol,
      premium: `${premiumPercent.toFixed(2)}%`,
    });

    return result;
  }

  /**
   * 사전 유동성 검사: 호가창을 순회하여 예상 슬리피지 계산
   * 슬리피지 > 0.5% 시 거래 거부
   */
  preTradeCheck(
    bids: [number, number][],
    asks: [number, number][],
    side: 'buy' | 'sell',
    amount: number,
    currentPrice: number
  ): PreTradeCheckResult {
    const book = side === 'buy' ? asks : bids;
    if (book.length === 0 || currentPrice <= 0) {
      return { allowed: false, estimatedSlippage: 0, maxSafeSize: 0, reason: '호가창 데이터 없음' };
    }

    // 예상 체결가 계산 (호가창 순회)
    let remainingAmount = amount;
    let totalCost = 0;

    for (const [price, size] of book) {
      const fillAmount = Math.min(remainingAmount, size);
      totalCost += fillAmount * price;
      remainingAmount -= fillAmount;
      if (remainingAmount <= 0) break;
    }

    if (remainingAmount > 0) {
      return {
        allowed: false,
        estimatedSlippage: 999,
        maxSafeSize: amount - remainingAmount,
        reason: `호가창 유동성 부족: ${(remainingAmount / amount * 100).toFixed(1)}% 미체결 예상`,
      };
    }

    const avgFillPrice = totalCost / amount;
    const slippage = Math.abs(avgFillPrice - currentPrice) / currentPrice * 100;

    const maxSlippage = 0.5; // 0.5%
    if (slippage > maxSlippage) {
      logger.warn('Pre-trade check: slippage too high', { side, amount, slippage, maxSlippage });
      return {
        allowed: false,
        estimatedSlippage: slippage,
        maxSafeSize: this.calculateMaxOrderSize(book, currentPrice, 0.1),
        reason: `예상 슬리피지 ${slippage.toFixed(3)}% > ${maxSlippage}% 한도 초과`,
      };
    }

    return {
      allowed: true,
      estimatedSlippage: slippage,
      maxSafeSize: this.calculateMaxOrderSize(book, currentPrice, 0.1),
      reason: `예상 슬리피지 ${slippage.toFixed(3)}% — OK`,
    };
  }

  /**
   * 호가창 기반 최대 주문량 계산: maxSlippagePct 이내 체결 가능한 수량
   */
  calculateMaxOrderSize(
    book: [number, number][],
    currentPrice: number,
    maxSlippagePct: number = 0.1
  ): number {
    if (book.length === 0 || currentPrice <= 0) return 0;

    let totalAmount = 0;
    let totalCost = 0;

    for (const [price, size] of book) {
      // 이 호가까지 체결했을 때의 평균가
      const newTotalCost = totalCost + price * size;
      const newTotalAmount = totalAmount + size;
      const avgPrice = newTotalCost / newTotalAmount;
      const slippage = Math.abs(avgPrice - currentPrice) / currentPrice * 100;

      if (slippage > maxSlippagePct) {
        // 이 호가에서 슬리피지 한도 초과 → 부분 체결량 계산
        // 역산: 얼마까지 체결하면 slippage == maxSlippagePct인가
        const maxAvgPrice = currentPrice * (1 + maxSlippagePct / 100);
        // totalCost + price * x = maxAvgPrice * (totalAmount + x)
        // x * (price - maxAvgPrice) = maxAvgPrice * totalAmount - totalCost
        if (price !== maxAvgPrice) {
          const partialSize = (maxAvgPrice * totalAmount - totalCost) / (price - maxAvgPrice);
          if (partialSize > 0) {
            totalAmount += Math.min(partialSize, size);
          }
        }
        break;
      }

      totalAmount += size;
      totalCost = newTotalCost;
    }

    return totalAmount;
  }

  /**
   * 거래 후 TCA (Transaction Cost Analysis)
   * 기대가 vs 실제 체결가 비교
   */
  calculateTCA(
    expectedPrice: number,
    actualAvgPrice: number,
    amount: number,
    fee: number,
    side: 'buy' | 'sell',
    midPrice?: number
  ): TCAResult {
    // Implementation Shortfall: 기대가 대비 실제 체결 비용 차이
    const priceDiff = side === 'buy'
      ? actualAvgPrice - expectedPrice
      : expectedPrice - actualAvgPrice;
    const implementationShortfall = expectedPrice > 0
      ? (priceDiff / expectedPrice) * 100
      : 0;

    // Effective Spread: 체결가와 중간가의 차이
    const mid = midPrice ?? expectedPrice;
    const effectiveSpread = mid > 0
      ? (Math.abs(actualAvgPrice - mid) / mid) * 200  // 왕복 기준
      : 0;

    // Market Impact: 순수 가격 충격 (수수료 제외)
    const marketImpact = expectedPrice > 0
      ? (Math.abs(priceDiff) / expectedPrice) * 100
      : 0;

    // Total Cost: 슬리피지 비용 + 수수료
    const slippageCost = Math.abs(priceDiff) * amount;
    const totalCost = slippageCost + fee;

    return {
      implementationShortfall: Math.round(implementationShortfall * 10000) / 10000,
      effectiveSpread: Math.round(effectiveSpread * 10000) / 10000,
      totalCost: Math.round(totalCost * 100) / 100,
      marketImpact: Math.round(marketImpact * 10000) / 10000,
    };
  }

  private aggregateResults(
    orders: ExecutionResult['orders']
  ): ExecutionResult {
    if (orders.length === 0) {
      return { orders: [], avgPrice: 0, totalFilled: 0, totalCost: 0, slippage: 0 };
    }

    const totalFilled = orders.reduce((sum, o) => sum + o.filled, 0);
    const totalCost = orders.reduce((sum, o) => sum + o.price * o.filled, 0);
    const avgPrice = totalFilled > 0 ? totalCost / totalFilled : 0;

    const firstPrice = orders[0]!.price;
    const slippage = firstPrice > 0 ? Math.abs(avgPrice - firstPrice) / firstPrice : 0;

    return {
      orders,
      avgPrice,
      totalFilled,
      totalCost,
      slippage,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const executionService = new ExecutionService();
