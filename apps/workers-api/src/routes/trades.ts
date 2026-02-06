import { Hono } from 'hono';
import type { Env } from '../index';
import { generateId } from '../utils';

export const tradeRoutes = new Hono<{ Bindings: Env }>();

tradeRoutes.get('/', async (c) => {
  const userId = c.req.query('userId') || c.req.header('x-user-id');
  const botId = c.req.query('botId');
  const limit = parseInt(c.req.query('limit') || '50');

  let query = 'SELECT * FROM trades WHERE 1=1';
  const params: string[] = [];

  if (userId) { query += ' AND user_id = ?'; params.push(userId); }
  if (botId) { query += ' AND bot_id = ?'; params.push(botId); }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(String(limit));

  const stmt = c.env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all();

  return c.json(results || []);
});

tradeRoutes.get('/stats', async (c) => {
  const userId = c.req.query('userId') || c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const { results: trades } = await c.env.DB.prepare(
    'SELECT pnl, pnl_percent FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'CLOSED').all();

  const all = (trades || []) as any[];
  const totalProfit = all.reduce((s: number, t: any) => s + (t.pnl || 0), 0);
  const winning = all.filter((t: any) => (t.pnl || 0) > 0);

  return c.json({
    totalTrades: all.length,
    totalProfit,
    winRate: all.length > 0 ? (winning.length / all.length * 100) : 0,
    avgProfit: all.length > 0 ? totalProfit / all.length : 0,
    bestTrade: all.length > 0 ? Math.max(...all.map((t: any) => t.pnl || 0)) : 0,
    worstTrade: all.length > 0 ? Math.min(...all.map((t: any) => t.pnl || 0)) : 0,
  });
});

tradeRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const id = generateId();

  await c.env.DB.prepare(
    'INSERT INTO trades (id, user_id, bot_id, exchange, symbol, side, order_type, status, entry_price, quantity, stop_loss, take_profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, body.userId, body.botId || null, body.exchange || 'binance',
    body.symbol, body.side, body.orderType || 'MARKET', 'OPEN',
    body.entryPrice, body.quantity, body.stopLoss || null, body.takeProfit || null
  ).run();

  const trade = await c.env.DB.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
  return c.json(trade);
});
