import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId, parseJsonBody } from '../utils';

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

// POST / - Create new bot
botRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);
  const id = generateId();

  const config = { ...(body.config || {}), mode: body.mode || 'PAPER' };

  await c.env.DB.prepare(
    'INSERT INTO bots (id, user_id, name, strategy, exchange, symbol, timeframe, config, risk_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, body.name, body.strategy || 'DCA',
    body.exchange || 'BINANCE', body.symbol || 'BTC/USDT',
    body.timeframe || '1h',
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
  const body = await parseJsonBody(c.req.raw);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return c.json({ error: 'Bot not found' }, 404);

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.strategy !== undefined) { updates.push('strategy = ?'); values.push(body.strategy); }
  if (body.exchange !== undefined) { updates.push('exchange = ?'); values.push(body.exchange); }
  if (body.symbol !== undefined) { updates.push('symbol = ?'); values.push(body.symbol); }
  if (body.timeframe !== undefined) { updates.push('timeframe = ?'); values.push(body.timeframe); }
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
  const { status } = await parseJsonBody(c.req.raw) as { status: string };

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
