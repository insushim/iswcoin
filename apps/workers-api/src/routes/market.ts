import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { ema, rsi as calcRsi, macd as calcMacd, bb, atr as calcAtr } from '../indicators';

type MarketEnv = { Bindings: Env; Variables: AppVariables };

export const marketRoutes = new Hono<MarketEnv>();

// Bybit v5 Public API (무료, API키 불필요, Cloudflare Workers에서 사용 가능)
const BYBIT_BASE = 'https://api.bybit.com/v5/market';

const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'UNIUSDT',
];

function toBybit(raw: string): string {
  return decodeURIComponent(raw).toUpperCase().replace('/', '');
}

function toDisplay(s: string): string {
  const quotes = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'KRW'];
  for (const q of quotes) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length) + '/' + q;
  }
  return s;
}

// Edge 캐시 fetch helper (Cloudflare Workers Cache API)
async function cachedFetch(url: string, ttlSeconds: number): Promise<Response> {
  return fetch(url, { cf: { cacheTtl: ttlSeconds, cacheEverything: true } } as RequestInit);
}

// Bybit v5 응답 타입
interface BybitTickerItem {
  symbol: string;
  lastPrice: string;
  highPrice24h: string;
  lowPrice24h: string;
  prevPrice24h: string;
  volume24h: string;
  turnover24h: string;
  bid1Price: string;
  ask1Price: string;
  price24hPcnt: string;
}

interface BybitTickerResponse {
  retCode: number;
  result: {
    list: BybitTickerItem[];
  };
}

interface BybitKlineResponse {
  retCode: number;
  result: {
    list: string[][];
  };
}

interface BybitOrderbookResponse {
  retCode: number;
  result: {
    b: string[][]; // bids: [price, size]
    a: string[][]; // asks: [price, size]
  };
}

// ----- GET /ticker/:symbol -----
marketRoutes.get('/ticker/:symbol', async (c) => {
  const sym = toBybit(c.req.param('symbol'));
  try {
    const res = await cachedFetch(
      `${BYBIT_BASE}/tickers?category=spot&symbol=${sym}`,
      10,
    );
    if (!res.ok) return c.json({ error: 'Symbol not found' }, 404);
    const body = await res.json() as BybitTickerResponse;
    if (body.retCode !== 0 || !body.result.list.length) {
      return c.json({ error: 'Symbol not found' }, 404);
    }
    const d = body.result.list[0];
    const price = parseFloat(d.lastPrice);
    const prevPrice = parseFloat(d.prevPrice24h);
    const change24h = prevPrice > 0
      ? parseFloat((parseFloat(d.price24hPcnt) * 100).toFixed(2))
      : 0;

    return c.json({
      data: {
        symbol: toDisplay(sym),
        price,
        last: price,
        bid: parseFloat(d.bid1Price),
        ask: parseFloat(d.ask1Price),
        change24h,
        volume24h: parseFloat(d.turnover24h),
        volume: parseFloat(d.turnover24h),
        high24h: parseFloat(d.highPrice24h),
        low24h: parseFloat(d.lowPrice24h),
        marketCap: 0,
        timestamp: Date.now(),
      },
    });
  } catch {
    return c.json({ error: 'Failed to fetch ticker' }, 500);
  }
});

// ----- GET /tickers -----
marketRoutes.get('/tickers', async (c) => {
  c.header('Cache-Control', 'public, max-age=10, s-maxage=10');
  try {
    // Bybit은 배치 심볼 쿼리를 지원하지 않으므로 전체 spot 티커를 가져와 필터링
    const res = await cachedFetch(
      `${BYBIT_BASE}/tickers?category=spot`,
      10,
    );
    const body = await res.json() as BybitTickerResponse;
    const supportedSet = new Set(SUPPORTED_SYMBOLS);
    const list = (body.result?.list || []).filter((d) => supportedSet.has(d.symbol));

    const tickers = list.map((d) => {
      const price = parseFloat(d.lastPrice);
      const change24h = parseFloat((parseFloat(d.price24hPcnt) * 100).toFixed(2));
      return {
        symbol: toDisplay(d.symbol),
        price,
        last: price,
        bid: parseFloat(d.bid1Price),
        ask: parseFloat(d.ask1Price),
        change24h,
        volume: parseFloat(d.turnover24h),
        volume24h: parseFloat(d.turnover24h),
        high24h: parseFloat(d.highPrice24h),
        low24h: parseFloat(d.lowPrice24h),
        marketCap: 0,
        timestamp: Date.now(),
      };
    });
    return c.json({ data: tickers });
  } catch {
    return c.json({ data: [] });
  }
});

