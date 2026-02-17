import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId } from '../utils';

type BotEnv = { Bindings: Env; Variables: AppVariables };

interface BotRow {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  status: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  config: string;
  risk_config: string;
  total_profit: number;
  total_trades: number;
  win_rate: number;
  max_drawdown: number;
  sharpe_ratio: number | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapBotToFrontend(row: BotRow) {
  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(row.config || '{}');
  } catch { /* ignore */ }

  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    exchange: row.exchange,
    strategy: row.strategy,
    mode: (parsedConfig.mode as string) || 'PAPER',
    status: row.status,
    config: parsedConfig,
    pnl: row.total_profit || 0,
    pnlPercent: row.total_profit ? parseFloat(((row.total_profit / 10000) * 100).toFixed(2)) : 0,
    totalTrades: row.total_trades || 0,
    winRate: row.win_rate || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const botRoutes = new Hono<BotEnv>();

// GET / - List all bots for user
botRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  const bots = (results || []).map((row) => mapBotToFrontend(row as unknown as BotRow));
  return c.json({ data: bots });
});

// GET /:id - Get single bot
botRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const bot = await c.env.DB.prepare(
    'SELECT * FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<BotRow>();

  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({ data: mapBotToFrontend(bot) });
});

// 입력 검증 상수
const VALID_STRATEGIES = ['DCA', 'GRID', 'MARTINGALE', 'TRAILING', 'MOMENTUM', 'MEAN_REVERSION', 'RL_AGENT', 'STAT_ARB', 'SCALPING', 'FUNDING_ARB', 'ENSEMBLE'] as const;
const VALID_EXCHANGES = ['BINANCE', 'UPBIT', 'BYBIT', 'BITHUMB'] as const;
const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'] as const;
// BTCUSDT (슬래시 없음) 및 BTC/USDT (슬래시 있음) 모두 허용
const SYMBOL_REGEX = /^[A-Z0-9]{2,10}(\/[A-Z0-9]{2,10})?$/;

// 심볼을 BASE/QUOTE 형식으로 정규화 (BTCUSDT → BTC/USDT)
function normalizeSymbol(symbol: string): string {
  if (symbol.includes('/')) return symbol;
  // 알려진 quote 통화 매칭 (긴 것부터)
  const quotes = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'KRW'];
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return symbol.slice(0, -q.length) + '/' + q;
    }
  }
  return symbol;
}

const ENSEMBLE_SUB_STRATEGIES = ['DCA', 'GRID', 'MARTINGALE', 'TRAILING', 'MOMENTUM', 'MEAN_REVERSION', 'RL_AGENT', 'STAT_ARB', 'SCALPING', 'FUNDING_ARB'] as const;

