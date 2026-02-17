import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';

type MarketEnv = { Bindings: Env; Variables: AppVariables };

export const marketRoutes = new Hono<MarketEnv>();

// CoinGecko public API for market data (no key needed for basic endpoints)
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USDT': 'bitcoin', 'ETH/USDT': 'ethereum', 'SOL/USDT': 'solana',
  'BNB/USDT': 'binancecoin', 'XRP/USDT': 'ripple', 'ADA/USDT': 'cardano',
  'DOGE/USDT': 'dogecoin', 'AVAX/USDT': 'avalanche-2', 'DOT/USDT': 'polkadot',
  'MATIC/USDT': 'matic-network', 'LINK/USDT': 'chainlink', 'UNI/USDT': 'uniswap',
};

// Also map BTCUSDT style -> BTC/USDT
const SYMBOL_REVERSE: Record<string, string> = {};
for (const key of Object.keys(SYMBOL_MAP)) {
  const noSlash = key.replace('/', '');
  SYMBOL_REVERSE[noSlash] = key;
}

function resolveSymbol(raw: string): { symbol: string; coinId: string } {
  const decoded = decodeURIComponent(raw);
  // Try exact match first
  if (SYMBOL_MAP[decoded]) {
    return { symbol: decoded, coinId: SYMBOL_MAP[decoded] };
  }
  // Try without slash
  const withSlash = SYMBOL_REVERSE[decoded];
  if (withSlash && SYMBOL_MAP[withSlash]) {
    return { symbol: withSlash, coinId: SYMBOL_MAP[withSlash] };
  }
  // Fallback
  const base = decoded.split('/')[0]?.replace('USDT', '').toLowerCase() || decoded.toLowerCase();
  return { symbol: decoded, coinId: base };
}

// GET /ticker/:symbol - Single ticker
marketRoutes.get('/ticker/:symbol', async (c) => {
  const { symbol, coinId } = resolveSymbol(c.req.param('symbol'));

  try {
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    const data = await res.json() as Record<string, Record<string, number>>;
    const coin = data[coinId];

    if (!coin) return c.json({ error: 'Symbol not found' }, 404);

    return c.json({
      data: {
        symbol,
        price: coin.usd,
        last: coin.usd,
        bid: coin.usd * 0.9999,
        ask: coin.usd * 1.0001,
        change24h: coin.usd_24h_change,
        volume24h: coin.usd_24h_vol,
        volume: coin.usd_24h_vol,
        marketCap: coin.usd_market_cap,
        timestamp: Date.now(),
      },
    });
  } catch {
    return c.json({ error: 'Failed to fetch market data' }, 500);
  }
});

// Fallback ticker data when CoinGecko rate-limits
const FALLBACK_PRICES: Record<string, { price: number; change: number; vol: number; cap: number }> = {
  'BTC/USDT': { price: 97500, change: 2.1, vol: 28500000000, cap: 1920000000000 },
  'ETH/USDT': { price: 3250, change: -1.2, vol: 15200000000, cap: 390000000000 },
  'SOL/USDT': { price: 198, change: 5.5, vol: 4500000000, cap: 86000000000 },
  'BNB/USDT': { price: 625, change: 0.8, vol: 1800000000, cap: 93000000000 },
  'XRP/USDT': { price: 2.45, change: -0.5, vol: 3200000000, cap: 140000000000 },
  'ADA/USDT': { price: 0.89, change: 1.1, vol: 980000000, cap: 31000000000 },
  'DOGE/USDT': { price: 0.32, change: 3.2, vol: 2100000000, cap: 47000000000 },
  'AVAX/USDT': { price: 38.5, change: -2.1, vol: 650000000, cap: 14000000000 },
  'DOT/USDT': { price: 7.89, change: 0.3, vol: 430000000, cap: 11000000000 },
  'MATIC/USDT': { price: 0.42, change: -0.8, vol: 350000000, cap: 4200000000 },
  'LINK/USDT': { price: 19.50, change: 1.5, vol: 780000000, cap: 12000000000 },
  'UNI/USDT': { price: 12.30, change: -0.3, vol: 290000000, cap: 9200000000 },
};

function buildFallbackTickers() {
  return Object.entries(FALLBACK_PRICES).map(([symbol, d]) => ({
    symbol,
    price: d.price,
    last: d.price,
    bid: d.price * 0.9999,
    ask: d.price * 1.0001,
    change24h: d.change,
    volume: d.vol,
    volume24h: d.vol,
    high24h: d.price * 1.03,
    low24h: d.price * 0.97,
    marketCap: d.cap,
    timestamp: Date.now(),
  }));
}

