import ccxt, { type Exchange, type Ticker, type OHLCV, type OrderBook, type Order, type Balances } from 'ccxt';
import { logger } from '../utils/logger.js';

interface PaperPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  amount: number;
  timestamp: number;
}

interface PaperOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  price: number;
  amount: number;
  filled: number;
  status: 'open' | 'closed' | 'canceled';
  timestamp: number;
}

interface PaperBalance {
  [currency: string]: {
    free: number;
    used: number;
    total: number;
  };
}

export class PaperExchange {
  private balance: PaperBalance;
  private positions: Map<string, PaperPosition> = new Map();
  private orders: PaperOrder[] = [];
  private orderIdCounter = 0;
  private realExchange: Exchange | null;

  constructor(initialBalance: number = 10000, realExchange: Exchange | null = null) {
    this.balance = {
      USDT: { free: initialBalance, used: 0, total: initialBalance },
    };
    this.realExchange = realExchange;
  }

  async getTicker(symbol: string): Promise<Ticker | null> {
    if (this.realExchange) {
      try {
        return await this.realExchange.fetchTicker(symbol);
      } catch (err) {
        logger.error('PaperExchange: failed to fetch real ticker', { symbol, error: String(err) });
        return null;
      }
    }
    return null;
  }

  async createOrder(
    symbol: string,
    side: 'buy' | 'sell',
    type: string,
    amount: number,
    price?: number
  ): Promise<PaperOrder> {
    const ticker = await this.getTicker(symbol);
    const fillPrice = price ?? ticker?.last ?? 0;

    if (fillPrice <= 0) {
      throw new Error(`Cannot determine price for ${symbol}`);
    }

    const cost = fillPrice * amount;
    const fee = cost * 0.001;
    const [base] = symbol.split('/') as [string, string];

    if (side === 'buy') {
      const totalCost = cost + fee;
      if ((this.balance['USDT']?.free ?? 0) < totalCost) {
        throw new Error(`Insufficient USDT balance. Need ${totalCost}, have ${this.balance['USDT']?.free ?? 0}`);
      }

      this.balance['USDT'] = {
        free: (this.balance['USDT']?.free ?? 0) - totalCost,
        used: this.balance['USDT']?.used ?? 0,
        total: (this.balance['USDT']?.total ?? 0) - totalCost,
      };

      if (!this.balance[base]) {
        this.balance[base] = { free: 0, used: 0, total: 0 };
      }
      const baseBalance = this.balance[base]!;
      baseBalance.free += amount;
      baseBalance.total += amount;
    } else {
      const baseBalance = this.balance[base];
      if (!baseBalance || baseBalance.free < amount) {
        throw new Error(`Insufficient ${base} balance. Need ${amount}, have ${baseBalance?.free ?? 0}`);
      }

      baseBalance.free -= amount;
      baseBalance.total -= amount;

      const netProceeds = cost - fee;
      if (!this.balance['USDT']) {
        this.balance['USDT'] = { free: 0, used: 0, total: 0 };
      }
      const usdtBalance = this.balance['USDT']!;
      usdtBalance.free += netProceeds;
      usdtBalance.total += netProceeds;
    }

    const order: PaperOrder = {
      id: String(++this.orderIdCounter),
      symbol,
      side,
      type,
      price: fillPrice,
      amount,
      filled: amount,
      status: 'closed',
      timestamp: Date.now(),
    };

    this.orders.push(order);
    logger.info('PaperExchange: order executed', {
      id: order.id,
      symbol,
      side,
      price: fillPrice,
      amount,
    });

    return order;
  }

  getBalance(): PaperBalance {
    return { ...this.balance };
  }

  getOrders(): PaperOrder[] {
    return [...this.orders];
  }

  getPositions(): Map<string, PaperPosition> {
    return new Map(this.positions);
  }
}

export type SupportedExchange = 'binance' | 'upbit' | 'bybit' | 'bithumb';

