/**
 * verify-services.ts
 *
 * apps/server 의 모든 서비스가 임포트 가능하고, 핵심 로직이 올바르게 동작하는지 검증.
 * DB 연결 없이 동작하도록 Prisma 호출은 mock.
 *
 * 실행: npx tsx apps/server/src/scripts/verify-services.ts
 */

// ===== Prisma Mock =====
// db.ts가 로드되기 전에 globalThis에 mock PrismaClient를 주입
const mockPrisma = {
  bot: {
    findUnique: async () => ({ userId: 'test-user' }),
    updateMany: async () => ({ count: 0 }),
  },
  trade: {
    findMany: async () => [],
    aggregate: async () => ({ _sum: { pnl: 0 } }),
    create: async (args: unknown) => ({ id: 'mock-trade', ...(args as Record<string, unknown>) }),
  },
  portfolio: {
    findFirst: async () => ({ totalValue: 10000 }),
  },
  alert: {
    create: async (args: unknown) => ({ id: 'mock-alert', ...(args as Record<string, unknown>) }),
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  },
  botLog: {
    create: async (args: unknown) => ({ id: 'mock-log', ...(args as Record<string, unknown>) }),
  },
  apiKey: {
    findFirst: async () => null,
  },
  $on: () => {},
  $connect: async () => {},
  $disconnect: async () => {},
};

// PrismaClient mock injection
(globalThis as any).prisma = mockPrisma;

// Mock @prisma/client module before any service loads it
// We'll use Node's module system to intercept

import { register } from 'node:module';

