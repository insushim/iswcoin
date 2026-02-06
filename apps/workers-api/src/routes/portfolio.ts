import { Hono } from 'hono';
import type { Env } from '../index';

export const portfolioRoutes = new Hono<{ Bindings: Env }>();

portfolioRoutes.get('/balance', async (c) => {
  const userId = c.req.query('userId') || c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const portfolio = await c.env.DB.prepare(
    'SELECT * FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(userId).first();

  if (!portfolio) {
    return c.json({ exchange: 'paper', holdings: { USDT: { total: 10000, free: 10000, used: 0 } } });
  }

  return c.json({
    exchange: 'paper',
    holdings: {
      USDT: { total: (portfolio as any).total_value, free: (portfolio as any).total_value, used: 0 },
    },
    totalValue: (portfolio as any).total_value,
    dailyPnl: (portfolio as any).daily_pnl,
  });
});

portfolioRoutes.get('/summary', async (c) => {
  const userId = c.req.query('userId') || c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const [tradesResult, botsResult, portfolio] = await Promise.all([
    c.env.DB.prepare('SELECT pnl, pnl_percent, symbol, side, entry_price, exit_price, closed_at FROM trades WHERE user_id = ? AND status = ? ORDER BY closed_at DESC LIMIT 100').bind(userId, 'CLOSED').all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM bots WHERE user_id = ? AND status = ?').bind(userId, 'RUNNING').first<{ count: number }>(),
    c.env.DB.prepare('SELECT total_value, daily_pnl FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').bind(userId).first(),
  ]);

  const trades = (tradesResult.results || []) as any[];
  const totalProfit = trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
  const winning = trades.filter((t: any) => (t.pnl || 0) > 0);

  return c.json({
    totalTrades: trades.length,
    totalProfit,
    winRate: trades.length > 0 ? (winning.length / trades.length * 100) : 0,
    activeBots: botsResult?.count || 0,
    portfolioValue: (portfolio as any)?.total_value || 10000,
    dailyPnl: (portfolio as any)?.daily_pnl || 0,
    recentTrades: trades.slice(0, 10),
  });
});