// ----- GET /overview -----
marketRoutes.get('/overview', async (c) => {
  try {
    const res = await cachedFetch(
      `${BYBIT_BASE}/tickers?category=spot`,
      15,
    );
    const body = await res.json() as BybitTickerResponse;
    const supportedSet = new Set(SUPPORTED_SYMBOLS);
    const list = (body.result?.list || []).filter((d) => supportedSet.has(d.symbol));

    const tickers = list.map((d) => ({
      symbol: toDisplay(d.symbol),
      price: parseFloat(d.lastPrice),
      last: parseFloat(d.lastPrice),
      change24h: parseFloat((parseFloat(d.price24hPcnt) * 100).toFixed(2)),
      volume: parseFloat(d.turnover24h),
      volume24h: parseFloat(d.turnover24h),
      marketCap: 0,
      timestamp: Date.now(),
    }));
    return c.json({ data: tickers });
  } catch {
    return c.json({ error: 'Failed to fetch market overview' }, 500);
  }
});

// ----- GET /ohlcv/:symbol -----
marketRoutes.get('/ohlcv/:symbol', async (c) => {
  const sym = toBybit(c.req.param('symbol'));
  const days = parseInt(c.req.query('days') || '30');
  const timeframe = c.req.query('timeframe') || '1d';

  // timeframe → Bybit interval 매핑
  // Bybit intervals: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
  const intervalMap: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
    '1d': 'D', '1w': 'W', '1M': 'M',
  };
  const interval = intervalMap[timeframe] || 'D';
  const limit = Math.min(
    200,
    days * (interval === 'D' ? 1 : interval === '240' ? 6 : interval === '60' ? 24 : 1),
  );

  try {
    const res = await cachedFetch(
      `${BYBIT_BASE}/kline?category=spot&symbol=${sym}&interval=${interval}&limit=${limit}`,
      30,
    );
    const body = await res.json() as BybitKlineResponse;
    const raw = body.result?.list || [];

    // Bybit kline은 최신이 먼저 (역순) → 오래된 순으로 reverse
    const ohlcv = raw.reverse().map((k) => ({
      timestamp: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    return c.json({ data: ohlcv });
  } catch {
    return c.json({ error: 'Failed to fetch OHLCV data' }, 500);
  }
});

// ----- GET /indicators/:symbol -----
marketRoutes.get('/indicators/:symbol', async (c) => {
  c.header('Cache-Control', 'public, max-age=30, s-maxage=30');
  const sym = toBybit(c.req.param('symbol'));
  const symbol = toDisplay(sym);

  try {
    // 60일 일봉으로 지표 계산
    const res = await cachedFetch(
      `${BYBIT_BASE}/kline?category=spot&symbol=${sym}&interval=D&limit=60`,
      30,
    );
    const body = await res.json() as BybitKlineResponse;
    const rawList = body.result?.list || [];
    if (!Array.isArray(rawList) || rawList.length < 14) {
      return c.json({ error: 'Not enough data' }, 400);
    }

    // Bybit kline은 최신이 먼저 → reverse하여 오래된 순으로 정렬
    const raw = [...rawList].reverse();

    // Bybit kline: [startTime, open, high, low, close, volume, turnover]
    const closes = raw.map((k) => parseFloat(k[4]));
    const volumes = raw.map((k) => parseFloat(k[5]));

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];
    const currentVol = volumes[volumes.length - 1];
    const prevVol = volumes[volumes.length - 2];

    // RSI (14) - using shared indicator
    const rsiVal = parseFloat(calcRsi(closes, 14).toFixed(2));

    // EMA values - using shared indicator
    const ema20 = parseFloat(ema(closes, 20).toFixed(2));
    const ema50 = parseFloat(ema(closes, Math.min(50, closes.length)).toFixed(2));
    const ema200 = parseFloat(ema(closes, Math.min(closes.length, 60)).toFixed(2));

    // MACD - using shared indicator
    const macdResult = calcMacd(closes);
    const macdLine = parseFloat(macdResult.line.toFixed(2));
    const signalLine = parseFloat(macdResult.signal.toFixed(2));
    const histogram = parseFloat(macdResult.hist.toFixed(2));

    // Bollinger Bands (20, 2) - using shared indicator
    const bbResult = bb(closes, 20, 2);

    // ATR (14) - using shared indicator (close-based approximation)
    const atrVal = parseFloat(calcAtr(closes, 14).toFixed(2));

    return c.json({
      data: {
        symbol,
        rsi: rsiVal,
        macd: { line: macdLine, signal: signalLine, histogram },
        bollingerBands: {
          upper: parseFloat(bbResult.u.toFixed(2)),
          middle: parseFloat(bbResult.m.toFixed(2)),
          lower: parseFloat(bbResult.l.toFixed(2)),
        },
        ema20, ema50, ema200, atr: atrVal,
        volume24h: currentVol,
        volumeChange: prevVol > 0 ? parseFloat(((currentVol - prevVol) / prevVol * 100).toFixed(2)) : 0,
        currentPrice,
        priceChange: prevPrice > 0 ? parseFloat(((currentPrice - prevPrice) / prevPrice * 100).toFixed(2)) : 0,
      },
    });
  } catch {
    return c.json({ error: '기술적 지표를 계산할 수 없습니다.', data: null }, 503);
  }
});

// ----- GET /sentiment (alternative.me Fear & Greed) -----
marketRoutes.get('/sentiment', async (c) => {
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  try {
    const res = await cachedFetch('https://api.alternative.me/fng/?limit=7', 300);
    const data = await res.json() as { data?: Array<{ value: string; value_classification: string; timestamp: string }> };
    const entries = data.data || [];
    const latest = entries[0];
    const fgIndex = parseInt(latest?.value || '50');
    const classification = latest?.value_classification || 'Neutral';

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
        signals: fgIndex <= 25 ? ['극심한 공포 - 매수 기회 가능성'] : fgIndex >= 75 ? ['극심한 탐욕 - 차익 실현 고려'] : ['시장 심리 중립'],
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
        fearGreedIndex: 50, fearGreedLabel: 'Neutral', classification: 'Neutral',
        socialScore: 50, newsScore: 50, whaleActivity: 'Neutral', timestamp: Date.now(),
        overall: 50, recommendation: 'NEUTRAL', signals: [], history: [],
      },
    });
  }
});