// POST / - Create new bot
botRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();

  // 입력 검증
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return c.json({ error: 'Bot name is required (max 100 chars)' }, 400);
  }

  const strategy = String(body.strategy || 'DCA');
  if (!VALID_STRATEGIES.includes(strategy as typeof VALID_STRATEGIES[number])) {
    return c.json({ error: `Invalid strategy. Allowed: ${VALID_STRATEGIES.join(', ')}` }, 400);
  }

  const exchange = String(body.exchange || 'BINANCE');
  if (!VALID_EXCHANGES.includes(exchange as typeof VALID_EXCHANGES[number])) {
    return c.json({ error: `Invalid exchange. Allowed: ${VALID_EXCHANGES.join(', ')}` }, 400);
  }

  const rawSymbol = String(body.symbol || 'BTC/USDT').toUpperCase();
  if (!SYMBOL_REGEX.test(rawSymbol)) {
    return c.json({ error: 'Invalid symbol format. Expected: BTCUSDT or BTC/USDT' }, 400);
  }
  const symbol = normalizeSymbol(rawSymbol);

  const timeframe = String(body.timeframe || '1h');
  if (!VALID_TIMEFRAMES.includes(timeframe as typeof VALID_TIMEFRAMES[number])) {
    return c.json({ error: `Invalid timeframe. Allowed: ${VALID_TIMEFRAMES.join(', ')}` }, 400);
  }

  // 앙상블 전략 검증
  if (strategy === 'ENSEMBLE') {
    const strategies = body.config?.strategies;
    const weights = body.config?.weights;
    if (!Array.isArray(strategies) || strategies.length < 2) {
      return c.json({ error: 'ENSEMBLE requires at least 2 sub-strategies in config.strategies' }, 400);
    }
    for (const s of strategies) {
      if (!ENSEMBLE_SUB_STRATEGIES.includes(s as typeof ENSEMBLE_SUB_STRATEGIES[number])) {
        return c.json({ error: `Invalid sub-strategy: ${s}` }, 400);
      }
    }
    if (weights && typeof weights === 'object') {
      for (const w of Object.values(weights)) {
        if (typeof w !== 'number' || w < 0 || w > 5) {
          return c.json({ error: 'Strategy weights must be numbers between 0 and 5' }, 400);
        }
      }
    }
  }

  const id = generateId();
  const config = { ...(body.config || {}), mode: body.mode || 'PAPER' };

  await c.env.DB.prepare(
    'INSERT INTO bots (id, user_id, name, strategy, exchange, symbol, timeframe, config, risk_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, name, strategy,
    exchange, symbol,
    timeframe,
    JSON.stringify(config),
    JSON.stringify(body.riskConfig || {})
  ).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>();
  if (!bot) return c.json({ error: 'Failed to create bot' }, 500);

  return c.json({ data: mapBotToFrontend(bot) });
});

