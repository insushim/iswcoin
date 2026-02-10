import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId, parseJsonBody } from '../utils';

type BacktestEnv = { Bindings: Env; Variables: AppVariables };

export const backtestRoutes = new Hono<BacktestEnv>();

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin', XRPUSDT: 'ripple', ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin', AVAXUSDT: 'avalanche-2', DOTUSDT: 'polkadot',
  MATICUSDT: 'matic-network', LINKUSDT: 'chainlink', UNIUSDT: 'uniswap',
  'BTC/USDT': 'bitcoin', 'ETH/USDT': 'ethereum', 'SOL/USDT': 'solana',
};

// ============ Fetch Real Historical Data ============

interface DailyPrice {
  date: string;       // ISO string
  timestamp: number;  // ms
  price: number;
  high: number;
  low: number;
}

async function fetchHistoricalPrices(
  symbol: string, startDate: string, endDate: string
): Promise<DailyPrice[]> {
  const clean = symbol.replace('/', '');
  const coinId = SYMBOL_TO_COINGECKO[clean] || SYMBOL_TO_COINGECKO[symbol];
  if (!coinId) throw new Error(`지원하지 않는 종목: ${symbol}`);

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const now = Date.now();

  // CoinGecko free API: use /market_chart?days=N (daily granularity for >90 days)
  // Calculate days from endDate to now, then we'll filter to our range
  const daysFromNow = Math.ceil((now - startMs) / 86400000);
  const days = Math.min(daysFromNow, 365); // Max 365 days for free API

  const res = await fetch(
    `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
    { headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoSentinel/1.0' } }
  );

  if (!res.ok) {
    throw new Error(`CoinGecko API 오류: ${res.status}`);
  }

  const data = await res.json() as { prices?: number[][] };
  const rawPrices = data.prices || [];

  if (rawPrices.length < 2) {
    throw new Error('가격 데이터가 부족합니다. 기간을 확인해주세요.');
  }

  // Convert to daily prices, filter to requested range, dedup by day
  const dailyMap = new Map<string, DailyPrice>();
  for (const [ts, price] of rawPrices) {
    // Filter to requested date range
    if (ts < startMs || ts > endMs + 86400000) continue;

    const d = new Date(ts);
    const dayKey = d.toISOString().slice(0, 10);
    const existing = dailyMap.get(dayKey);
    if (!existing) {
      dailyMap.set(dayKey, {
        date: d.toISOString(),
        timestamp: ts,
        price,
        high: price,
        low: price,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
    }
  }

  const result = Array.from(dailyMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  if (result.length < 2) {
    throw new Error(`선택한 기간(${startDate} ~ ${endDate})에 가격 데이터가 부족합니다. 최근 1년 이내 기간을 선택해주세요.`);
  }

  return result;
}

// ============ Technical Indicators ============

function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcBollingerBands(prices: number[], period: number = 20, stdMult: number = 2) {
  const sma = calcSMA(prices, period);
  const slice = prices.slice(-Math.min(period, prices.length));
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / slice.length;
  const std = Math.sqrt(variance);
  return { upper: sma + stdMult * std, middle: sma, lower: sma - stdMult * std };
}

// ============ Strategy Backtests (Real Data) ============

interface BacktestTrade {
  date: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  pnl: number;
  reason: string;
}

interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  equityCurve: { date: string; value: number }[];
  trades: BacktestTrade[];
  dataSource: string;
  priceRange: { start: number; end: number; high: number; low: number };
}

// DCA Strategy: Buy fixed amount at regular intervals
function backtestDCA(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const investAmount = Number(params.investmentAmount || params.positionSize || 100);
  const intervalDays = Number(params.interval || 7);

  let cash = capital;
  let holdings = 0;
  let entrySum = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  let daysSinceLastBuy = intervalDays; // Buy on first day

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    daysSinceLastBuy++;

    if (daysSinceLastBuy >= intervalDays && cash >= investAmount) {
      const qty = investAmount / price;
      cash -= investAmount;
      entrySum += investAmount;
      holdings += qty;
      daysSinceLastBuy = 0;
      trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `정기 매수 (${intervalDays}일 간격)` });
    }

    const totalValue = cash + holdings * price;
    equityCurve.push({ date, value: parseFloat(totalValue.toFixed(2)) });
  }

  // Close position at end for PnL calculation
  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = holdings * lastPrice - entrySum;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료 - 전량 매도',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// GRID Strategy: Buy/sell at grid price levels
function backtestGrid(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const gridLevels = Number(params.gridLevels || 10);
  const investPerGrid = Number(params.investPerGrid || params.positionSize || 100);

  // Set grid around first price
  const firstPrice = prices[0].price;
  const upperPrice = Number(params.upperPrice) || firstPrice * 1.15;
  const lowerPrice = Number(params.lowerPrice) || firstPrice * 0.85;
  const step = (upperPrice - lowerPrice) / gridLevels;

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  let lastGridLevel = Math.floor((firstPrice - lowerPrice) / step);

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    if (price < lowerPrice || price > upperPrice) {
      equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
      continue;
    }

    const currentGrid = Math.floor((price - lowerPrice) / step);

    if (currentGrid < lastGridLevel && cash >= investPerGrid) {
      // Price dropped to lower grid - BUY
      const qty = investPerGrid / price;
      const totalHoldings = holdings + qty;
      avgEntry = holdings > 0 ? (avgEntry * holdings + price * qty) / totalHoldings : price;
      cash -= investPerGrid;
      holdings = totalHoldings;
      trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `그리드 매수 (레벨 ${currentGrid})` });
    } else if (currentGrid > lastGridLevel && holdings > 0) {
      // Price rose to upper grid - SELL
      const sellQty = Math.min(holdings, investPerGrid / price);
      const pnl = (price - avgEntry) * sellQty;
      cash += sellQty * price;
      holdings -= sellQty;
      trades.push({ date, side: 'SELL', price, quantity: sellQty, pnl: parseFloat(pnl.toFixed(2)), reason: `그리드 매도 (레벨 ${currentGrid})` });
    }

    lastGridLevel = currentGrid;
    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  // Close remaining position
  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// MOMENTUM Strategy: RSI-based buy/sell
function backtestMomentum(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const rsiBuyThreshold = Number(params.rsiBuyThreshold || 30);
  const rsiSellThreshold = Number(params.rsiSellThreshold || 70);
  const positionSize = Number(params.positionSize || 500);
  const stopLoss = Number(params.stopLoss || 3) / 100;

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  const priceHistory: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    priceHistory.push(price);

    if (priceHistory.length > 15) {
      const rsi = calcRSI(priceHistory, 14);

      // BUY when RSI oversold
      if (rsi < rsiBuyThreshold && cash >= positionSize && holdings === 0) {
        const qty = positionSize / price;
        cash -= positionSize;
        holdings = qty;
        avgEntry = price;
        trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `RSI 과매도 (${rsi.toFixed(1)})` });
      }
      // SELL when RSI overbought or stop loss
      else if (holdings > 0) {
        const currentPnlPct = (price - avgEntry) / avgEntry;
        if (rsi > rsiSellThreshold) {
          const pnl = (price - avgEntry) * holdings;
          cash += holdings * price;
          trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `RSI 과매수 (${rsi.toFixed(1)})` });
          holdings = 0;
        } else if (currentPnlPct < -stopLoss) {
          const pnl = (price - avgEntry) * holdings;
          cash += holdings * price;
          trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `손절 (${(currentPnlPct * 100).toFixed(1)}%)` });
          holdings = 0;
        }
      }
    }

    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// MEAN_REVERSION Strategy: Bollinger Bands
function backtestMeanReversion(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const bbPeriod = Number(params.bollingerPeriod || 20);
  const bbStdDev = Number(params.bollingerStdDev || 2);
  const positionSize = Number(params.positionSize || 500);

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  const priceHistory: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    priceHistory.push(price);

    if (priceHistory.length > bbPeriod) {
      const bb = calcBollingerBands(priceHistory, bbPeriod, bbStdDev);

      if (price < bb.lower && cash >= positionSize && holdings === 0) {
        const qty = positionSize / price;
        cash -= positionSize;
        holdings = qty;
        avgEntry = price;
        trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `볼린저 하단 돌파 ($${bb.lower.toFixed(0)})` });
      } else if (price > bb.upper && holdings > 0) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `볼린저 상단 돌파 ($${bb.upper.toFixed(0)})` });
        holdings = 0;
      }
    }

    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// TRAILING Strategy: Buy and trail with stop
function backtestTrailing(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const trailingPercent = Number(params.trailingPercent || 5) / 100;
  const positionSize = Number(params.positionSize || params.investmentAmount || 500);

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  let highSinceEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];

    if (holdings === 0 && cash >= positionSize) {
      // Entry: buy when we have no position
      // Simple: buy every time we have no position and use EMA crossover
      const priceSlice = prices.slice(Math.max(0, i - 20), i + 1).map(p => p.price);
      if (priceSlice.length >= 10) {
        const shortEma = calcEMA(priceSlice, 5);
        const longEma = calcEMA(priceSlice, 10);
        if (shortEma > longEma) {
          const qty = positionSize / price;
          cash -= positionSize;
          holdings = qty;
          avgEntry = price;
          highSinceEntry = price;
          trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: 'EMA 골든크로스 진입' });
        }
      }
    } else if (holdings > 0) {
      highSinceEntry = Math.max(highSinceEntry, price);
      const dropFromHigh = (highSinceEntry - price) / highSinceEntry;

      if (dropFromHigh >= trailingPercent) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `트레일링 스탑 (고점 대비 -${(dropFromHigh * 100).toFixed(1)}%)` });
        holdings = 0;
      }
    }

    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// MARTINGALE Strategy: Double down on losses
function backtestMartingale(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>
): BacktestResult {
  const baseSize = Number(params.positionSize || params.investmentAmount || 100);
  const maxMultiplier = Number(params.maxMultiplier || 8);
  const targetProfitPct = Number(params.takeProfitPercent || 3) / 100;
  const lossTriggerPct = Number(params.stopLoss || 3) / 100;

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  let multiplier = 1;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];

    if (holdings === 0) {
      const size = baseSize * multiplier;
      if (cash >= size) {
        const qty = size / price;
        cash -= size;
        holdings = qty;
        avgEntry = price;
        trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `마틴게일 매수 (x${multiplier})` });
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;
      if (pnlPct >= targetProfitPct) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)` });
        holdings = 0;
        multiplier = 1; // Reset on win
      } else if (pnlPct <= -lossTriggerPct) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: `손절 후 배율 증가 (${(pnlPct * 100).toFixed(1)}%)` });
        holdings = 0;
        multiplier = Math.min(multiplier * 2, maxMultiplier); // Double on loss
      }
    }

    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// Generic EMA crossover for strategies without specific logic