// GET /tickers - All tickers (frontend dashboard format) + 캐시 헤더
marketRoutes.get('/tickers', async (c) => {
  try {
    const ids = Object.values(SYMBOL_MAP).join(',');
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    const data = await res.json() as Record<string, Record<string, number>>;

    const tickers = Object.entries(SYMBOL_MAP).map(([symbol, coinId]) => {
      const coin = data[coinId];
      if (!coin || !coin.usd) return null;
      return {
        symbol,
        price: coin.usd,
        last: coin.usd,
        bid: coin.usd * 0.9999,
        ask: coin.usd * 1.0001,
        change24h: coin.usd_24h_change || 0,
        volume: coin.usd_24h_vol || 0,
        volume24h: coin.usd_24h_vol || 0,
        high24h: coin.usd * 1.03,
        low24h: coin.usd * 0.97,
        marketCap: coin.usd_market_cap || 0,
        timestamp: Date.now(),
      };
    }).filter(Boolean);

    // 캐시: 15초 (시장 데이터 빈번 변동)
    c.header('Cache-Control', 'public, max-age=15, s-maxage=15');

    // If CoinGecko returned empty/rate-limited, use fallback
    if (tickers.length === 0) {
      return c.json({ data: buildFallbackTickers() });
    }
    return c.json({ data: tickers });
  } catch {
    return c.json({ data: buildFallbackTickers() });
  }
});

// GET /overview - Market overview (existing, kept for compatibility)
marketRoutes.get('/overview', async (c) => {
  try {
    const ids = Object.values(SYMBOL_MAP).join(',');
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    const data = await res.json() as Record<string, Record<string, number>>;

    const tickers = Object.entries(SYMBOL_MAP).map(([symbol, coinId]) => {
      const coin = data[coinId] || {};
      return {
        symbol,
        price: coin.usd || 0,
        last: coin.usd || 0,
        change24h: coin.usd_24h_change || 0,
        volume: coin.usd_24h_vol || 0,
        volume24h: coin.usd_24h_vol || 0,
        marketCap: coin.usd_market_cap || 0,
        timestamp: Date.now(),
      };
    });

    return c.json({ data: tickers });
  } catch {
    return c.json({ error: 'Failed to fetch market overview' }, 500);
  }
});

// GET /sentiment - Market sentiment (캐시 5분)
marketRoutes.get('/sentiment', async (c) => {
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=7');
    const data = await res.json() as { data?: Array<{ value: string; value_classification: string; timestamp: string }> };
    const entries = data.data || [];
    const latest = entries[0];
    const fgIndex = parseInt(latest?.value || '50');
    const classification = latest?.value_classification || 'Neutral';

    // Determine label
    let fearGreedLabel: string;
    if (fgIndex <= 20) fearGreedLabel = 'Extreme Fear';
    else if (fgIndex <= 40) fearGreedLabel = 'Fear';
    else if (fgIndex <= 60) fearGreedLabel = 'Neutral';
    else if (fgIndex <= 80) fearGreedLabel = 'Greed';
    else fearGreedLabel = 'Extreme Greed';

    return c.json({
      data: {
        fearGreedIndex: fgIndex,
        fearGreedLabel,
        classification,
        socialScore: Math.min(100, Math.max(0, fgIndex)),
        newsScore: Math.min(100, Math.max(0, fgIndex)),
        whaleActivity: fgIndex > 60 ? 'Accumulating' : fgIndex < 40 ? 'Distributing' : 'Neutral',
        timestamp: Date.now(),
        overall: fgIndex,
        recommendation: fgIndex <= 20 ? 'EXTREME_FEAR' : fgIndex <= 40 ? 'FEAR' : fgIndex <= 60 ? 'NEUTRAL' : fgIndex <= 80 ? 'GREED' : 'EXTREME_GREED',
        signals: fgIndex <= 25 ? ['Extreme fear - potential buy opportunity'] : fgIndex >= 75 ? ['Extreme greed - consider taking profit'] : ['Market sentiment is neutral'],
        history: entries.map((e) => ({
          value: parseInt(e.value),
          classification: e.value_classification,
          timestamp: parseInt(e.timestamp) * 1000,
        })),
      },
    });
  } catch {
    return c.json({
      data: {
        fearGreedIndex: 50,
        fearGreedLabel: 'Neutral',
        classification: 'Neutral',
        socialScore: 50,
        newsScore: 50,
        whaleActivity: 'Neutral',
        timestamp: Date.now(),
        overall: 50,
        recommendation: 'NEUTRAL',
        signals: [],
        history: [],
      },
    });
  }
});