export class ExchangeService {
  private exchanges: Map<string, Exchange> = new Map();
  private paperExchanges: Map<string, PaperExchange> = new Map();

  initExchange(exchangeName: SupportedExchange, apiKey: string, apiSecret: string): Exchange {
    const key = `${exchangeName}:${apiKey.slice(0, 8)}`;

    if (this.exchanges.has(key)) {
      return this.exchanges.get(key)!;
    }

    const ExchangeClass = ccxt[exchangeName];
    if (!ExchangeClass) {
      throw new Error(`Unsupported exchange: ${exchangeName}`);
    }

    const exchange = new ExchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
        adjustForTimeDifference: true,
      },
    });

    this.exchanges.set(key, exchange);
    logger.info(`Exchange initialized: ${exchangeName}`);

    return exchange;
  }

  initPaperExchange(exchangeName: SupportedExchange, initialBalance: number = 10000, realExchange?: Exchange): PaperExchange {
    const key = `paper:${exchangeName}`;
    const paper = new PaperExchange(initialBalance, realExchange ?? null);
    this.paperExchanges.set(key, paper);
    logger.info(`Paper exchange initialized: ${exchangeName} with $${initialBalance}`);
    return paper;
  }

  getPaperExchange(exchangeName: SupportedExchange): PaperExchange | undefined {
    return this.paperExchanges.get(`paper:${exchangeName}`);
  }

  async getTicker(exchange: Exchange, symbol: string): Promise<Ticker> {
    try {
      const ticker = await exchange.fetchTicker(symbol);
      return ticker;
    } catch (err) {
      logger.error('Failed to fetch ticker', { symbol, error: String(err) });
      throw err;
    }
  }

  async getOHLCV(
    exchange: Exchange,
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100
  ): Promise<OHLCV[]> {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv;
    } catch (err) {
      logger.error('Failed to fetch OHLCV', { symbol, timeframe, error: String(err) });
      throw err;
    }
  }

  async getOrderBook(exchange: Exchange, symbol: string, limit: number = 20): Promise<OrderBook> {
    try {
      const orderbook = await exchange.fetchOrderBook(symbol, limit);
      return orderbook;
    } catch (err) {
      logger.error('Failed to fetch order book', { symbol, error: String(err) });
      throw err;
    }
  }

  async createOrder(
    exchange: Exchange,
    symbol: string,
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    amount: number,
    price?: number
  ): Promise<Order> {
    try {
      logger.info('Creating order', { symbol, side, type, amount, price });
      const order = await exchange.createOrder(symbol, type, side, amount, price);
      logger.info('Order created', { orderId: order.id, status: order.status });
      return order;
    } catch (err) {
      logger.error('Failed to create order', { symbol, side, type, error: String(err) });
      throw err;
    }
  }

  async getBalance(exchange: Exchange): Promise<Balances> {
    try {
      const balance = await exchange.fetchBalance();
      return balance;
    } catch (err) {
      logger.error('Failed to fetch balance', { error: String(err) });
      throw err;
    }
  }

  async cancelOrder(exchange: Exchange, orderId: string, symbol: string): Promise<void> {
    try {
      await exchange.cancelOrder(orderId, symbol);
      logger.info('Order canceled', { orderId, symbol });
    } catch (err) {
      logger.error('Failed to cancel order', { orderId, symbol, error: String(err) });
      throw err;
    }
  }

  getExchangeNameFromEnum(exchangeEnum: string): SupportedExchange {
    const mapping: Record<string, SupportedExchange> = {
      BINANCE: 'binance',
      UPBIT: 'upbit',
      BYBIT: 'bybit',
      BITHUMB: 'bithumb',
    };
    const name = mapping[exchangeEnum];
    if (!name) {
      throw new Error(`Unknown exchange enum: ${exchangeEnum}`);
    }
    return name;
  }
}

export const exchangeService = new ExchangeService();