function backtestEMACrossover(
  prices: DailyPrice[], capital: number, params: Record<string, unknown>, strategyName: string
): BacktestResult {
  const shortPeriod = Number(params.shortPeriod || 9);
  const longPeriod = Number(params.longPeriod || 21);
  const positionSize = Number(params.positionSize || 500);
  const stopLoss = Number(params.stopLoss || 3) / 100;

  let cash = capital;
  let holdings = 0;
  let avgEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  const priceHistory: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    priceHistory.push(price);

    if (priceHistory.length > longPeriod + 1) {
      const shortEma = calcEMA(priceHistory, shortPeriod);
      const longEma = calcEMA(priceHistory, longPeriod);
      const prevShort = calcEMA(priceHistory.slice(0, -1), shortPeriod);
      const prevLong = calcEMA(priceHistory.slice(0, -1), longPeriod);

      // Golden cross: short crosses above long
      if (prevShort <= prevLong && shortEma > longEma && holdings === 0 && cash >= positionSize) {
        const qty = positionSize / price;
        cash -= positionSize;
        holdings = qty;
        avgEntry = price;
        trades.push({ date, side: 'BUY', price, quantity: qty, pnl: 0, reason: `${strategyName} 매수 시그널` });
      }
      // Death cross or stop loss
      else if (holdings > 0) {
        const pnlPct = (price - avgEntry) / avgEntry;
        if ((prevShort >= prevLong && shortEma < longEma) || pnlPct < -stopLoss) {
          const pnl = (price - avgEntry) * holdings;
          cash += holdings * price;
          const reason = pnlPct < -stopLoss
            ? `손절 (${(pnlPct * 100).toFixed(1)}%)`
            : `${strategyName} 매도 시그널`;
          trades.push({ date, side: 'SELL', price, quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason });
          holdings = 0;
        }
      }
    }

    equityCurve.push({ date, value: parseFloat((cash + holdings * price).toFixed(2)) });
  }

  if (holdings > 0) {
    const lastPrice = prices[prices.length - 1].price;
    const pnl = (lastPrice - avgEntry) * holdings;
    trades.push({
      date: prices[prices.length - 1].date, side: 'SELL', price: lastPrice,
      quantity: holdings, pnl: parseFloat(pnl.toFixed(2)), reason: '백테스트 종료',
    });
  }

  return buildResult(trades, equityCurve, capital, prices);
}