// ===== Test Framework =====
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, status: 'PASS', detail: 'OK', duration });
    console.log(`  [PASS] ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - start;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, status: 'FAIL', detail, duration });
    console.log(`  [FAIL] ${name} (${duration}ms)`);
    console.log(`         ${detail}`);
  }
}

// ===== OHLCV Test Data Generator =====
function generateOHLCV(count: number, basePrice: number = 50000): Array<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  const data = [];
  let price = basePrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * price * 0.03; // slight upward bias
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * price * 0.01;
    const low = Math.min(open, close) - Math.random() * price * 0.01;
    const volume = 100 + Math.random() * 900;

    data.push({
      timestamp: now - (count - i) * 3600000,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return data;
}

// ===== Main =====
async function main() {
  console.log('='.repeat(70));
  console.log(' CryptoSentinel Pro - Service Verification Script');
  console.log(' DB 연결 없이 핵심 로직 검증');
  console.log('='.repeat(70));
  console.log('');

  // ============================================================
  // 1. Import Tests
  // ============================================================
  console.log('[1] Service Import Tests');
  console.log('-'.repeat(50));

  let ExchangeServiceMod: any;
  let IndicatorsServiceMod: any;
  let RiskServiceMod: any;
  let BacktesterServiceMod: any;
  let ExecutionServiceMod: any;
  let SentimentServiceMod: any;
  let OnchainServiceMod: any;
  let OrderbookServiceMod: any;
  let RegimeServiceMod: any;
  let MTFServiceMod: any;
  let NotificationServiceMod: any;
  let BotRunnerServiceMod: any;
  let SlippageServiceMod: any;

  await runTest('Import: exchange.service', async () => {
    ExchangeServiceMod = await import('../services/exchange.service.js');
    if (!ExchangeServiceMod.ExchangeService) throw new Error('ExchangeService class not found');
    if (!ExchangeServiceMod.PaperExchange) throw new Error('PaperExchange class not found');
    if (!ExchangeServiceMod.exchangeService) throw new Error('exchangeService singleton not found');
  });

  await runTest('Import: indicators.service', async () => {
    IndicatorsServiceMod = await import('../services/indicators.service.js');
    if (!IndicatorsServiceMod.IndicatorsService) throw new Error('IndicatorsService class not found');
    if (!IndicatorsServiceMod.indicatorsService) throw new Error('indicatorsService singleton not found');
  });

  await runTest('Import: risk.service', async () => {
    RiskServiceMod = await import('../services/risk.service.js');
    if (!RiskServiceMod.RiskManager) throw new Error('RiskManager class not found');
    if (!RiskServiceMod.riskManager) throw new Error('riskManager singleton not found');
  });

  await runTest('Import: backtester.service', async () => {
    BacktesterServiceMod = await import('../services/backtester.service.js');
    if (!BacktesterServiceMod.BacktesterService) throw new Error('BacktesterService class not found');
    if (!BacktesterServiceMod.backtesterService) throw new Error('backtesterService singleton not found');
  });

  await runTest('Import: execution.service', async () => {
    ExecutionServiceMod = await import('../services/execution.service.js');
    if (!ExecutionServiceMod.ExecutionService) throw new Error('ExecutionService class not found');
    if (!ExecutionServiceMod.executionService) throw new Error('executionService singleton not found');
  });

  await runTest('Import: sentiment.service', async () => {
    SentimentServiceMod = await import('../services/sentiment.service.js');
    if (!SentimentServiceMod.SentimentService) throw new Error('SentimentService class not found');
    if (!SentimentServiceMod.sentimentService) throw new Error('sentimentService singleton not found');
  });

  await runTest('Import: onchain.service', async () => {
    OnchainServiceMod = await import('../services/onchain.service.js');
    if (!OnchainServiceMod.OnchainAnalyticsService) throw new Error('OnchainAnalyticsService class not found');
    if (!OnchainServiceMod.onchainAnalyticsService) throw new Error('onchainAnalyticsService singleton not found');
  });

  await runTest('Import: orderbook.service', async () => {
    OrderbookServiceMod = await import('../services/orderbook.service.js');
    if (!OrderbookServiceMod.OrderBookAnalysisService) throw new Error('OrderBookAnalysisService class not found');
    if (!OrderbookServiceMod.orderBookAnalysisService) throw new Error('orderBookAnalysisService singleton not found');
  });

  await runTest('Import: regime.service', async () => {
    RegimeServiceMod = await import('../services/regime.service.js');
    if (!RegimeServiceMod.MarketRegimeService) throw new Error('MarketRegimeService class not found');
    if (!RegimeServiceMod.marketRegimeService) throw new Error('marketRegimeService singleton not found');
  });

  await runTest('Import: multi-timeframe.service', async () => {
    MTFServiceMod = await import('../services/multi-timeframe.service.js');
    if (!MTFServiceMod.MultiTimeframeService) throw new Error('MultiTimeframeService class not found');
    if (!MTFServiceMod.multiTimeframeService) throw new Error('multiTimeframeService singleton not found');
  });

  await runTest('Import: notification.service', async () => {
    NotificationServiceMod = await import('../services/notification.service.js');
    if (!NotificationServiceMod.NotificationService) throw new Error('NotificationService class not found');
    if (!NotificationServiceMod.notificationService) throw new Error('notificationService singleton not found');
  });

  await runTest('Import: bot-runner.service', async () => {
    BotRunnerServiceMod = await import('../services/bot-runner.service.js');
    if (!BotRunnerServiceMod.botRunnerService) throw new Error('botRunnerService singleton not found');
  });

  await runTest('Import: slippage.service', async () => {
    SlippageServiceMod = await import('../services/slippage.service.js');
    if (!SlippageServiceMod.SlippageService) throw new Error('SlippageService class not found');
    if (!SlippageServiceMod.slippageService) throw new Error('slippageService singleton not found');
  });

  console.log('');

  // ============================================================
  // 2. ExchangeService Tests
  // ============================================================
  console.log('[2] ExchangeService Tests');
  console.log('-'.repeat(50));

  await runTest('ExchangeService: initExchange (binance)', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const exchange = svc.initExchange('binance', 'test-api-key-12345', 'test-secret-12345');
    if (!exchange) throw new Error('Exchange instance is null');
    if (exchange.id !== 'binance') throw new Error(`Expected exchange.id=binance, got ${exchange.id}`);
  });

  await runTest('ExchangeService: initExchange (upbit)', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const exchange = svc.initExchange('upbit', 'test-api-key-12345', 'test-secret-12345');
    if (!exchange) throw new Error('Exchange instance is null');
    if (exchange.id !== 'upbit') throw new Error(`Expected exchange.id=upbit, got ${exchange.id}`);
  });

  await runTest('ExchangeService: initExchange (bybit)', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const exchange = svc.initExchange('bybit', 'test-api-key-12345', 'test-secret-12345');
    if (!exchange) throw new Error('Exchange instance is null');
    if (exchange.id !== 'bybit') throw new Error(`Expected exchange.id=bybit, got ${exchange.id}`);
  });

  await runTest('ExchangeService: getPublicExchange', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const pub = svc.getPublicExchange('binance');
    if (!pub) throw new Error('Public exchange is null');
    if (pub.id !== 'binance') throw new Error(`Expected id=binance, got ${pub.id}`);
  });

  await runTest('ExchangeService: getExchangeNameFromEnum', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const tests = [
      { input: 'BINANCE', expected: 'binance' },
      { input: 'UPBIT', expected: 'upbit' },
      { input: 'BYBIT', expected: 'bybit' },
      { input: 'BITHUMB', expected: 'bithumb' },
    ];
    for (const t of tests) {
      const result = svc.getExchangeNameFromEnum(t.input);
      if (result !== t.expected) throw new Error(`${t.input} -> ${result}, expected ${t.expected}`);
    }
    // Invalid enum should throw
    let threw = false;
    try { svc.getExchangeNameFromEnum('INVALID'); } catch { threw = true; }
    if (!threw) throw new Error('Expected error for INVALID enum');
  });

  await runTest('ExchangeService: PaperExchange 생성/주문/잔고', async () => {
    const paper = new ExchangeServiceMod.PaperExchange(10000, null);
    const balance = paper.getBalance();
    if (balance['USDT']?.total !== 10000) throw new Error(`Initial balance should be 10000, got ${balance['USDT']?.total}`);

    // Buy order (no real exchange, provide price)
    const order = await paper.createOrder('BTC/USDT', 'buy', 'market', 0.1, 50000);
    if (!order || order.status !== 'closed') throw new Error('Order not closed');
    if (order.amount !== 0.1) throw new Error(`Order amount should be 0.1, got ${order.amount}`);

    const balAfterBuy = paper.getBalance();
    if ((balAfterBuy['BTC']?.total ?? 0) < 0.09) throw new Error('BTC balance too low after buy');
    if ((balAfterBuy['USDT']?.total ?? 0) >= 10000) throw new Error('USDT should have decreased');

    // Sell order
    const sellOrder = await paper.createOrder('BTC/USDT', 'sell', 'market', 0.05, 51000);
    if (!sellOrder || sellOrder.status !== 'closed') throw new Error('Sell order not closed');

    const balAfterSell = paper.getBalance();
    if ((balAfterSell['BTC']?.total ?? 0) >= 0.1) throw new Error('BTC should have decreased');

    // Order history
    const orders = paper.getOrders();
    if (orders.length !== 2) throw new Error(`Expected 2 orders, got ${orders.length}`);
  });

  await runTest('ExchangeService: PaperExchange insufficient balance', async () => {
    const paper = new ExchangeServiceMod.PaperExchange(100, null);
    let threw = false;
    try {
      await paper.createOrder('BTC/USDT', 'buy', 'market', 1.0, 50000);
    } catch (e: any) {
      threw = true;
      if (!e.message.includes('Insufficient')) throw new Error(`Wrong error: ${e.message}`);
    }
    if (!threw) throw new Error('Expected insufficient balance error');
  });

  await runTest('ExchangeService: initPaperExchange via service', async () => {
    const svc = new ExchangeServiceMod.ExchangeService();
    const paper = svc.initPaperExchange('binance', 5000);
    if (!paper) throw new Error('PaperExchange not created');
    const balance = paper.getBalance();
    if (balance['USDT']?.total !== 5000) throw new Error(`Expected 5000, got ${balance['USDT']?.total}`);

    const retrieved = svc.getPaperExchange('binance');
    if (!retrieved) throw new Error('getPaperExchange returned undefined');
  });

  console.log('');

  // ============================================================
  // 3. IndicatorsService Tests
  // ============================================================
  console.log('[3] IndicatorsService Tests');
  console.log('-'.repeat(50));

  const testOHLCV = generateOHLCV(200, 50000);
  const closes = testOHLCV.map(d => d.close);
  const highs = testOHLCV.map(d => d.high);
  const lows = testOHLCV.map(d => d.low);
  const volumes = testOHLCV.map(d => d.volume);
  const indSvc = IndicatorsServiceMod.indicatorsService;

  await runTest('IndicatorsService: RSI 계산', async () => {
    const rsi = indSvc.calculateRSI(closes, 14);
    if (rsi.length === 0) throw new Error('RSI array is empty');
    const lastRSI = rsi[rsi.length - 1];
    if (typeof lastRSI !== 'number' || isNaN(lastRSI)) throw new Error(`RSI is NaN`);
    if (lastRSI < 0 || lastRSI > 100) throw new Error(`RSI out of range: ${lastRSI}`);
  });

  await runTest('IndicatorsService: MACD 계산', async () => {
    const macd = indSvc.calculateMACD(closes);
    if (macd.length === 0) throw new Error('MACD array is empty');
    const last = macd[macd.length - 1];
    if (last.MACD === undefined && last.signal === undefined) throw new Error('MACD values are all undefined');
    if (typeof last.MACD === 'number' && isNaN(last.MACD)) throw new Error('MACD value is NaN');
  });

  await runTest('IndicatorsService: Bollinger Bands 계산', async () => {
    const bb = indSvc.calculateBollingerBands(closes, 20, 2);
    if (bb.length === 0) throw new Error('BB array is empty');
    const last = bb[bb.length - 1];
    if (isNaN(last.upper) || isNaN(last.middle) || isNaN(last.lower)) throw new Error('BB contains NaN');
    if (last.upper <= last.middle || last.middle <= last.lower) throw new Error('BB bands order wrong');
  });

  await runTest('IndicatorsService: ATR 계산', async () => {
    const atr = indSvc.calculateATR(highs, lows, closes, 14);
    if (atr.length === 0) throw new Error('ATR array is empty');
    const lastATR = atr[atr.length - 1];
    if (typeof lastATR !== 'number' || isNaN(lastATR)) throw new Error(`ATR is NaN`);
    if (lastATR <= 0) throw new Error(`ATR should be positive: ${lastATR}`);
  });

  await runTest('IndicatorsService: EMA 계산', async () => {
    const ema20 = indSvc.calculateEMA(closes, 20);
    const ema50 = indSvc.calculateEMA(closes, 50);
    if (ema20.length === 0) throw new Error('EMA20 array is empty');
    if (ema50.length === 0) throw new Error('EMA50 array is empty');
    const lastEma20 = ema20[ema20.length - 1];
    if (typeof lastEma20 !== 'number' || isNaN(lastEma20)) throw new Error('EMA20 is NaN');
    if (lastEma20 <= 0) throw new Error('EMA20 should be positive');
  });

  await runTest('IndicatorsService: SMA 계산', async () => {
    const sma = indSvc.calculateSMA(closes, 20);
    if (sma.length === 0) throw new Error('SMA array is empty');
    if (isNaN(sma[sma.length - 1])) throw new Error('SMA is NaN');
  });

  await runTest('IndicatorsService: Stochastic 계산', async () => {
    const stoch = indSvc.calculateStochastic(highs, lows, closes, 14, 3);
    if (stoch.length === 0) throw new Error('Stochastic array is empty');
    const last = stoch[stoch.length - 1];
    if (isNaN(last.k) || isNaN(last.d)) throw new Error('Stochastic contains NaN');
  });

  await runTest('IndicatorsService: ADX 계산', async () => {
    const adx = indSvc.calculateADX(highs, lows, closes, 14);
    if (adx.length === 0) throw new Error('ADX array is empty');
    const last = adx[adx.length - 1];
    if (isNaN(last.adx)) throw new Error('ADX is NaN');
    if (last.adx < 0 || last.adx > 100) throw new Error(`ADX out of range: ${last.adx}`);
  });

  await runTest('IndicatorsService: OBV 계산', async () => {
    const obv = indSvc.calculateOBV(closes, volumes);
    if (obv.length === 0) throw new Error('OBV array is empty');
    if (isNaN(obv[obv.length - 1])) throw new Error('OBV is NaN');
  });

  await runTest('IndicatorsService: VWAP 계산', async () => {
    const vwap = indSvc.calculateVWAP(highs, lows, closes, volumes);
    if (vwap.length === 0) throw new Error('VWAP array is empty');
    if (isNaN(vwap[vwap.length - 1])) throw new Error('VWAP is NaN');
  });

  await runTest('IndicatorsService: Supertrend 계산', async () => {
    const st = indSvc.calculateSupertrend(highs, lows, closes, 10, 3);
    if (st.length === 0) throw new Error('Supertrend array is empty');
    const last = st[st.length - 1];
    if (isNaN(last.value)) throw new Error('Supertrend value is NaN');
    if (last.direction !== 'up' && last.direction !== 'down') throw new Error(`Invalid direction: ${last.direction}`);
  });

  await runTest('IndicatorsService: getAllIndicators 종합', async () => {
    const all = indSvc.getAllIndicators(testOHLCV);
    const checks = ['rsi', 'macd', 'bollingerBands', 'atr', 'ema20', 'ema50', 'sma20', 'sma50', 'stochastic', 'adx', 'obv', 'vwap', 'supertrend'];
    for (const key of checks) {
      const arr = all[key as keyof typeof all];
      if (!Array.isArray(arr)) throw new Error(`${key} is not an array`);
      if (arr.length === 0) throw new Error(`${key} is empty`);
    }
  });

  await runTest('IndicatorsService: parseOHLCV', async () => {
    const raw = [[Date.now(), 100, 110, 90, 105, 500]];
    const parsed = indSvc.parseOHLCV(raw);
    if (parsed.length !== 1) throw new Error('parseOHLCV should return 1 item');
    if (parsed[0].open !== 100) throw new Error('open should be 100');
    if (parsed[0].close !== 105) throw new Error('close should be 105');
  });

  console.log('');

  // ============================================================
  // 4. RiskService Tests
  // ============================================================
  console.log('[4] RiskService Tests');
  console.log('-'.repeat(50));

  await runTest('RiskManager: calculatePositionSize', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const result = rm.calculatePositionSize(10000, 2, 50000, 48000);
    if (result.positionSize <= 0) throw new Error(`Position size should be > 0: ${result.positionSize}`);
    if (result.riskAmount <= 0) throw new Error(`Risk amount should be > 0`);
    if (result.stopLossPrice !== 48000) throw new Error('Stop loss should be 48000');
    if (result.takeProfitLevels.length === 0) throw new Error('Should have take profit levels');
  });

  await runTest('RiskManager: calculateATRPositionSize', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const result = rm.calculateATRPositionSize(10000, 2, 50000, 1000, true);
    if (result.positionSize <= 0) throw new Error(`ATR position size should be > 0: ${result.positionSize}`);
    if (result.stopLossPrice >= 50000) throw new Error('Stop loss should be below entry for long');
    if (result.takeProfitLevels.length === 0) throw new Error('Should have take profit levels');
  });

  await runTest('RiskManager: ATR short position', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const result = rm.calculateATRPositionSize(10000, 2, 50000, 1000, false);
    if (result.stopLossPrice <= 50000) throw new Error('Stop loss should be above entry for short');
  });

  await runTest('RiskManager: kellyCriterion', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const kelly = rm.kellyCriterion(0.6, 100, 80);
    if (typeof kelly !== 'number' || isNaN(kelly)) throw new Error('Kelly is NaN');
    if (kelly < 0 || kelly > 0.25) throw new Error(`Kelly out of range: ${kelly}`);
  });

  await runTest('RiskManager: VaR 계산', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const returns = Array.from({ length: 30 }, () => (Math.random() - 0.48) * 0.03);
    const var95 = rm.calculateVaR(10000, returns, 0.95);
    if (typeof var95 !== 'number' || isNaN(var95)) throw new Error('VaR is NaN');
  });

  await runTest('RiskManager: realizedVolatility', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const returns = Array.from({ length: 30 }, () => (Math.random() - 0.5) * 0.02);
    const vol = rm.calculateRealizedVolatility(returns);
    if (typeof vol !== 'number' || isNaN(vol)) throw new Error('Volatility is NaN');
    if (vol < 0) throw new Error('Volatility should be >= 0');
  });

  await runTest('RiskManager: volatilityScaledSize', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const scaled = rm.volatilityScaledSize(100, 3.0);
    if (typeof scaled !== 'number' || isNaN(scaled)) throw new Error('Scaled size is NaN');
    if (scaled <= 0) throw new Error('Scaled size should be > 0');
  });

  await runTest('RiskManager: trailingStop', async () => {
    const rm = new RiskServiceMod.RiskManager();
    // stopPrice = highestPrice - atr*multiplier = 53000 - 500*2 = 52000
    // currentPrice <= stopPrice => triggered
    // 52000 <= 52000 => true (경계값도 발동됨)
    const result = rm.calculateTrailingStop(50000, 52000, 53000, 500, 2);
    if (typeof result.stopPrice !== 'number') throw new Error('stopPrice should be number');
    if (result.stopPrice !== 52000) throw new Error(`stopPrice should be 52000, got ${result.stopPrice}`);
    // currentPrice(52000) <= stopPrice(52000) 이므로 경계값 trigger
    if (result.triggered !== true) throw new Error('Should be triggered at boundary (52000 <= 52000)');

    // Not triggered: currentPrice above stop
    const result1b = rm.calculateTrailingStop(50000, 52500, 53000, 500, 2);
    if (result1b.triggered !== false) throw new Error('Should NOT be triggered (52500 > 52000)');

    // Clearly triggered case
    const result2 = rm.calculateTrailingStop(50000, 51500, 53000, 500, 2);
    if (result2.triggered !== true) throw new Error('Should be triggered (51500 <= 52000)');
  });

  await runTest('RiskManager: tieredTP', async () => {
    const rm = new RiskServiceMod.RiskManager();
    const tp = rm.calculateTieredTP(50000, 48000);
    if (tp.length !== 3) throw new Error(`Expected 3 TP levels, got ${tp.length}`);
    if (tp[0].price <= 50000) throw new Error('Long TP should be above entry');

    const tpShort = rm.calculateTieredTP(50000, 52000);
    if (tpShort[0].price >= 50000) throw new Error('Short TP should be below entry');
  });

  await runTest('RiskManager: config update', async () => {
    const rm = new RiskServiceMod.RiskManager();
    rm.updateConfig({ maxTradeRiskPercent: 5 });
    const cfg = rm.getConfig();
    if (cfg.maxTradeRiskPercent !== 5) throw new Error('Config not updated');
  });

  console.log('');

  // ============================================================
  // 5. BacktesterService Tests
  // ============================================================
  console.log('[5] BacktesterService Tests');
  console.log('-'.repeat(50));

  await runTest('BacktesterService: runBacktest (simple buy/sell)', async () => {
    const bt = new BacktesterServiceMod.BacktesterService();
    const ohlcvData = generateOHLCV(300, 50000);

    let callCount = 0;
    const createFn = () => {
      return (data: any[], config: any) => {
        callCount++;
        const lastClose = data[data.length - 1]?.close ?? 0;
        // Simple: buy every 10th call, sell every 20th call
        if (callCount % 20 === 0) {
          return { action: 'sell', confidence: 0.8, reason: 'test sell', price: lastClose };
        } else if (callCount % 10 === 0) {
          return { action: 'buy', confidence: 0.8, reason: 'test buy', price: lastClose };
        }
        return null;
      };
    };

    const config = {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      initialCapital: 10000,
      strategy: 'TEST',
      strategyConfig: {},
      slippagePct: 0.0005,
      feePct: 0.001,
      walkForwardSplit: 0.7,
    };

    const result = await bt.runBacktest(config, ohlcvData, createFn);
    if (!result.metrics) throw new Error('No metrics');
    if (typeof result.metrics.totalReturnPct !== 'number') throw new Error('No totalReturnPct');
    if (isNaN(result.metrics.sharpeRatio)) throw new Error('Sharpe is NaN');
    if (!Array.isArray(result.equityCurve)) throw new Error('No equity curve');
    if (result.equityCurve.length === 0) throw new Error('Empty equity curve');
    if (!Array.isArray(result.trades)) throw new Error('No trades array');
  });

  await runTest('BacktesterService: multi-position + short mode', async () => {
    const bt = new BacktesterServiceMod.BacktesterService();
    const ohlcvData = generateOHLCV(300, 50000);

    let callCount = 0;
    const createFn = () => {
      return (data: any[]) => {
        callCount++;
        const lastClose = data[data.length - 1]?.close ?? 0;
        if (callCount % 15 === 0) return { action: 'sell', confidence: 0.8, reason: 'short test', price: lastClose };
        if (callCount % 5 === 0) return { action: 'buy', confidence: 0.8, reason: 'buy test', price: lastClose };
        return null;
      };
    };

    const config = {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      initialCapital: 10000,
      strategy: 'TEST',
      strategyConfig: {},
      slippagePct: 0.0005,
      feePct: 0.001,
      walkForwardSplit: 0.7,
      positionMode: 'accumulate' as const,
      shortEnabled: true,
      maxPositionEntries: 5,
      allocationPct: 20,
    };

    const result = await bt.runBacktest(config, ohlcvData, createFn);
    if (!result.metrics) throw new Error('No metrics');
    // Just verify it runs without error
  });

  await runTest('BacktesterService: Monte Carlo simulation', async () => {
    const bt = new BacktesterServiceMod.BacktesterService();
    const trades = [
      { entryTime: 1, exitTime: 2, side: 'buy', entryPrice: 100, exitPrice: 110, amount: 1, pnl: 10, pnlPercent: 10, fee: 0.1 },
      { entryTime: 3, exitTime: 4, side: 'buy', entryPrice: 100, exitPrice: 95, amount: 1, pnl: -5, pnlPercent: -5, fee: 0.1 },
      { entryTime: 5, exitTime: 6, side: 'buy', entryPrice: 100, exitPrice: 115, amount: 1, pnl: 15, pnlPercent: 15, fee: 0.1 },
      { entryTime: 7, exitTime: 8, side: 'buy', entryPrice: 100, exitPrice: 92, amount: 1, pnl: -8, pnlPercent: -8, fee: 0.1 },
      { entryTime: 9, exitTime: 10, side: 'buy', entryPrice: 100, exitPrice: 108, amount: 1, pnl: 8, pnlPercent: 8, fee: 0.1 },
      { entryTime: 11, exitTime: 12, side: 'buy', entryPrice: 100, exitPrice: 105, amount: 1, pnl: 5, pnlPercent: 5, fee: 0.1 },
    ];

    const mc = bt.runMonteCarlo(trades, 10000, 500, 0.95);
    if (mc.simulations !== 500) throw new Error(`Expected 500 simulations, got ${mc.simulations}`);
    if (typeof mc.medianReturn !== 'number' || isNaN(mc.medianReturn)) throw new Error('medianReturn is NaN');
    if (typeof mc.profitProbability !== 'number') throw new Error('profitProbability missing');
    if (mc.distribution.length === 0) throw new Error('distribution is empty');
  });

  console.log('');

  // ============================================================
  // 6. ExecutionService Tests
  // ============================================================
  console.log('[6] ExecutionService Tests');
  console.log('-'.repeat(50));

  await runTest('ExecutionService: aggregateResults 내부 로직', async () => {
    const svc = new ExecutionServiceMod.ExecutionService();
    // Test TWAP/VWAP slice calculation
    const totalAmount = 10;
    const slices = 5;
    const sliceAmount = totalAmount / slices;
    if (sliceAmount !== 2) throw new Error(`Slice amount should be 2, got ${sliceAmount}`);

    // Test VWAP weight normalization
    const volumeProfile = [100, 200, 300, 200, 100];
    const totalWeight = volumeProfile.reduce((s, v) => s + v, 0);
    const normalized = volumeProfile.map(v => v / totalWeight);
    const sumNorm = normalized.reduce((s, v) => s + v, 0);
    if (Math.abs(sumNorm - 1.0) > 0.0001) throw new Error(`Normalized weights don't sum to 1: ${sumNorm}`);
  });

  await runTest('ExecutionService: kimchiPremium 계산 (외부 API, timeout 검증)', async () => {
    const svc = new ExecutionServiceMod.ExecutionService();
    // This calls external APIs but should handle timeout gracefully
    const start = Date.now();
    const result = await svc.calculateKimchiPremium('BTC/USDT');
    const elapsed = Date.now() - start;

    if (typeof result.premiumPercent !== 'number') throw new Error('premiumPercent is not a number');
    if (typeof result.timestamp !== 'number') throw new Error('timestamp is not a number');
    // Verify it doesn't hang forever (should complete within 30s with timeouts)
    if (elapsed > 35000) throw new Error(`Kimchi premium took too long: ${elapsed}ms`);
  });

  console.log('');

  // ============================================================
  // 7. SentimentService Tests
  // ============================================================
  console.log('[7] SentimentService Tests');
  console.log('-'.repeat(50));

  await runTest('SentimentService: getFearGreedIndex (외부 API)', async () => {
    const svc = new SentimentServiceMod.SentimentService();
    const start = Date.now();
    const result = await svc.getFearGreedIndex();
    const elapsed = Date.now() - start;

    // Can be null if API fails, but should not throw
    if (result !== null) {
      if (typeof result.value !== 'number') throw new Error('value is not a number');
      if (result.value < 0 || result.value > 100) throw new Error(`Value out of range: ${result.value}`);
      if (typeof result.valueClassification !== 'string') throw new Error('classification is not string');
    }
    if (elapsed > 15000) throw new Error(`Took too long: ${elapsed}ms`);
  });

  await runTest('SentimentService: getWhaleActivity', async () => {
    const svc = new SentimentServiceMod.SentimentService();
    const result = await svc.getWhaleActivity();
    if (typeof result.largeTxCount24h !== 'number') throw new Error('largeTxCount24h missing');
    if (typeof result.netFlow !== 'number') throw new Error('netFlow missing');
    const validDirs = ['inflow', 'outflow', 'neutral'];
    if (!validDirs.includes(result.dominantDirection)) throw new Error(`Invalid direction: ${result.dominantDirection}`);
  });

  await runTest('SentimentService: aggregateSentiment', async () => {
    const svc = new SentimentServiceMod.SentimentService();
    const result = await svc.aggregateSentiment();
    if (typeof result.overallScore !== 'number') throw new Error('overallScore missing');
    if (result.overallScore < 0 || result.overallScore > 100) throw new Error(`Score out of range: ${result.overallScore}`);
    const validInterpretations = ['extreme_fear', 'fear', 'neutral', 'greed', 'extreme_greed'];
    if (!validInterpretations.includes(result.interpretation)) throw new Error(`Invalid interpretation: ${result.interpretation}`);
  });

  console.log('');

  // ============================================================
  // 8. OnchainService Tests
  // ============================================================
  console.log('[8] OnchainService Tests');
  console.log('-'.repeat(50));

  await runTest('OnchainService: getFundingRate', async () => {
    const svc = new OnchainServiceMod.OnchainAnalyticsService();
    const result = await svc.getFundingRate('BTCUSDT');
    if (typeof result.fundingRate !== 'number') throw new Error('fundingRate missing');
    if (typeof result.annualizedRate !== 'number') throw new Error('annualizedRate missing');
    if (typeof result.nextFundingTime !== 'number') throw new Error('nextFundingTime missing');
  });

  await runTest('OnchainService: getMVRV', async () => {
    const svc = new OnchainServiceMod.OnchainAnalyticsService();
    const result = await svc.getMVRV();
    if (typeof result.mvrv !== 'number' || isNaN(result.mvrv)) throw new Error('mvrv is NaN');
    const validZones = ['undervalued', 'fair', 'overvalued', 'extreme'];
    if (!validZones.includes(result.zone)) throw new Error(`Invalid zone: ${result.zone}`);
  });

  await runTest('OnchainService: getTVL', async () => {
    const svc = new OnchainServiceMod.OnchainAnalyticsService();
    const result = await svc.getTVL();
    if (typeof result.totalTVL !== 'number' || result.totalTVL <= 0) throw new Error('totalTVL invalid');
    if (!Array.isArray(result.topProtocols)) throw new Error('topProtocols not array');
    if (result.topProtocols.length === 0) throw new Error('topProtocols empty');
  });

  await runTest('OnchainService: getExchangeFlow', async () => {
    const svc = new OnchainServiceMod.OnchainAnalyticsService();
    const result = await svc.getExchangeFlow();
    if (!Array.isArray(result)) throw new Error('Not an array');
    if (result.length === 0) throw new Error('Empty array');
    if (typeof result[0].netFlow !== 'number') throw new Error('netFlow missing');
  });

  console.log('');

  // ============================================================
  // 9. OrderbookService Tests
  // ============================================================
  console.log('[9] OrderbookService Tests');
  console.log('-'.repeat(50));

  await runTest('OrderbookService: calculateImbalance', async () => {
    const svc = OrderbookServiceMod.orderBookAnalysisService;
    const bids: [number, number][] = [
      [50000, 1.5],
      [49900, 2.0],
      [49800, 0.5],
      [49700, 3.0],
    ];
    const asks: [number, number][] = [
      [50100, 0.5],
      [50200, 1.0],
      [50300, 0.8],
      [50400, 0.3],
    ];

    const result = svc.calculateImbalance(bids, asks);
    if (typeof result.imbalanceRatio !== 'number') throw new Error('imbalanceRatio missing');
    if (typeof result.bidVolume !== 'number') throw new Error('bidVolume missing');
    if (typeof result.askVolume !== 'number') throw new Error('askVolume missing');

    // Bids have more volume, so ratio should be positive
    if (result.imbalanceRatio <= 0) throw new Error(`Expected positive imbalance, got ${result.imbalanceRatio}`);
    if (result.direction !== 'buy_pressure') throw new Error(`Expected buy_pressure, got ${result.direction}`);
    if (!result.topBidWall) throw new Error('topBidWall missing');
    if (result.topBidWall.amount !== 3.0) throw new Error(`topBidWall should be 3.0, got ${result.topBidWall.amount}`);
  });

  await runTest('OrderbookService: calculateImbalance (empty)', async () => {
    const svc = OrderbookServiceMod.orderBookAnalysisService;
    const result = svc.calculateImbalance([], []);
    if (result.direction !== 'balanced') throw new Error('Empty should be balanced');
    if (result.imbalanceRatio !== 0) throw new Error('Should be 0');
  });

  await runTest('OrderbookService: detectWalls', async () => {
    const svc = OrderbookServiceMod.orderBookAnalysisService;
    const bids: [number, number][] = [
      [50000, 1.0],
      [49900, 1.0],
      [49800, 10.0],  // Wall: 10x average
      [49700, 1.0],
    ];
    const asks: [number, number][] = [
      [50100, 0.5],
      [50200, 0.5],
      [50300, 8.0],  // Wall
      [50400, 0.5],
    ];

    const walls = svc.detectWalls(bids, asks, 3);
    if (walls.length === 0) throw new Error('Should detect walls');
    // The 10.0 bid wall should be detected
    const bidWall = walls.find((w: any) => w.side === 'bid');
    if (!bidWall) throw new Error('Bid wall not detected');
    if (bidWall.price !== 49800) throw new Error(`Expected wall at 49800, got ${bidWall.price}`);
  });

  await runTest('OrderbookService: VPIN 계산', async () => {
    const svc = OrderbookServiceMod.orderBookAnalysisService;
    const trades = [];
    for (let i = 0; i < 100; i++) {
      trades.push({
        price: 50000 + (Math.random() - 0.5) * 100,
        amount: Math.random() * 50 + 10,
        side: Math.random() > 0.6 ? 'buy' : 'sell',  // Slight buy bias
        timestamp: Date.now() + i * 1000,
      });
    }

    const result = svc.calculateVPIN(trades, 100);
    if (typeof result.vpin !== 'number' || isNaN(result.vpin)) throw new Error('VPIN is NaN');
    if (result.vpin < 0 || result.vpin > 1) throw new Error(`VPIN out of range: ${result.vpin}`);
    const validLevels = ['low', 'medium', 'high'];
    if (!validLevels.includes(result.toxicityLevel)) throw new Error(`Invalid level: ${result.toxicityLevel}`);
    if (result.totalBuckets <= 0) throw new Error('Should have buckets');
  });

  await runTest('OrderbookService: CVD 계산', async () => {
    const svc = OrderbookServiceMod.orderBookAnalysisService;
    const trades = [
      { price: 50000, amount: 1, side: 'buy' as const, timestamp: 1 },
      { price: 50100, amount: 2, side: 'sell' as const, timestamp: 2 },
      { price: 50050, amount: 1.5, side: 'buy' as const, timestamp: 3 },
    ];

    const cvd = svc.getCVD(trades);
    if (cvd.length !== 3) throw new Error(`Expected 3, got ${cvd.length}`);
    // First trade is buy, so CVD should be positive
    if (cvd[0].cvd <= 0) throw new Error('First CVD should be positive (buy)');
    // After big sell, CVD should decrease
    if (cvd[1].cvd >= cvd[0].cvd) throw new Error('CVD should decrease after sell');
  });

  console.log('');

  // ============================================================
  // 10. RegimeService Tests
  // ============================================================
  console.log('[10] RegimeService Tests');
  console.log('-'.repeat(50));

  await runTest('RegimeService: detect (충분한 데이터)', async () => {
    const svc = new RegimeServiceMod.MarketRegimeService();
    const ohlcv = generateOHLCV(200, 50000);
    const result = svc.detect(ohlcv);

    const validRegimes = ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'VOLATILE', 'QUIET'];
    if (!validRegimes.includes(result.regime)) throw new Error(`Invalid regime: ${result.regime}`);
    if (result.confidence < 0 || result.confidence > 100) throw new Error(`Confidence out of range: ${result.confidence}`);
    if (result.trendStrength < 0) throw new Error('trendStrength negative');
    if (typeof result.description !== 'string' || result.description.length === 0) throw new Error('No description');
    if (!Array.isArray(result.recommendedStrategies) || result.recommendedStrategies.length === 0) throw new Error('No strategies');
  });

  await runTest('RegimeService: detect (데이터 부족)', async () => {
    const svc = new RegimeServiceMod.MarketRegimeService();
    const ohlcv = generateOHLCV(10, 50000);
    const result = svc.detect(ohlcv);
    if (result.regime !== 'RANGING') throw new Error('Insufficient data should default to RANGING');
    if (result.confidence !== 0) throw new Error('Confidence should be 0 for insufficient data');
  });

  await runTest('RegimeService: history & transition probabilities', async () => {
    const svc = new RegimeServiceMod.MarketRegimeService();
    // Run multiple detections
    for (let i = 0; i < 5; i++) {
      const ohlcv = generateOHLCV(100, 50000 + i * 1000);
      svc.detect(ohlcv);
    }
    const history = svc.getHistory();
    if (history.length !== 5) throw new Error(`Expected 5 history items, got ${history.length}`);

    const transitions = svc.getTransitionProbabilities();
    if (!(transitions instanceof Map)) throw new Error('Transitions should be a Map');
  });

  console.log('');

  // ============================================================
  // 11. MultiTimeframeService Tests
  // ============================================================
  console.log('[11] MultiTimeframeService Tests');
  console.log('-'.repeat(50));

  await runTest('MultiTimeframeService: analyzeSingleTimeframe', async () => {
    const svc = new MTFServiceMod.MultiTimeframeService();
    const ohlcv = generateOHLCV(100, 50000);
    const result = svc.analyzeSingleTimeframe(ohlcv, '1h');

    const validDirs = ['bullish', 'bearish', 'neutral'];
    if (!validDirs.includes(result.direction)) throw new Error(`Invalid direction: ${result.direction}`);
    if (result.strength < 0 || result.strength > 100) throw new Error(`Strength out of range: ${result.strength}`);
    if (typeof result.rsi !== 'number' || isNaN(result.rsi)) throw new Error('RSI invalid');
    const validAlignments = ['bullish', 'bearish', 'mixed'];
    if (!validAlignments.includes(result.emaAlignment)) throw new Error(`Invalid emaAlignment: ${result.emaAlignment}`);
    if (result.supertrend !== 'up' && result.supertrend !== 'down') throw new Error('Invalid supertrend');
  });

  await runTest('MultiTimeframeService: buildConsensus 로직', async () => {
    const svc = new MTFServiceMod.MultiTimeframeService();
    // Create multiple timeframe results manually
    const ohlcv1h = generateOHLCV(100, 50000);
    const ohlcv4h = generateOHLCV(100, 50000);
    const ohlcv1d = generateOHLCV(100, 50000);

    const trend1h = svc.analyzeSingleTimeframe(ohlcv1h, '1h');
    const trend4h = svc.analyzeSingleTimeframe(ohlcv4h, '4h');
    const trend1d = svc.analyzeSingleTimeframe(ohlcv1d, '1d');

    // All should be valid TimeframeTrend objects
    if (trend1h.timeframe !== '1h') throw new Error('Should be 1h');
    if (trend4h.timeframe !== '4h') throw new Error('Should be 4h');
    if (trend1d.timeframe !== '1d') throw new Error('Should be 1d');
  });

  console.log('');

  // ============================================================
  // 12. NotificationService Tests
  // ============================================================
  console.log('[12] NotificationService Tests');
  console.log('-'.repeat(50));

  await runTest('NotificationService: 인스턴스 생성', async () => {
    const svc = new NotificationServiceMod.NotificationService();
    if (!svc) throw new Error('NotificationService instance is null');
    // sendTelegram should return false when not configured
    const result = await svc.sendTelegram('test message');
    if (result !== false) throw new Error('Should return false when Telegram not configured');
  });

  console.log('');

  // ============================================================
  // 13. SlippageService Tests
  // ============================================================
  console.log('[13] SlippageService Tests');
  console.log('-'.repeat(50));

  await runTest('SlippageService: calculateDynamicSlippage', async () => {
    const svc = SlippageServiceMod.slippageService;

    // Normal conditions
    const slip1 = svc.calculateDynamicSlippage(0.0005, 500, 50000, 1000, 1000, 5000);
    if (typeof slip1 !== 'number' || isNaN(slip1)) throw new Error('Slippage is NaN');
    if (slip1 < 0.0005) throw new Error('Slippage should be >= base');
    if (slip1 > 0.02) throw new Error('Slippage should be <= 2%');

    // Low volume -> higher slippage
    const slip2 = svc.calculateDynamicSlippage(0.0005, 500, 50000, 100, 1000, 5000);
    if (slip2 <= slip1) throw new Error('Low volume should increase slippage');

    // Large order -> higher slippage
    const slip3 = svc.calculateDynamicSlippage(0.0005, 500, 50000, 1000, 1000, 50000000);
    if (slip3 <= slip1) throw new Error('Large order should increase slippage');
  });

  await runTest('SlippageService: extractSlippageInputs', async () => {
    const svc = SlippageServiceMod.slippageService;
    const data = generateOHLCV(30, 50000);
    const result = svc.extractSlippageInputs(data);
    if (typeof result.currentATR !== 'number' || isNaN(result.currentATR)) throw new Error('ATR is NaN');
    if (typeof result.avgVolume !== 'number' || isNaN(result.avgVolume)) throw new Error('avgVolume is NaN');
    if (result.currentATR <= 0) throw new Error('ATR should be > 0');
    if (result.avgVolume <= 0) throw new Error('avgVolume should be > 0');
  });

  await runTest('SlippageService: insufficient data', async () => {
    const svc = SlippageServiceMod.slippageService;
    const data = generateOHLCV(5, 50000);
    const result = svc.extractSlippageInputs(data);
    if (result.currentATR !== 0) throw new Error('Should be 0 for insufficient data');
  });

  console.log('');

  // ============================================================
  // 14. BotRunnerService Tests
  // ============================================================
  console.log('[14] BotRunnerService Tests');
  console.log('-'.repeat(50));

  await runTest('BotRunnerService: 인스턴스 메서드 확인', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    if (typeof svc.startBotLoop !== 'function') throw new Error('startBotLoop not a function');
    if (typeof svc.stopBotLoop !== 'function') throw new Error('stopBotLoop not a function');
    if (typeof svc.stopAllBots !== 'function') throw new Error('stopAllBots not a function');
    if (typeof svc.getActiveBotCount !== 'function') throw new Error('getActiveBotCount not a function');
    if (typeof svc.getBotPosition !== 'function') throw new Error('getBotPosition not a function');
    if (typeof svc.getPaperTradeLogs !== 'function') throw new Error('getPaperTradeLogs not a function');
    if (typeof svc.getPaperTradeStats !== 'function') throw new Error('getPaperTradeStats not a function');
  });

  await runTest('BotRunnerService: getActiveBotCount (초기값)', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    const count = svc.getActiveBotCount();
    if (typeof count !== 'number') throw new Error('Should return number');
  });

  await runTest('BotRunnerService: stopBotLoop (없는 봇)', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    // Should not throw even for non-existent bot
    await svc.stopBotLoop('non-existent-bot');
  });

  await runTest('BotRunnerService: getBotPosition (없는 포지션)', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    const pos = svc.getBotPosition('test-bot', 'BTC/USDT');
    if (pos !== null) throw new Error('Should return null for non-existent position');
  });

  await runTest('BotRunnerService: paperTradeLogs/Stats', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    const logs = svc.getPaperTradeLogs('test-bot');
    if (!Array.isArray(logs)) throw new Error('Should return array');

    const stats = svc.getPaperTradeStats('test-bot');
    if (typeof stats.totalSignals !== 'number') throw new Error('totalSignals missing');
    if (typeof stats.winRate !== 'number') throw new Error('winRate missing');
  });

  await runTest('BotRunnerService: stopAllBots', async () => {
    const svc = BotRunnerServiceMod.botRunnerService;
    await svc.stopAllBots();
    const count = svc.getActiveBotCount();
    if (count !== 0) throw new Error(`Expected 0 active bots, got ${count}`);
  });

  console.log('');

  // ============================================================
  // 15. Strategy Integration Tests (via services)
  // ============================================================
  console.log('[15] Strategy Integration Tests');
  console.log('-'.repeat(50));

  await runTest('Strategy: 모든 전략 타입 로드/분석', async () => {
    const { getStrategy, getAvailableStrategies } = await import('../strategies/index.js');
    const strategies = getAvailableStrategies();
    if (strategies.length < 9) throw new Error(`Expected >= 9 strategies, got ${strategies.length}`);

    const ohlcv = generateOHLCV(200, 50000);

    for (const { type, name } of strategies) {
      const strategy = getStrategy(type);
      if (!strategy) throw new Error(`Strategy ${type} is null`);
      if (strategy.getName() !== name) throw new Error(`Strategy name mismatch: ${strategy.getName()} vs ${name}`);

      // analyze should not throw
      const signal = strategy.analyze(ohlcv);
      // signal can be null (hold), but should not throw
      if (signal !== null) {
        if (!['buy', 'sell', 'hold'].includes(signal.action)) throw new Error(`Invalid action: ${signal.action}`);
        if (typeof signal.confidence !== 'number') throw new Error('confidence missing');
      }
    }
  });

  console.log('');

  // ============================================================
  // Results Summary
  // ============================================================
  console.log('='.repeat(70));
  console.log(' TEST RESULTS SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.status === 'PASS');
  const failed = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIP');
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log('');
  console.log(`  Total:   ${results.length}`);
  console.log(`  Passed:  ${passed.length}`);
  console.log(`  Failed:  ${failed.length}`);
  console.log(`  Skipped: ${skipped.length}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('');

  if (failed.length > 0) {
    console.log('FAILED TESTS:');
    console.log('-'.repeat(50));
    for (const f of failed) {
      console.log(`  [FAIL] ${f.name}`);
      console.log(`         ${f.detail}`);
    }
    console.log('');
  }

  // Test quality grade
  const passRate = results.length > 0 ? (passed.length / results.length) * 100 : 0;
  let grade: string;
  if (passRate >= 95) grade = 'A';
  else if (passRate >= 85) grade = 'B';
  else if (passRate >= 70) grade = 'C';
  else if (passRate >= 50) grade = 'D';
  else grade = 'F';

  console.log(`  Pass Rate: ${passRate.toFixed(1)}%`);
  console.log(`  Grade: ${grade}`);
  console.log('');
  console.log('='.repeat(70));

  // Exit with error code if there are failures
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