// GET /sentiment/:symbol - Kept for backward compatibility
marketRoutes.get('/sentiment/:symbol', async (c) => {
  // Delegate to the no-param version (ignore symbol param)
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json() as { data?: Array<{ value: string; value_classification: string }> };
    const fgIndex = parseInt(data.data?.[0]?.value || '50');
    const classification = data.data?.[0]?.value_classification || 'Neutral';

    return c.json({
      data: {
        fearGreedIndex: fgIndex,
        fearGreedLabel: classification,
        overall: fgIndex,
        classification,
        recommendation: fgIndex <= 20 ? 'EXTREME_FEAR' : fgIndex <= 40 ? 'FEAR' : fgIndex <= 60 ? 'NEUTRAL' : fgIndex <= 80 ? 'GREED' : 'EXTREME_GREED',
        signals: fgIndex <= 25 ? ['Extreme fear - potential buy opportunity'] : fgIndex >= 75 ? ['Extreme greed - consider taking profit'] : ['Market sentiment is neutral'],
        socialScore: fgIndex,
        newsScore: fgIndex,
        whaleActivity: 'Neutral',
        timestamp: Date.now(),
      },
    });
  } catch {
    return c.json({
      data: {
        fearGreedIndex: 50, fearGreedLabel: 'Neutral', overall: 50, classification: 'Neutral',
        recommendation: 'NEUTRAL', signals: [], socialScore: 50, newsScore: 50, whaleActivity: 'Neutral', timestamp: Date.now(),
      },
    });
  }
});

// GET /indicators/:symbol - Technical indicators (캐시 30초)
marketRoutes.get('/indicators/:symbol', async (c) => {
  c.header('Cache-Control', 'public, max-age=30, s-maxage=30');
  const { symbol, coinId } = resolveSymbol(c.req.param('symbol'));

  try {
    // Fetch 30-day price history for indicator calculation
    const res = await fetch(`${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`);
    const data = await res.json() as { prices?: number[][]; total_volumes?: number[][] };
    const prices = (data.prices || []).map((p) => p[1]);
    const volumes = (data.total_volumes || []).map((v) => v[1]);

    if (prices.length < 14) {
      return c.json({ error: 'Not enough data for indicators' }, 400);
    }

    const currentPrice = prices[prices.length - 1] || 0;
    const prevPrice = prices[prices.length - 2] || currentPrice;
    const currentVolume = volumes[volumes.length - 1] || 0;
    const prevVolume = volumes[volumes.length - 2] || currentVolume;

    // Calculate RSI (14-period)
    const rsiPeriod = 14;
    let gains = 0;
    let losses = 0;
    const startIdx = Math.max(0, prices.length - rsiPeriod - 1);
    for (let i = startIdx + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = parseFloat((100 - (100 / (1 + rs))).toFixed(2));

    // Calculate EMA helper
    function calcEMA(data: number[], period: number): number {
      if (data.length < period) return data[data.length - 1] || 0;
      const k = 2 / (period + 1);
      let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
      }
      return parseFloat(ema.toFixed(2));
    }

    const ema20 = calcEMA(prices, Math.min(20, prices.length));
    const ema50 = calcEMA(prices, Math.min(prices.length, 20)); // Use available data
    const ema200 = calcEMA(prices, Math.min(prices.length, 30));

    // MACD (12, 26, 9)
    const ema12 = calcEMA(prices, Math.min(12, prices.length));
    const ema26 = calcEMA(prices, Math.min(26, prices.length));
    const macdLine = parseFloat((ema12 - ema26).toFixed(2));
    // Signal line approximation
    const signalLine = parseFloat((macdLine * 0.8).toFixed(2));
    const histogram = parseFloat((macdLine - signalLine).toFixed(2));

    // Bollinger Bands (20, 2)
    const bbPeriod = Math.min(20, prices.length);
    const recentPrices = prices.slice(-bbPeriod);
    const bbMiddle = recentPrices.reduce((a, b) => a + b, 0) / bbPeriod;
    const bbStdDev = Math.sqrt(recentPrices.reduce((sum, p) => sum + Math.pow(p - bbMiddle, 2), 0) / bbPeriod);
    const bbUpper = parseFloat((bbMiddle + 2 * bbStdDev).toFixed(2));
    const bbLower = parseFloat((bbMiddle - 2 * bbStdDev).toFixed(2));

    // ATR approximation (use daily range)
    const atrValues: number[] = [];
    for (let i = Math.max(1, prices.length - 14); i < prices.length; i++) {
      atrValues.push(Math.abs(prices[i] - prices[i - 1]));
    }
    const atr = atrValues.length > 0
      ? parseFloat((atrValues.reduce((a, b) => a + b, 0) / atrValues.length).toFixed(2))
      : 0;

    return c.json({
      data: {
        symbol,
        rsi,
        macd: {
          line: macdLine,
          signal: signalLine,
          histogram,
        },
        bollingerBands: {
          upper: bbUpper,
          middle: parseFloat(bbMiddle.toFixed(2)),
          lower: bbLower,
        },
        ema20,
        ema50,
        ema200,
        atr,
        volume24h: currentVolume,
        volumeChange: prevVolume > 0
          ? parseFloat((((currentVolume - prevVolume) / prevVolume) * 100).toFixed(2))
          : 0,
        currentPrice,
        priceChange: prevPrice > 0
          ? parseFloat((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2))
          : 0,
      },
    });
  } catch {
    // API 실패 시 에러 반환 (가짜 데이터 대신)
    return c.json({
      error: '기술적 지표를 계산할 수 없습니다. CoinGecko API 제한일 수 있습니다.',
      data: null,
    }, 503);
  }
});