// ============ Metrics Calculation ============

function buildResult(
  trades: BacktestTrade[],
  equityCurve: { date: string; value: number }[],
  initialCapital: number,
  prices: DailyPrice[]
): BacktestResult {
  const sellTrades = trades.filter(t => t.side === 'SELL');
  const winTrades = sellTrades.filter(t => t.pnl > 0);
  const lossTrades = sellTrades.filter(t => t.pnl <= 0);

  const totalPnl = sellTrades.reduce((s, t) => s + t.pnl, 0);
  const totalReturn = initialCapital > 0 ? parseFloat(((totalPnl / initialCapital) * 100).toFixed(2)) : 0;
  const winRate = sellTrades.length > 0
    ? parseFloat(((winTrades.length / sellTrades.length) * 100).toFixed(1))
    : 0;

  // Profit factor
  const grossProfit = winTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0
    ? parseFloat((grossProfit / grossLoss).toFixed(2))
    : grossProfit > 0 ? 999 : 0;

  // Max drawdown
  let maxDrawdown = 0;
  let peak = initialCapital;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = ((peak - point.value) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  maxDrawdown = parseFloat((-maxDrawdown).toFixed(2));

  // Sharpe ratio (annualized, using daily returns)
  let sharpeRatio = 0;
  if (equityCurve.length > 1) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const ret = (equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value;
      dailyReturns.push(ret);
    }
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0
      ? parseFloat(((avgReturn / stdDev) * Math.sqrt(365)).toFixed(2))
      : 0;
  }

  // Price range info
  const allPrices = prices.map(p => p.price);
  const priceRange = {
    start: parseFloat(allPrices[0].toFixed(2)),
    end: parseFloat(allPrices[allPrices.length - 1].toFixed(2)),
    high: parseFloat(Math.max(...allPrices).toFixed(2)),
    low: parseFloat(Math.min(...allPrices).toFixed(2)),
  };

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    totalTrades: trades.length,
    profitFactor,
    equityCurve,
    trades: trades.slice(0, 100), // Limit to 100 trades in response
    dataSource: 'CoinGecko 실제 과거 데이터',
    priceRange,
  };
}

