import ccxt, { type Exchange, type Ticker, type OHLCV, type OrderBook, type Order, type Balances } from 'ccxt';
import { logger } from '../utils/logger.js';

// ===== 서킷 브레이커 =====
class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly name: string,
    private readonly threshold: number = 5,
    private readonly timeoutMs: number = 60000,
    private readonly halfOpenMaxAttempts: number = 2
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailTime;
      if (elapsed >= this.timeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info(`Circuit breaker ${this.name}: OPEN → HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN (${Math.ceil((this.timeoutMs - elapsed) / 1000)}s remaining)`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info(`Circuit breaker ${this.name}: HALF_OPEN → CLOSED`);
    }
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit breaker ${this.name}: OPEN after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

// ===== 재시도 유틸리티 =====
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

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
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private cache: Map<string, { data: unknown; expiry: number }> = new Map();
  private cacheCleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // 60초마다 만료된 캐시 정리 (메모리 누수 방지)
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (now >= entry.expiry) {
          this.cache.delete(key);
        }
      }
    }, 60_000);
    this.cacheCleanupTimer.unref();
  }

  private getCircuitBreaker(name: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(name);
    if (!cb) {
      cb = new CircuitBreaker(name);
      this.circuitBreakers.set(name, cb);
    }
    return cb;
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiry) {
      return entry.data as T;
    }
    if (entry) this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown, ttlMs: number): void {
    this.cache.set(key, { data, expiry: Date.now() + ttlMs });
  }

  initExchange(exchangeName: SupportedExchange, apiKey: string, apiSecret: string): Exchange {
    const key = `${exchangeName}:${apiKey.slice(0, 4)}****`;

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
    // 5초 캐시
    const cacheKey = `ticker:${symbol}`;
    const cached = this.getCached<Ticker>(cacheKey);
    if (cached) return cached;

    const cb = this.getCircuitBreaker(`ticker:${exchange.id ?? 'default'}`);

    const ticker = await cb.execute(() =>
      withRetry(() => exchange.fetchTicker(symbol), 2, 500)
    );

    this.setCache(cacheKey, ticker, 5000);
    return ticker;
  }

  async getOHLCV(
    exchange: Exchange,
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100
  ): Promise<OHLCV[]> {
    // 30초 캐시
    const cacheKey = `ohlcv:${symbol}:${timeframe}:${limit}`;
    const cached = this.getCached<OHLCV[]>(cacheKey);
    if (cached) return cached;

    const cb = this.getCircuitBreaker(`ohlcv:${exchange.id ?? 'default'}`);

    const ohlcv = await cb.execute(() =>
      withRetry(() => exchange.fetchOHLCV(symbol, timeframe, undefined, limit), 2, 1000)
    );

    this.setCache(cacheKey, ohlcv, 30000);
    return ohlcv;
  }

  async getOrderBook(exchange: Exchange, symbol: string, limit: number = 20): Promise<OrderBook> {
    // 2초 캐시
    const cacheKey = `orderbook:${symbol}:${limit}`;
    const cached = this.getCached<OrderBook>(cacheKey);
    if (cached) return cached;

    const cb = this.getCircuitBreaker(`orderbook:${exchange.id ?? 'default'}`);

    const orderbook = await cb.execute(() =>
      withRetry(() => exchange.fetchOrderBook(symbol, limit), 2, 500)
    );

    this.setCache(cacheKey, orderbook, 2000);
    return orderbook;
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

  /**
   * 페이지네이션으로 대량 OHLCV 데이터 조회 (1000캔들 제한 돌파)
   * 장기 백테스트를 위해 최대 10000캔들까지 지원
   */
  async fetchPaginatedOHLCV(
    exchange: Exchange,
    symbol: string,
    timeframe: string,
    since?: number,
    until?: number,
    maxCandles: number = 5000
  ): Promise<OHLCV[]> {
    const allCandles: OHLCV[] = [];
    let currentSince = since;
    const batchSize = 1000;
    const safeMax = Math.min(maxCandles, 10000);

    logger.info('Fetching paginated OHLCV', { symbol, timeframe, since, until, maxCandles: safeMax });

    while (allCandles.length < safeMax) {
      const cb = this.getCircuitBreaker(`ohlcv-paginated:${exchange.id ?? 'default'}`);

      const batch = await cb.execute(() =>
        withRetry(() => exchange.fetchOHLCV(symbol, timeframe, currentSince, batchSize), 2, 1000)
      );

      if (batch.length === 0) break;

      // 종료일 필터링
      const filtered = until
        ? batch.filter(c => (c[0] ?? 0) <= until)
        : batch;

      allCandles.push(...filtered);

      if (batch.length < batchSize) break; // 더 이상 데이터 없음
      if (until && filtered.length < batch.length) break; // 종료일 도달

      // 다음 페이지: 마지막 캔들 이후부터
      const lastTimestamp = batch[batch.length - 1]![0] ?? 0;
      currentSince = lastTimestamp + 1;

      // 레이트 리밋 준수
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const result = allCandles.slice(0, safeMax);
    logger.info('Paginated OHLCV fetched', { symbol, timeframe, totalCandles: result.length });

    return result;
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
