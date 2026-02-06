import { Hono } from 'hono';
import type { Env } from '../index';
import { generateId } from '../utils';

export const botRoutes = new Hono<{ Bindings: Env }>();

botRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') || c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  return c.json(results || []);
});

botRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const id = generateId();

  await c.env.DB.prepare(
    'INSERT INTO bots (id, user_id, name, strategy, exchange, symbol, timeframe, config, risk_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, body.userId, body.name, body.strategy || 'DCA',
    body.exchange || 'binance', body.symbol || 'BTC/USDT',
    body.timeframe || '1h',
    JSON.stringify(body.config || {}),
    JSON.stringify(body.riskConfig || {})
  ).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first();
  return c.json(bot);
});

botRoutes.patch('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json();

  const now = new Date().toISOString();
  const extra = status === 'RUNNING' ? `, started_at = '${now}'` : status === 'STOPPED' ? `, stopped_at = '${now}'` : '';

  await c.env.DB.prepare(`UPDATE bots SET status = ?, updated_at = ?${extra} WHERE id = ?`)
    .bind(status, now, id).run();

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first();
  return c.json(bot);
});

botRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM bots WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

botRoutes.get('/:id/performance', async (c) => {
  const id = c.req.param('id');
  const { results: trades } = await c.env.DB.prepare(
    'SELECT * FROM trades WHERE bot_id = ? AND status = ? ORDER BY closed_at DESC LIMIT 50'
  ).bind(id, 'CLOSED').all();

  const allTrades = trades || [];
  const winning = allTrades.filter((t: any) => (t.pnl || 0) > 0);
  const totalProfit = allTrades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);

  return c.json({
    totalTrades: allTrades.length,
    winRate: allTrades.length > 0 ? (winning.length / allTrades.length * 100).toFixed(2) : 0,
    totalProfit: totalProfit.toFixed(2),
    avgProfit: allTrades.length > 0 ? (totalProfit / allTrades.length).toFixed(2) : 0,
    recentTrades: allTrades.slice(0, 20),
  });
});
