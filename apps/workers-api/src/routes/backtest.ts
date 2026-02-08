import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId } from '../utils';

type BacktestEnv = { Bindings: Env; Variables: AppVariables };

export const backtestRoutes = new Hono<BacktestEnv>();

// Strategy characteristics for realistic backtest generation
const STRATEGY_PROFILES: Record<string, {
  avgReturn: number;      // average total return %
  returnStd: number;      // standard deviation of return
  winRate: number;         // base win rate
  tradesPerMonth: number;  // average trades per month
  maxDrawdown: number;     // typical max drawdown %
  sharpeBase: number;      // base sharpe ratio
  profitFactor: number;    // base profit factor
}> = {
  DCA: {
    avgReturn: 15, returnStd: 8, winRate: 65, tradesPerMonth: 4,
    maxDrawdown: -12, sharpeBase: 1.2, profitFactor: 1.6,
  },
  GRID: {
    avgReturn: 22, returnStd: 12, winRate: 58, tradesPerMonth: 30,
    maxDrawdown: -15, sharpeBase: 1.5, profitFactor: 1.4,
  },
  MARTINGALE: {
    avgReturn: 30, returnStd: 25, winRate: 72, tradesPerMonth: 8,
    maxDrawdown: -35, sharpeBase: 0.8, profitFactor: 1.3,
  },
  TRAILING: {
    avgReturn: 18, returnStd: 10, winRate: 48, tradesPerMonth: 6,
    maxDrawdown: -18, sharpeBase: 1.1, profitFactor: 1.5,
  },
  MOMENTUM: {
    avgReturn: 25, returnStd: 15, winRate: 52, tradesPerMonth: 10,
    maxDrawdown: -20, sharpeBase: 1.4, profitFactor: 1.7,
  },
  MEAN_REVERSION: {
    avgReturn: 20, returnStd: 10, winRate: 62, tradesPerMonth: 15,
    maxDrawdown: -14, sharpeBase: 1.6, profitFactor: 1.8,
  },
  RL_AGENT: {
    avgReturn: 28, returnStd: 18, winRate: 55, tradesPerMonth: 20,
    maxDrawdown: -22, sharpeBase: 1.3, profitFactor: 1.5,
  },
  STAT_ARB: {
    avgReturn: 16, returnStd: 6, winRate: 60, tradesPerMonth: 25,
    maxDrawdown: -10, sharpeBase: 2.0, profitFactor: 1.9,
  },
  SCALPING: {
    avgReturn: 35, returnStd: 20, winRate: 55, tradesPerMonth: 80,
    maxDrawdown: -25, sharpeBase: 1.1, profitFactor: 1.3,
  },
  FUNDING_ARB: {
    avgReturn: 12, returnStd: 4, winRate: 78, tradesPerMonth: 10,
    maxDrawdown: -5, sharpeBase: 2.5, profitFactor: 2.2,
  },
};

function generateBacktestResult(
  strategy: string,
  startDate: string,
  endDate: string,
  initialCapital: number
): {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  equityCurve: { date: string; value: number }[];
  trades: { date: string; side: string; price: number; pnl: number }[];
} {
  const profile = STRATEGY_PROFILES[strategy] || STRATEGY_PROFILES['MOMENTUM'];

  // Calculate period in days
  const start = new Date(startDate);
  const end = new Date(endDate);
  const periodDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000));
  const periodMonths = periodDays / 30;

  // Generate metrics with slight randomization
  const variation = () => 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  const totalReturn = parseFloat((profile.avgReturn * (periodMonths / 12) * variation()).toFixed(2));
  const sharpeRatio = parseFloat((profile.sharpeBase * variation()).toFixed(2));
  const maxDrawdown = parseFloat((profile.maxDrawdown * variation()).toFixed(2));
  const winRate = parseFloat((profile.winRate * (0.9 + Math.random() * 0.2)).toFixed(1));
  const totalTrades = Math.max(1, Math.floor(profile.tradesPerMonth * periodMonths * variation()));
  const profitFactor = parseFloat((profile.profitFactor * variation()).toFixed(2));

  // Generate equity curve
  const equityCurve: { date: string; value: number }[] = [];
  const dailyReturn = totalReturn / 100 / periodDays;
  let equity = initialCapital;
  let maxEquity = initialCapital;

  for (let i = 0; i <= periodDays; i++) {
    const date = new Date(start.getTime() + i * 86400000);

    // Realistic daily fluctuation
    const noise = (Math.random() - 0.48) * 0.02; // slight upward bias
    const drawdownFactor = equity > maxEquity * 1.1
      ? -0.005 // mean reversion after gains
      : 0;
    equity = equity * (1 + dailyReturn + noise + drawdownFactor);
    maxEquity = Math.max(maxEquity, equity);

    equityCurve.push({
      date: date.toISOString(),
      value: parseFloat(equity.toFixed(2)),
    });
  }

  // Ensure final value matches total return
  const targetFinal = initialCapital * (1 + totalReturn / 100);
  if (equityCurve.length > 0) {
    equityCurve[equityCurve.length - 1].value = parseFloat(targetFinal.toFixed(2));
  }

  // Generate sample trades
  const trades: { date: string; side: string; price: number; pnl: number }[] = [];
  const tradeSample = Math.min(totalTrades, 50); // Limit sample to 50 trades

  // Approximate prices based on symbol common ranges
  const basePrice = 50000 + Math.random() * 50000; // BTC-ish range

  for (let i = 0; i < tradeSample; i++) {
    const tradeDate = new Date(
      start.getTime() + Math.random() * (end.getTime() - start.getTime())
    );
    const isWin = Math.random() * 100 < winRate;
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    const price = basePrice * (0.95 + Math.random() * 0.1);
    const pnlMagnitude = initialCapital * 0.005 * (0.5 + Math.random() * 1.5);
    const pnl = isWin ? pnlMagnitude : -pnlMagnitude * 0.7;

    trades.push({
      date: tradeDate.toISOString(),
      side,
      price: parseFloat(price.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2)),
    });
  }

  // Sort trades by date
  trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    totalTrades,
    profitFactor,
    equityCurve,
    trades,
  };
}

// POST /run - Run backtest
backtestRoutes.post('/run', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();

  const {
    symbol = 'BTCUSDT',
    strategy = 'MOMENTUM',
    startDate = '2024-10-01',
    endDate = '2025-01-20',
    initialCapital = 10000,
    params = {},
  } = body;

  // Generate realistic backtest results
  const result = generateBacktestResult(strategy, startDate, endDate, initialCapital);

  // Store in database
  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO backtest_results (id, user_id, strategy, symbol, config, result) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, strategy, symbol,
    JSON.stringify({ startDate, endDate, initialCapital, params }),
    JSON.stringify(result)
  ).run();

  return c.json({ data: result });
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
