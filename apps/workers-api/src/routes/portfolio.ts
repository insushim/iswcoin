import { Hono } from "hono";
import type { Env, AppVariables } from "../index";

type PortfolioEnv = { Bindings: Env; Variables: AppVariables };

export const portfolioRoutes = new Hono<PortfolioEnv>();

// GET /balance - Portfolio balance
portfolioRoutes.get("/balance", async (c) => {
  const userId = c.get("userId");

  const portfolio = await c.env.DB.prepare(
    "SELECT * FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(userId)
    .first();

  if (!portfolio) {
    return c.json({
      data: {
        exchange: "paper",
        holdings: { USDT: { total: 10000, free: 10000, used: 0 } },
        totalValue: 10000,
        dailyPnl: 0,
      },
    });
  }

  const p = portfolio as Record<string, unknown>;
  return c.json({
    data: {
      exchange: "paper",
      holdings: {
        USDT: {
          total: p.total_value as number,
          free: p.total_value as number,
          used: 0,
        },
      },
      totalValue: p.total_value as number,
      dailyPnl: p.daily_pnl as number,
    },
  });
});

// GET /summary - Portfolio summary matching frontend PortfolioSummary type
portfolioRoutes.get("/summary", async (c) => {
  const userId = c.get("userId");

  const [tradesResult, botsResult, portfolio] = await Promise.all([
    c.env.DB.prepare(
      "SELECT pnl, pnl_percent, symbol, side, entry_price, exit_price, quantity, closed_at FROM trades WHERE user_id = ? AND status = ? ORDER BY closed_at DESC LIMIT 100",
    )
      .bind(userId, "CLOSED")
      .all(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM bots WHERE user_id = ? AND status = ?",
    )
      .bind(userId, "RUNNING")
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT total_value, daily_pnl, positions FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(userId)
      .first(),
  ]);

  const trades = (tradesResult.results || []) as Record<string, unknown>[];
  const totalPnl = trades.reduce(
    (sum: number, t) => sum + ((t.pnl as number) || 0),
    0,
  );
  const winning = trades.filter((t) => ((t.pnl as number) || 0) > 0);

  const p = portfolio as Record<string, unknown> | null;
  const totalValue = (p?.total_value as number) || 10000;
  const dailyPnl = (p?.daily_pnl as number) || 0;
  const initialCapital = 10000;
  const totalPnlPercent =
    initialCapital > 0
      ? parseFloat(((totalPnl / initialCapital) * 100).toFixed(2))
      : 0;
  // dailyPnLPercent: 일일 손익 / (총자산 - 일일 손익) = 전일 대비 변화율
  const prevValue = totalValue - dailyPnl;
  const dailyPnlPercent =
    prevValue > 0 ? parseFloat(((dailyPnl / prevValue) * 100).toFixed(2)) : 0;

  // Parse positions from portfolio
  let positions: Array<{
    symbol: string;
    amount: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
  }> = [];
  try {
    const raw = p?.positions as string;
    if (raw) {
      positions = JSON.parse(raw);
    }
  } catch {
    /* ignore */
  }

  return c.json({
    data: {
      totalValue,
      totalPnL: totalPnl,
      totalPnLPercent: totalPnlPercent,
      dailyPnL: dailyPnl,
      dailyPnLPercent: dailyPnlPercent,
      activeBots: botsResult?.count || 0,
      winRate:
        trades.length > 0
          ? parseFloat(((winning.length / trades.length) * 100).toFixed(2))
          : 0,
      totalTrades: trades.length,
      positions,
    },
  });
});

// GET /history - Portfolio value history (실제 거래 기반)
portfolioRoutes.get("/history", async (c) => {
  const userId = c.get("userId");
  const days = parseInt(c.req.query("days") || "30");

  // Get current portfolio value
  const portfolio = await c.env.DB.prepare(
    "SELECT total_value FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(userId)
    .first<{ total_value: number }>();
  const currentValue = portfolio?.total_value || 10000;

  // Fetch actual trades to build real portfolio history
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const tradesResult = await c.env.DB.prepare(
    `SELECT pnl, closed_at FROM trades WHERE user_id = ? AND status = 'CLOSED' AND closed_at >= ? ORDER BY closed_at ASC`,
  )
    .bind(userId, cutoff)
    .all();

  const trades = (tradesResult.results || []) as Array<{
    pnl: number;
    closed_at: string;
  }>;

  // Group trades by date and calculate daily PnL
  const dailyPnl = new Map<string, number>();
  for (const t of trades) {
    const date = t.closed_at.split("T")[0];
    dailyPnl.set(date, (dailyPnl.get(date) || 0) + (t.pnl || 0));
  }

  // Build history: start from (currentValue - totalPnl) and add daily PnL
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const startValue = currentValue - totalPnl;

  const history: Array<{ date: string; value: number; pnl: number }> = [];
  const now = new Date();
  let runningValue = startValue;

  for (let i = days; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    const dateStr = date.toISOString().split("T")[0];
    const dayPnl = dailyPnl.get(dateStr) || 0;
    runningValue += dayPnl;

    history.push({
      date: date.toISOString(),
      value: parseFloat(runningValue.toFixed(2)),
      pnl: parseFloat(dayPnl.toFixed(2)),
    });
  }

  // Adjust last entry to match current value (account for open positions)
  if (history.length > 0) {
    history[history.length - 1].value = currentValue;
  }

  return c.json({ data: history });
});

// GET /positions - Portfolio positions
portfolioRoutes.get("/positions", async (c) => {
  const userId = c.get("userId");

  const portfolio = await c.env.DB.prepare(
    "SELECT positions FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(userId)
    .first<{ positions: string }>();

  let positions: unknown[] = [];
  try {
    if (portfolio?.positions) {
      positions = JSON.parse(portfolio.positions);
    }
  } catch {
    /* ignore */
  }

  // If no positions exist, return default positions with USDT only
  if (positions.length === 0) {
    positions = [
      {
        symbol: "USDT",
        amount: 10000,
        entryPrice: 1,
        currentPrice: 1,
        pnl: 0,
        pnlPercent: 0,
      },
    ];
  }

  return c.json({ data: positions });
});