// GET /sentiment/:symbol
marketRoutes.get('/sentiment/:symbol', async (c) => {
  try {
    const res = await cachedFetch('https://api.alternative.me/fng/?limit=1', 300);
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
        signals: fgIndex <= 25 ? ['극심한 공포 - 매수 기회'] : fgIndex >= 75 ? ['극심한 탐욕 - 차익 실현'] : ['시장 심리 중립'],
        socialScore: fgIndex, newsScore: fgIndex, whaleActivity: 'Neutral', timestamp: Date.now(),
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

// ----- GET /analysis/:symbol -----
marketRoutes.get('/analysis/:symbol', async (c) => {
  const sym = toBybit(c.req.param('symbol'));
  const symbol = toDisplay(sym);

  try {
    const res = await cachedFetch(
      `${BYBIT_BASE}/kline?category=spot&symbol=${sym}&interval=D&limit=30`,
      30,
    );
    const body = await res.json() as BybitKlineResponse;
    const rawList = body.result?.list || [];

    // Bybit kline은 최신이 먼저 → reverse하여 오래된 순으로 정렬
    const raw = [...rawList].reverse();

    const prices = raw.map((k) => ({
      timestamp: parseInt(k[0]),
      price: parseFloat(k[4]),
    }));
    const volumes = raw.map((k) => ({
      timestamp: parseInt(k[0]),
      volume: parseFloat(k[5]),
    }));

    const recentPrices = prices.slice(-7).map((p) => p.price);
    const avg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const cur = recentPrices[recentPrices.length - 1] || 0;
    const trend = cur > avg ? 'BULLISH' : cur < avg * 0.98 ? 'BEARISH' : 'NEUTRAL';

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

// ----- GET /orderbook/:symbol (Bybit v5 호가창) -----
marketRoutes.get('/orderbook/:symbol', async (c) => {
  const sym = toBybit(c.req.param('symbol'));
  const symbol = toDisplay(sym);

  try {
    const res = await cachedFetch(
      `${BYBIT_BASE}/orderbook?category=spot&symbol=${sym}&limit=20`,
      5,
    );
    const body = await res.json() as BybitOrderbookResponse;

    // Bybit: b = bids, a = asks, each entry is [price, size]
    const bids: [number, number][] = (body.result?.b || []).map((b) => [parseFloat(b[0]), parseFloat(b[1])]);
    const asks: [number, number][] = (body.result?.a || []).map((a) => [parseFloat(a[0]), parseFloat(a[1])]);

    const totalBid = bids.reduce((s, b) => s + b[1], 0);
    const totalAsk = asks.reduce((s, a) => s + a[1], 0);
    const imbalance = parseFloat(((totalBid - totalAsk) / (totalBid + totalAsk + 0.001)).toFixed(4));
    const price = bids.length > 0 && asks.length > 0 ? (bids[0][0] + asks[0][0]) / 2 : 0;
    const spread = asks.length > 0 && bids.length > 0 ? asks[0][0] - bids[0][0] : 0;
    const spreadBps = price > 0 ? parseFloat(((spread / price) * 10000).toFixed(2)) : 0;

    return c.json({
      data: { symbol, bids, asks, imbalance, spreadBps, timestamp: Date.now() },
    });
  } catch {
    return c.json({ error: 'Failed to fetch orderbook' }, 500);
  }
});