// PUT /:id - Update bot config
botRoutes.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n || n.length > 100) return c.json({ error: 'Bot name is required (max 100 chars)' }, 400);
    updates.push('name = ?'); values.push(n);
  }
  if (body.strategy !== undefined) {
    if (!VALID_STRATEGIES.includes(String(body.strategy) as typeof VALID_STRATEGIES[number])) {
      return c.json({ error: `Invalid strategy. Allowed: ${VALID_STRATEGIES.join(', ')}` }, 400);
    }
    updates.push('strategy = ?'); values.push(body.strategy);
  }
  if (body.exchange !== undefined) {
    if (!VALID_EXCHANGES.includes(String(body.exchange) as typeof VALID_EXCHANGES[number])) {
      return c.json({ error: `Invalid exchange. Allowed: ${VALID_EXCHANGES.join(', ')}` }, 400);
    }
    updates.push('exchange = ?'); values.push(body.exchange);
  }
  if (body.symbol !== undefined) {
    const rawSym = String(body.symbol).toUpperCase();
    if (!SYMBOL_REGEX.test(rawSym)) {
      return c.json({ error: 'Invalid symbol format. Expected: BTCUSDT or BTC/USDT' }, 400);
    }
    updates.push('symbol = ?'); values.push(normalizeSymbol(rawSym));
  }
  if (body.timeframe !== undefined) {
    if (!VALID_TIMEFRAMES.includes(String(body.timeframe) as typeof VALID_TIMEFRAMES[number])) {
      return c.json({ error: `Invalid timeframe. Allowed: ${VALID_TIMEFRAMES.join(', ')}` }, 400);
    }
    updates.push('timeframe = ?'); values.push(body.timeframe);
  }
  if (body.config !== undefined) { updates.push('config = ?'); values.push(JSON.stringify(body.config)); }
  if (body.riskConfig !== undefined) { updates.push('risk_config = ?'); values.push(JSON.stringify(body.riskConfig)); }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);
  values.push(userId);

  await c.env.DB.prepare(
    `UPDATE bots SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...values).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({ data: mapBotToFrontend(bot) });
});

// POST /:id/start - Start bot
botRoutes.post('/:id/start', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; status: string }>();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE bots SET status = 'RUNNING', started_at = ?, updated_at = ? WHERE id = ?"
  ).bind(now, now, id).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({ data: mapBotToFrontend(bot) });
});

// POST /:id/stop - Stop bot
botRoutes.post('/:id/stop', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; status: string }>();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE bots SET status = 'STOPPED', stopped_at = ?, updated_at = ? WHERE id = ?"
  ).bind(now, now, id).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({ data: mapBotToFrontend(bot) });
});

// PATCH /:id/status - Update bot status (legacy)
botRoutes.patch('/:id/status', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { status } = await c.req.json() as { status: string };

  // 상태값 화이트리스트 검증
  const validStatuses = ['RUNNING', 'STOPPED', 'PAUSED', 'ERROR'];
  if (!status || !validStatuses.includes(status)) {
    return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const now = new Date().toISOString();

  if (status === 'RUNNING') {
    await c.env.DB.prepare('UPDATE bots SET status = ?, started_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, now, id).run();
  } else if (status === 'STOPPED') {
    await c.env.DB.prepare('UPDATE bots SET status = ?, stopped_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, now, id).run();
  } else {
    await c.env.DB.prepare('UPDATE bots SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id).run();
  }

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first<BotRow>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({ data: mapBotToFrontend(bot) });
});

// DELETE /:id - Delete bot
botRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  await c.env.DB.prepare('DELETE FROM bots WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ data: { success: true } });
});

// GET /:id/paper/summary - Paper trading summary
botRoutes.get('/:id/paper/summary', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const bot = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  const { results: trades } = await c.env.DB.prepare(
    "SELECT * FROM trades WHERE bot_id = ? AND status = 'CLOSED' ORDER BY closed_at ASC"
  ).bind(id).all();

  const all = (trades || []) as Array<Record<string, unknown>>;
  const wins = all.filter((t) => ((t.pnl as number) || 0) > 0);
  const losses = all.filter((t) => ((t.pnl as number) || 0) <= 0);
  const totalPnl = all.reduce((s, t) => s + ((t.pnl as number) || 0), 0);
  const totalFees = all.reduce((s, t) => s + ((t.fee as number) || 0), 0);
  const netPnl = totalPnl - totalFees;
  const initialBalance = 10000;
  const balance = initialBalance + netPnl;
  const totalPnlPct = (totalPnl / initialBalance) * 100;

  const winAmounts = wins.map((t) => (t.pnl as number) || 0);
  const lossAmounts = losses.map((t) => Math.abs((t.pnl as number) || 0));
  const avgWin = winAmounts.length > 0 ? winAmounts.reduce((a, b) => a + b, 0) / winAmounts.length : 0;
  const avgLoss = lossAmounts.length > 0 ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0;
  const grossProfit = winAmounts.reduce((a, b) => a + b, 0);
  const grossLoss = lossAmounts.reduce((a, b) => a + b, 0);
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 999 : 0;

  // Equity curve & max drawdown
  let equity = initialBalance;
  let peak = equity;
  let maxDD = 0;
  const equityCurve: { date: string; value: number }[] = [{ date: new Date().toISOString(), value: initialBalance }];
  const dailyPnlMap = new Map<string, number>();

  for (const t of all) {
    const pnl = (t.pnl as number) || 0;
    const fee = (t.fee as number) || 0;
    equity += pnl - fee;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
    const date = ((t.closed_at as string) || '').slice(0, 10);
    if (date) {
      equityCurve.push({ date: t.closed_at as string, value: parseFloat(equity.toFixed(2)) });
      dailyPnlMap.set(date, (dailyPnlMap.get(date) || 0) + pnl - fee);
    }
  }

  const dailyPnl = [...dailyPnlMap.entries()].map(([date, pnl]) => ({
    date, pnl: parseFloat(pnl.toFixed(2)),
  }));

  // Sharpe ratio (간이 계산)
  const returns = all.map((t) => ((t.pnl as number) || 0) / initialBalance);
  const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpeRatio = stdRet > 0 ? parseFloat((avgRet / stdRet * Math.sqrt(252)).toFixed(2)) : 0;

  return c.json({
    summary: {
      balance: parseFloat(balance.toFixed(2)),
      initialBalance,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPct: parseFloat(totalPnlPct.toFixed(2)),
      netPnl: parseFloat(netPnl.toFixed(2)),
      totalTrades: all.length,
      wins: wins.length,
      losses: losses.length,
      winRate: all.length > 0 ? parseFloat((wins.length / all.length * 100).toFixed(1)) : 0,
      sharpeRatio,
      maxDrawdown: parseFloat(maxDD.toFixed(2)),
      maxDrawdownPct: peak > 0 ? parseFloat((maxDD / peak * 100).toFixed(2)) : 0,
      profitFactor,
      avgWin: parseFloat(avgWin.toFixed(2)),
      avgLoss: parseFloat(avgLoss.toFixed(2)),
      equityCurve,
      dailyPnl,
    },
  });
});

// GET /:id/paper/logs - Paper trading logs
botRoutes.get('/:id/paper/logs', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const limit = Math.min(100, parseInt(c.req.query('limit') || '50'));
  const offset = parseInt(c.req.query('offset') || '0');

  const bot = await c.env.DB.prepare(
    'SELECT id, symbol FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ id: string; symbol: string }>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  const { results: trades } = await c.env.DB.prepare(
    "SELECT * FROM trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
  ).bind(id, limit, offset).all();

  const logs = ((trades || []) as Array<Record<string, unknown>>).map((t) => ({
    timestamp: new Date(t.timestamp as string).getTime(),
    signal: {
      action: ((t.side as string) || 'hold').toLowerCase(),
      confidence: 75,
      reason: (t.exit_reason as string) || '',
      price: (t.entry_price as number) || 0,
    },
    execution: t.status === 'CLOSED' ? {
      fillPrice: (t.entry_price as number) || 0,
      amount: (t.quantity as number) || 0,
      side: ((t.side as string) || 'buy').toLowerCase() as 'buy' | 'sell',
      fee: (t.fee as number) || 0,
    } : null,
    position: null,
    paperBalance: 10000 + ((t.pnl as number) || 0),
  }));

  return c.json({ logs });
});

// GET /:id/paper/stats - Paper trading stats (alias)
botRoutes.get('/:id/paper/stats', async (c) => {
  // Redirect to summary
  const userId = c.get('userId');
  const id = c.req.param('id');
  const bot = await c.env.DB.prepare(
    'SELECT total_profit, total_trades, win_rate FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<{ total_profit: number; total_trades: number; win_rate: number }>();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  return c.json({
    data: {
      totalProfit: bot.total_profit || 0,
      totalTrades: bot.total_trades || 0,
      winRate: bot.win_rate || 0,
    },
  });
});

// GET /:id/performance - Get bot performance
botRoutes.get('/:id/performance', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  // 봇 소유권 확인
  const bot = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!bot) return c.json({ error: 'Bot not found' }, 404);

  const { results: trades } = await c.env.DB.prepare(
    'SELECT * FROM trades WHERE bot_id = ? AND status = ? ORDER BY closed_at DESC LIMIT 50'
  ).bind(id, 'CLOSED').all();

  const allTrades = trades || [];
  const winning = allTrades.filter((t: Record<string, unknown>) => ((t.pnl as number) || 0) > 0);
  const totalProfit = allTrades.reduce((sum: number, t: Record<string, unknown>) => sum + ((t.pnl as number) || 0), 0);

  return c.json({
    data: {
      totalTrades: allTrades.length,
      winRate: allTrades.length > 0 ? parseFloat((winning.length / allTrades.length * 100).toFixed(2)) : 0,
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      avgProfit: allTrades.length > 0 ? parseFloat((totalProfit / allTrades.length).toFixed(2)) : 0,
      recentTrades: allTrades.slice(0, 20),
    },
  });
});