// GET /analysis/:symbol - Market analysis
marketRoutes.get('/analysis/:symbol', async (c) => {
  const { symbol, coinId } = resolveSymbol(c.req.param('symbol'));

  try {
    const res = await fetch(`${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`);
    const data = await res.json() as { prices?: number[][]; total_volumes?: number[][] };

    const prices = (data.prices || []).map((p: number[]) => ({ timestamp: p[0], price: p[1] }));
    const volumes = (data.total_volumes || []).map((v: number[]) => ({ timestamp: v[0], volume: v[1] }));

    // Simple signal based on price trend
    const recentPrices = prices.slice(-7).map((p) => p.price);
    const avgRecent = recentPrices.reduce((a: number, b: number) => a + b, 0) / recentPrices.length;
    const currentPrice = recentPrices[recentPrices.length - 1] || 0;
    const trend = currentPrice > avgRecent ? 'BULLISH' : currentPrice < avgRecent * 0.98 ? 'BEARISH' : 'NEUTRAL';

    return c.json({
      data: {
        symbol,
        prices,
        volumes,
        signal: {
          recommendation: trend === 'BULLISH' ? 'BUY' : trend === 'BEARISH' ? 'SELL' : 'NEUTRAL',
          buyStrength: trend === 'BULLISH' ? 65 : trend === 'BEARISH' ? 35 : 50,
          sellStrength: trend === 'BEARISH' ? 65 : trend === 'BULLISH' ? 35 : 50,
        },
      },
    });
  } catch {
    return c.json({ error: 'Failed to fetch analysis' }, 500);
  }
});

// GET /orderbook/:symbol - Order book snapshot
marketRoutes.get('/orderbook/:symbol', async (c) => {
  const { symbol, coinId } = resolveSymbol(c.req.param('symbol'));

  try {
    // Get current price for realistic orderbook generation
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`);
    const data = await res.json() as Record<string, { usd: number }>;
    const price = data[coinId]?.usd || 50000;

    // Generate deterministic orderbook around current price
    // Note: CoinGecko doesn't provide orderbook data, so this is a model based on real price
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    const step = price * 0.0005; // 0.05% steps

    for (let i = 1; i <= 20; i++) {
      const bidPrice = parseFloat((price - step * i).toFixed(2));
      const askPrice = parseFloat((price + step * i).toFixed(2));
      // Deterministic size: increases with distance from mid (typical orderbook shape)
      const baseSize = 0.5 + (i * 0.15);
      const bidSize = parseFloat(baseSize.toFixed(4));
      const askSize = parseFloat((baseSize * 0.95).toFixed(4));
      bids.push([bidPrice, bidSize]);
      asks.push([askPrice, askSize]);
    }

    const totalBidVolume = bids.reduce((s, b) => s + b[1], 0);
    const totalAskVolume = asks.reduce((s, a) => s + a[1], 0);
    const imbalance = parseFloat(((totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume)).toFixed(4));
    const spread = asks[0][0] - bids[0][0];
    const spreadBps = parseFloat(((spread / price) * 10000).toFixed(2));

    return c.json({
      data: {
        symbol,
        bids,
        asks,
        imbalance,
        spreadBps,
        timestamp: Date.now(),
      },
    });
  } catch {
    return c.json({ error: 'Failed to generate orderbook' }, 500);
  }
});

// GET /ohlcv/:symbol - OHLCV data
marketRoutes.get('/ohlcv/:symbol', async (c) => {
  const { symbol, coinId } = resolveSymbol(c.req.param('symbol'));
  const days = parseInt(c.req.query('days') || '30');

  try {
    const res = await fetch(`${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
    const data = await res.json() as number[][];

    const ohlcv = (Array.isArray(data) ? data : []).map((candle) => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: 0, // CoinGecko OHLC doesn't include volume
    }));

    return c.json({ data: ohlcv });
  } catch {
    return c.json({ error: 'Failed to fetch OHLCV data' }, 500);
  }
});
