import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId } from '../utils';

type TradeEnv = { Bindings: Env; Variables: AppVariables };

interface TradeRow {
  id: string;
  user_id: string;
  bot_id: string | null;
  exchange: string;
  symbol: string;
  side: string;
  order_type: string;
  status: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  pnl: number | null;
  pnl_percent: number | null;
  fee: number;
  stop_loss: number | null;
  take_profit: number | null;
  exit_reason: string | null;
  metadata: string;
  timestamp: string;
  closed_at: string | null;
  created_at: string;
}

function mapTradeToFrontend(row: TradeRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.order_type,
    price: row.entry_price,
    exitPrice: row.exit_price,
    amount: row.quantity,
    total: row.entry_price * row.quantity,
    fee: row.fee || 0,
    pnl: row.pnl || 0,
    pnlPercent: row.pnl_percent || 0,
    status: row.status,
    exchange: row.exchange,
    botId: row.bot_id,
    botName: '',
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    exitReason: row.exit_reason,
    timestamp: row.timestamp || row.created_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

export const tradeRoutes = new Hono<TradeEnv>();

// GET / - List trades for user
tradeRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const symbol = c.req.query('symbol');
  const side = c.req.query('side');
  const botId = c.req.query('botId');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = (page - 1) * limit;

  let query = 'SELECT t.*, b.name as bot_name FROM trades t LEFT JOIN bots b ON t.bot_id = b.id WHERE t.user_id = ?';
  const params: (string | number)[] = [userId];

  if (symbol) { query += ' AND t.symbol LIKE ?'; params.push(`%${symbol}%`); }
  if (side && side !== 'all') { query += ' AND t.side = ?'; params.push(side); }
  if (botId) { query += ' AND t.bot_id = ?'; params.push(botId); }

  query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  const trades = (results || []).map((row) => {
    const trade = mapTradeToFrontend(row as unknown as TradeRow);
    trade.botName = (row as Record<string, unknown>).bot_name as string || '';
    return trade;
  });

  return c.json({ data: trades });
});

// GET /stats - Trade statistics
tradeRoutes.get('/stats', async (c) => {
  const userId = c.get('userId');

  const { results: trades } = await c.env.DB.prepare(
    'SELECT pnl, pnl_percent FROM trades WHERE user_id = ? AND status = ?'
  ).bind(userId, 'CLOSED').all();

  const all = (trades || []) as Record<string, unknown>[];
  const totalProfit = all.reduce((s: number, t) => s + ((t.pnl as number) || 0), 0);
  const winning = all.filter((t) => ((t.pnl as number) || 0) > 0);

  return c.json({
    data: {
      totalTrades: all.length,
      totalProfit,
      winRate: all.length > 0 ? parseFloat((winning.length / all.length * 100).toFixed(2)) : 0,
      avgProfit: all.length > 0 ? parseFloat((totalProfit / all.length).toFixed(2)) : 0,
      bestTrade: all.length > 0 ? Math.max(...all.map((t) => (t.pnl as number) || 0)) : 0,
      worstTrade: all.length > 0 ? Math.min(...all.map((t) => (t.pnl as number) || 0)) : 0,
    },
  });
});

// GET /:id - Get single trade
tradeRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const trade = await c.env.DB.prepare(
    'SELECT t.*, b.name as bot_name FROM trades t LEFT JOIN bots b ON t.bot_id = b.id WHERE t.id = ? AND t.user_id = ?'
  ).bind(id, userId).first();

  if (!trade) return c.json({ error: 'Trade not found' }, 404);

  const mapped = mapTradeToFrontend(trade as unknown as TradeRow);
  mapped.botName = (trade as Record<string, unknown>).bot_name as string || '';

  return c.json({ data: mapped });
});

// POST / - Create trade
tradeRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const id = generateId();

  await c.env.DB.prepare(
    'INSERT INTO trades (id, user_id, bot_id, exchange, symbol, side, order_type, status, entry_price, quantity, stop_loss, take_profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, body.botId || null, body.exchange || 'BINANCE',
    body.symbol, body.side, body.orderType || 'MARKET', 'OPEN',
    body.entryPrice, body.quantity, body.stopLoss || null, body.takeProfit || null
  ).run();

  const trade = await c.env.DB.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
  if (!trade) return c.json({ error: 'Failed to create trade' }, 500);

  return c.json({ data: mapTradeToFrontend(trade as unknown as TradeRow) });
});
