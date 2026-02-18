import { Hono } from 'hono';
import { MarketRegime } from '@cryptosentinel/shared';
import type { Env, AppVariables } from '../index';

type RegimeEnv = { Bindings: Env; Variables: AppVariables };

export const regimeRoutes = new Hono<RegimeEnv>();

const BYBIT_BASE = 'https://api.bybit.com/v5/market';

const REGIME_STRATEGIES: Record<MarketRegime, string[]> = {
  [MarketRegime.BULL_HIGH_VOL]: ['MOMENTUM', 'TRAILING', 'SCALPING'],
  [MarketRegime.BULL_LOW_VOL]: ['DCA', 'GRID', 'FUNDING_ARB'],
  [MarketRegime.BEAR_HIGH_VOL]: ['MEAN_REVERSION', 'STAT_ARB', 'SCALPING'],
  [MarketRegime.BEAR_LOW_VOL]: ['DCA', 'GRID', 'FUNDING_ARB'],
};

async function cachedFetch(url: string, ttlSeconds: number): Promise<Response> {
  return fetch(url, { cf: { cacheTtl: ttlSeconds, cacheEverything: true } } as RequestInit);
}

// Bybit v5 kline response type
interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: string[][]; // [startTime, open, high, low, close, volume, turnover]
  };
}

// Bybit returns klines in REVERSE chronological order (newest first), so we must reverse
function parseBybitKlines(data: BybitKlineResponse): string[][] {
  if (data.retCode !== 0 || !data.result?.list) {
    throw new Error(`Bybit API error: ${data.retMsg}`);
  }
  // Reverse to get chronological order (oldest first)
  return [...data.result.list].reverse();
}

function classifyRegime(prices: number[], windowSize: number = 7): MarketRegime {
  if (prices.length < windowSize + 1) return MarketRegime.BULL_LOW_VOL;
  const current = prices[prices.length - 1];
  const past = prices[Math.max(0, prices.length - 1 - windowSize)];
  const change = ((current - past) / past) * 100;

  // 변동성: 일간 수익률 표준편차
  const returns: number[] = [];
  const start = Math.max(0, prices.length - windowSize);
  for (let i = start + 1; i < prices.length; i++) {
    returns.push(Math.abs(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100));
  }
  const avgVol = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

  const isBull = change > 0;
  const isHighVol = avgVol > 2.0;

  if (isBull && isHighVol) return MarketRegime.BULL_HIGH_VOL;
  if (isBull && !isHighVol) return MarketRegime.BULL_LOW_VOL;
  if (!isBull && isHighVol) return MarketRegime.BEAR_HIGH_VOL;
  return MarketRegime.BEAR_LOW_VOL;
}