// ============ Routes ============

// POST /run - Run backtest with real data
backtestRoutes.post('/run', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);

  const {
    symbol = 'BTCUSDT',
    strategy = 'MOMENTUM',
    startDate = '2024-10-01',
    endDate = '2025-01-20',
    initialCapital = 10000,
    params = {},
  } = body;

  try {
    // 1. Fetch real historical prices
    const prices = await fetchHistoricalPrices(symbol, startDate, endDate);

    // 2. Run strategy backtest on real data
    let result: BacktestResult;
    switch (strategy) {
      case 'DCA':
        result = backtestDCA(prices, initialCapital, params);
        break;
      case 'GRID':
        result = backtestGrid(prices, initialCapital, params);
        break;
      case 'MOMENTUM':
        result = backtestMomentum(prices, initialCapital, params);
        break;
      case 'MEAN_REVERSION':
        result = backtestMeanReversion(prices, initialCapital, params);
        break;
      case 'TRAILING':
        result = backtestTrailing(prices, initialCapital, params);
        break;
      case 'MARTINGALE':
        result = backtestMartingale(prices, initialCapital, params);
        break;
      case 'RL_AGENT':
        result = backtestEMACrossover(prices, initialCapital, params, 'RL 에이전트');
        break;
      case 'STAT_ARB':
        result = backtestMeanReversion(prices, initialCapital, params);
        break;
      case 'SCALPING':
        result = backtestEMACrossover(prices, initialCapital, { ...params, shortPeriod: 5, longPeriod: 13 }, '스캘핑');
        break;
      case 'FUNDING_ARB':
        result = backtestDCA(prices, initialCapital, { ...params, interval: 3 });
        break;
      default:
        result = backtestMomentum(prices, initialCapital, params);
    }

    // 3. Store result in DB
    const id = generateId();
    await c.env.DB.prepare(
      'INSERT INTO backtest_results (id, user_id, strategy, symbol, config, result) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      id, userId, strategy, symbol,
      JSON.stringify({ startDate, endDate, initialCapital, params }),
      JSON.stringify(result)
    ).run();

    return c.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : '백테스트 실행 중 오류 발생';
    return c.json({ error: message }, 500);
  }
});

// GET /results - Get past backtest results
backtestRoutes.get('/results', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '20');

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM backtest_results WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(userId, limit).all();

  const backtests = (results || []).map((row) => {
    const r = row as Record<string, unknown>;
    let result = {};
    let config = {};
    try { result = JSON.parse(r.result as string); } catch { /* ignore */ }
    try { config = JSON.parse(r.config as string); } catch { /* ignore */ }

    return {
      id: r.id,
      strategy: r.strategy,
      symbol: r.symbol,
      timeframe: r.timeframe,
      config,
      result,
      createdAt: r.created_at,
    };
  });

  return c.json({ data: backtests });
});
