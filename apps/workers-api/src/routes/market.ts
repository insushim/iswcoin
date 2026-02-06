import { Hono } from 'hono';
import type { Env } from '../index';

export const marketRoutes = new Hono<{ Bindings: Env }>();

// CoinGecko public API for market data (no key needed for basic endpoints)
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USDT': 'bitcoin', 'ETH/USDT': 'ethereum', 'SOL/USDT': 'solana',
  'BNB/USDT': 'binancecoin', 'XRP/USDT': 'ripple', 'ADA/USDT': 'cardano',
  'DOGE/USDT': 'dogecoin', 'AVAX/USDT': 'avalanche-2', 'DOT/USDT': 'polkadot',
  'MATIC/USDT': 'matic-network', 'LINK/USDT': 'chainlink', 'UNI/USDT': 'uniswap',
};

marketRoutes.get('/ticker/:symbol', async (c) => {
  const symbol = decodeURIComponent(c.req.param('symbol'));
  const coinId = SYMBOL_MAP[symbol] || symbol.split('/')[0]?.toLowerCase();

  try {
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    const data = await res.json() as Record<string, any>;
    const coin = data[coinId!];

    if (!coin) return c.json({ error: 'Symbol not found' }, 404);

    return c.json({
      symbol,
      last: coin.usd,
      change24h: coin.usd_24h_change,
      volume: coin.usd_24h_vol,
      marketCap: coin.usd_market_cap,
      timestamp: Date.now(),
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch market data' }, 500);
  }
});

marketRoutes.get('/overview', async (c) => {
  try {
    const ids = Object.values(SYMBOL_MAP).join(',');
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    const data = await res.json() as Record<string, any>;

    const tickers = Object.entries(SYMBOL_MAP).map(([symbol, coinId]) => {
      const coin = data[coinId] || {};
      return {
        symbol,
        price: coin.usd || 0,
        change24h: coin.usd_24h_change || 0,
        volume: coin.usd_24h_vol || 0,
        marketCap: coin.usd_market_cap || 0,
      };
    });

    return c.json(tickers);
  } catch {
    return c.json({ error: 'Failed to fetch market overview' }, 500);
  }
});

marketRoutes.get('/sentiment/:symbol', async (c) => {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json() as any;
    const fgIndex = parseInt(data.data?.[0]?.value || '50');
    const classification = data.data?.[0]?.value_classification || 'Neutral';

    return c.json({
      overall: fgIndex,
      fearGreedIndex: fgIndex,
      classification,
      recommendation: fgIndex <= 20 ? 'EXTREME_FEAR' : fgIndex <= 40 ? 'FEAR' : fgIndex <= 60 ? 'NEUTRAL' : fgIndex <= 80 ? 'GREED' : 'EXTREME_GREED',
      signals: fgIndex <= 25 ? ['Extreme fear - potential buy opportunity'] : fgIndex >= 75 ? ['Extreme greed - consider taking profit'] : ['Market sentiment is neutral'],
    });
  } catch {
    return c.json({ overall: 50, fearGreedIndex: 50, classification: 'Neutral', recommendation: 'NEUTRAL', signals: [] });
  }
});

marketRoutes.get('/analysis/:symbol', async (c) => {
  const symbol = decodeURIComponent(c.req.param('symbol'));
  const coinId = SYMBOL_MAP[symbol] || 'bitcoin';

  try {
    const res = await fetch(`${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`);
    const data = await res.json() as any;

    const prices = (data.prices || []).map((p: number[]) => ({ timestamp: p[0], price: p[1] }));
    const volumes = (data.total_volumes || []).map((v: number[]) => ({ timestamp: v[0], volume: v[1] }));

    // Simple signal based on price trend
    const recentPrices = prices.slice(-7).map((p: any) => p.price);
    const avgRecent = recentPrices.reduce((a: number, b: number) => a + b, 0) / recentPrices.length;
    const currentPrice = recentPrices[recentPrices.length - 1] || 0;
    const trend = currentPrice > avgRecent ? 'BULLISH' : currentPrice < avgRecent * 0.98 ? 'BEARISH' : 'NEUTRAL';

    return c.json({
      symbol,
      prices,
      volumes,
      signal: {
        recommendation: trend === 'BULLISH' ? 'BUY' : trend === 'BEARISH' ? 'SELL' : 'NEUTRAL',
        buyStrength: trend === 'BULLISH' ? 65 : trend === 'BEARISH' ? 35 : 50,
        sellStrength: trend === 'BEARISH' ? 65 : trend === 'BULLISH' ? 35 : 50,
      },
    });
  } catch {
    return c.json({ error: 'Failed to fetch analysis' }, 500);
  }
});