// GET /current - 현재 시장 국면 (Bybit BTC 데이터 기반)
regimeRoutes.get('/current', async (c) => {
  try {
    // Bybit BTC 90일 일봉 + Fear & Greed 동시 호출
    const [klineRes, fngRes] = await Promise.all([
      cachedFetch(`${BYBIT_BASE}/kline?category=spot&symbol=BTCUSDT&interval=D&limit=90`, 60),
      cachedFetch('https://api.alternative.me/fng/?limit=1', 300),
    ]);

    const klineRaw = await klineRes.json() as BybitKlineResponse;
    const fngData = await fngRes.json() as { data?: Array<{ value: string }> };

    const klineData = parseBybitKlines(klineRaw);

    if (klineData.length < 30) {
      throw new Error('Insufficient data');
    }

    // Bybit kline format: [startTime, open, high, low, close, volume, turnover]
    const closes = klineData.map((k) => parseFloat(k[4]));
    const highs = klineData.map((k) => parseFloat(k[2]));
    const lows = klineData.map((k) => parseFloat(k[3]));
    const fearGreedIndex = parseInt(fngData.data?.[0]?.value || '50');

    const currentPrice = closes[closes.length - 1];
    const price7d = closes[Math.max(0, closes.length - 8)];
    const price30d = closes[Math.max(0, closes.length - 31)];
    const priceChange7d = ((currentPrice - price7d) / price7d) * 100;
    const priceChange30d = ((currentPrice - price30d) / price30d) * 100;

    // 변동성 (일간 수익률 표준편차)
    const dailyReturns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      dailyReturns.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
    }
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance);

    // ADX 근사
    const recent14 = dailyReturns.slice(-14);
    const posDM = recent14.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const negDM = Math.abs(recent14.filter((r) => r < 0).reduce((a, b) => a + b, 0));
    const adx = parseFloat(((Math.abs(posDM - negDM) / (posDM + negDM + 0.001)) * 100).toFixed(1));

    // ATR (True Range)
    const atrVals: number[] = [];
    for (let i = Math.max(1, closes.length - 14); i < closes.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atrVals.push(tr);
    }
    const atr = atrVals.length > 0 ? parseFloat((atrVals.reduce((a, b) => a + b, 0) / atrVals.length).toFixed(2)) : 0;

    // BB Width
    const bbP = Math.min(20, closes.length);
    const bbSlice = closes.slice(-bbP);
    const bbMid = bbSlice.reduce((a, b) => a + b, 0) / bbP;
    const bbStd = Math.sqrt(bbSlice.reduce((s, p) => s + (p - bbMid) ** 2, 0) / bbP);
    const bbWidth = parseFloat(((4 * bbStd / bbMid) * 100).toFixed(2));

    // 레짐 판정
    const isBull = priceChange30d > 0 && (priceChange7d > -5 || fearGreedIndex > 45);
    const isHighVol = volatility > 3.0;

    let regime: MarketRegime;
    if (isBull && isHighVol) regime = MarketRegime.BULL_HIGH_VOL;
    else if (isBull && !isHighVol) regime = MarketRegime.BULL_LOW_VOL;
    else if (!isBull && isHighVol) regime = MarketRegime.BEAR_HIGH_VOL;
    else regime = MarketRegime.BEAR_LOW_VOL;

    // 신뢰도
    const trendStrength = Math.min(100, Math.abs(priceChange30d) * 2);
    const volClarity = Math.abs(volatility - 3.0) * 10;
    const confidence = Math.min(0.95, Math.max(0.45, (trendStrength + volClarity + Math.abs(fearGreedIndex - 50)) / 200));

    // 60일 국면 히스토리
    const history: { date: string; regime: MarketRegime }[] = [];
    const now = new Date();
    for (let i = 59; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const idx = Math.max(0, closes.length - 1 - i);
      history.push({
        date: date.toISOString(),
        regime: classifyRegime(closes.slice(0, idx + 1)),
      });
    }

    return c.json({
      data: {
        current: regime,
        probability: parseFloat(confidence.toFixed(2)),
        regime,
        confidence: parseFloat(confidence.toFixed(2)),
        indicators: {
          adx, atr, bbWidth,
          volatility: parseFloat(volatility.toFixed(2)),
          fearGreedIndex,
          priceChange7d: parseFloat(priceChange7d.toFixed(2)),
          priceChange30d: parseFloat(priceChange30d.toFixed(2)),
        },
        recommendedStrategies: REGIME_STRATEGIES[regime],
        history,
      },
    });
  } catch (err) {
    console.error('Regime error:', err);
    return c.json({ error: '시장 국면 데이터를 가져올 수 없습니다.' }, 503);
  }
});

// GET /history - 국면 히스토리 (90일)
regimeRoutes.get('/history', async (c) => {
  try {
    const res = await cachedFetch(`${BYBIT_BASE}/kline?category=spot&symbol=BTCUSDT&interval=D&limit=100`, 60);
    const raw = await res.json() as BybitKlineResponse;
    const klineData = parseBybitKlines(raw);
    const closes = klineData.map((k) => parseFloat(k[4]));

    const history: { date: string; regime: MarketRegime }[] = [];
    const now = new Date();
    for (let i = 89; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const idx = Math.max(0, closes.length - 1 - i);
      history.push({
        date: date.toISOString(),
        regime: classifyRegime(closes.slice(0, idx + 1)),
      });
    }

    return c.json({ data: history });
  } catch {
    return c.json({ error: '국면 히스토리를 가져올 수 없습니다.' }, 503);
  }
});
