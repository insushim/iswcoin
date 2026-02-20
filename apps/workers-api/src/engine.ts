// Paper Trading Engine v3 - Advanced Strategy Execution
// 10 strategies with real technical indicators (RSI, EMA, MACD, BB, ATR, Z-Score)
// v3: 비대칭 R/R, 추세 필터, 과매도 진입, 빠른 이익 실현
// Runs every 5 minutes via Cloudflare Workers Cron
import type { Env } from "./index";
import { generateId } from "./utils";
import { calcIndicators, type Indicators } from "./indicators";

const BYBIT_API = "https://api.bybit.com";

// Min intervals per strategy (ms)
const MIN_INTERVAL: Record<string, number> = {
  DCA: 600000, // 10 min
  GRID: 300000, // 5 min
  MOMENTUM: 600000, // 10 min
  MEAN_REVERSION: 600000, // 10 min
  TRAILING: 300000, // 5 min
  MARTINGALE: 300000, // 5 min
  SCALPING: 300000, // 5 min
  STAT_ARB: 600000, // 10 min
  FUNDING_ARB: 1800000, // 30 min
  RL_AGENT: 600000, // 10 min
  ENSEMBLE: 300000, // 5 min
};

// ============ Types ============

interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}
interface BotRow {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  symbol: string;
  config: string;
  status: string;
}
interface TradeSignal {
  side: "BUY" | "SELL";
  quantity: number;
  cost: number;
  reason: string;
}
// Indicators type imported from './indicators'

// ============ Price Fetching ============

async function fetchCurrentPrices(
  symbols: string[],
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Bybit v5 ticker API (한 번의 호출로 모든 스팟 티커 조회)
  try {
    const res = await fetch(`${BYBIT_API}/v5/market/tickers?category=spot`);
    if (!res.ok) throw new Error(`Bybit API ${res.status}`);
    const data = (await res.json()) as {
      retCode: number;
      result: { list: Array<{ symbol: string; lastPrice: string }> };
    };
    if (data.retCode !== 0) throw new Error(`Bybit retCode ${data.retCode}`);
    const symbolSet = new Set(symbols);
    for (const item of data.result.list) {
      if (symbolSet.has(item.symbol)) {
        const p = parseFloat(item.lastPrice);
        // NaN/0/음수 가격 방지 (CRITICAL-4)
        if (!isNaN(p) && p > 0) prices[item.symbol] = p;
      }
    }
  } catch (err) {
    console.error(`[Engine] Bybit ticker 실패: ${err}`);
    // 개별 심볼 폴백
    for (const s of symbols) {
      if (prices[s]) continue;
      try {
        const res = await fetch(
          `${BYBIT_API}/v5/market/tickers?category=spot&symbol=${s}`,
        );
        if (res.ok) {
          const d = (await res.json()) as {
            retCode: number;
            result: { list: Array<{ symbol: string; lastPrice: string }> };
          };
          if (d.retCode === 0 && d.result.list.length > 0) {
            const p = parseFloat(d.result.list[0].lastPrice);
            if (!isNaN(p) && p > 0) prices[s] = p;
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  return prices;
}

async function fetchHistory(symbol: string): Promise<number[]> {
  // Bybit v5 klines: 15분봉 200개 = ~2일 (interval=15 = 15분)
  // 주의: Bybit은 최신 데이터가 먼저 오므로 reverse 필요
  try {
    const res = await fetch(
      `${BYBIT_API}/v5/market/kline?category=spot&symbol=${symbol}&interval=15&limit=200`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      retCode: number;
      result: { list: string[][] };
    };
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) return [];
    // list: [[startTime, open, high, low, close, volume, turnover], ...] (newest first)
    return data.result.list
      .reverse()
      .map((k) => parseFloat(k[4]))
      .filter((v) => !isNaN(v) && v > 0); // NaN/0 가격 필터링 (CRITICAL-4)
  } catch {
    return [];
  }
}

// Technical indicators imported from './indicators'

// ============ Portfolio Helpers ============

async function getPortfolio(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT id, positions, total_value FROM portfolios WHERE user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<{ id: string; positions: string; total_value: number }>();
  if (!row) {
    const id = generateId();
    const pos: Position[] = [
      {
        symbol: "USDT",
        amount: 10000,
        entryPrice: 1,
        currentPrice: 1,
        pnl: 0,
        pnlPercent: 0,
      },
    ];
    await db
      .prepare(
        "INSERT INTO portfolios (id, user_id, total_value, daily_pnl, positions) VALUES (?, ?, 10000, 0, ?)",
      )
      .bind(id, userId, JSON.stringify(pos))
      .run();
    return { id, positions: pos, totalValue: 10000 };
  }
  let positions: Position[] = [];
  try {
    positions = JSON.parse(row.positions || "[]");
  } catch {
    /* */
  }
  if (!positions.length)
    positions = [
      {
        symbol: "USDT",
        amount: row.total_value || 10000,
        entryPrice: 1,
        currentPrice: 1,
        pnl: 0,
        pnlPercent: 0,
      },
    ];
  return { id: row.id, positions, totalValue: row.total_value || 10000 };
}

function getCash(positions: Position[]): number {
  return positions.find((p) => p.symbol === "USDT")?.amount || 0;
}

function getPosition(
  positions: Position[],
  baseSymbol: string,
): Position | undefined {
  return positions.find((p) => p.symbol === baseSymbol && p.amount > 0.000001);
}

function updatePositions(
  positions: Position[],
  side: "BUY" | "SELL",
  base: string,
  qty: number,
  price: number,
  cost: number,
): Position[] {
  // NaN/무효 값 방지 (CRITICAL-4, CRITICAL-5)
  if (
    !isFinite(qty) ||
    qty <= 0 ||
    !isFinite(price) ||
    price <= 0 ||
    !isFinite(cost) ||
    cost < 0
  ) {
    return positions;
  }
  const up = [...positions];
  const ui = up.findIndex((p) => p.symbol === "USDT");
  if (side === "BUY" && ui >= 0) {
    // USDT 잔고 음수 방지 (HIGH-1)
    const newAmount = up[ui].amount - cost;
    if (newAmount < 0) return positions; // 잔고 부족 → 거래 거부
    up[ui] = { ...up[ui], amount: newAmount };
  } else if (side === "SELL" && ui >= 0) {
    up[ui] = { ...up[ui], amount: up[ui].amount + cost };
  }
  const ai = up.findIndex((p) => p.symbol === base);
  if (side === "BUY") {
    if (ai >= 0) {
      const tot = up[ai].amount + qty;
      const avg =
        tot > 0
          ? (up[ai].entryPrice * up[ai].amount + price * qty) / tot
          : price;
      up[ai] = {
        symbol: base,
        amount: tot,
        entryPrice: +avg.toFixed(2),
        currentPrice: price,
        pnl: +((price - avg) * tot).toFixed(2),
        pnlPercent: avg > 0 ? +(((price - avg) / avg) * 100).toFixed(2) : 0,
      };
    } else {
      up.push({
        symbol: base,
        amount: qty,
        entryPrice: price,
        currentPrice: price,
        pnl: 0,
        pnlPercent: 0,
      });
    }
  } else if (ai >= 0) {
    // Overselling 방지: 보유량 이상 매도 불가 (CRITICAL-3)
    const actualQty = Math.min(qty, up[ai].amount);
    const rem = up[ai].amount - actualQty;
    if (rem <= 0.000001) up.splice(ai, 1);
    else {
      const ep = up[ai].entryPrice;
      up[ai] = {
        ...up[ai],
        amount: rem,
        currentPrice: price,
        pnl: ep > 0 ? +((price - ep) * rem).toFixed(2) : 0,
        pnlPercent: ep > 0 ? +(((price - ep) / ep) * 100).toFixed(2) : 0,
      };
    }
  }
  return up;
}

async function savePortfolio(
  db: D1Database,
  id: string,
  userId: string,
  positions: Position[],
  prices: Record<string, number>,
) {
  for (const p of positions) {
    if (p.symbol === "USDT") continue;
    const pk = p.symbol + "USDT";
    if (prices[pk]) {
      p.currentPrice = prices[pk];
      p.pnl = +((p.currentPrice - p.entryPrice) * p.amount).toFixed(2);
      p.pnlPercent =
        p.entryPrice > 0
          ? +(((p.currentPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2)
          : 0;
    }
  }
  let tv = 0;
  for (const p of positions)
    tv += p.symbol === "USDT" ? p.amount : p.amount * p.currentPrice;

  // 오늘의 실현 손익 (closed trades only) + 미실현 손익 변화
  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
  const todayPnlRow = await db
    .prepare(
      "SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND status = 'CLOSED' AND closed_at >= ?",
    )
    .bind(userId, todayStart)
    .first<{ total: number }>();
  const realizedDailyPnl = todayPnlRow?.total || 0;

  // 미실현 손익 (현재 보유 포지션의 pnl 합계)
  const unrealizedPnl = positions
    .filter((p) => p.symbol !== "USDT")
    .reduce((sum, p) => sum + (p.pnl || 0), 0);

  const dailyPnl = +(realizedDailyPnl + unrealizedPnl).toFixed(2);

  await db
    .prepare(
      "UPDATE portfolios SET total_value = ?, daily_pnl = ?, positions = ?, updated_at = ? WHERE id = ?",
    )
    .bind(
      +tv.toFixed(2),
      dailyPnl,
      JSON.stringify(positions),
      new Date().toISOString(),
      id,
    )
    .run();
}

// ============ Trade & State Helpers ============

async function recordTrade(
  db: D1Database,
  userId: string,
  botId: string,
  symbol: string,
  side: "BUY" | "SELL",
  price: number,
  quantity: number,
  pnl: number,
  reason: string,
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO trades (id, user_id, bot_id, exchange, symbol, side, order_type, status, entry_price, quantity, pnl, pnl_percent, fee, exit_reason, timestamp, closed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      generateId(),
      userId,
      botId,
      "BYBIT",
      symbol.replace("/", ""),
      side,
      "MARKET",
      "CLOSED",
      price,
      quantity,
      +pnl.toFixed(2),
      price > 0 ? +((pnl / (price * quantity)) * 100).toFixed(2) : 0,
      +(price * quantity * 0.001).toFixed(4),
      reason,
      now,
      now,
      now,
    )
    .run();
}

async function updateBotStats(db: D1Database, botId: string) {
  // SELL 거래만 집계 (BUY는 PnL 0이라 win_rate 왜곡) (MEDIUM-5)
  const { results } = await db
    .prepare(
      "SELECT pnl FROM trades WHERE bot_id = ? AND status = 'CLOSED' AND side = 'SELL'",
    )
    .bind(botId)
    .all();
  const all = (results || []) as Array<{ pnl: number }>;
  const tp = all.reduce((s, t) => s + (t.pnl || 0), 0);
  const wr =
    all.length > 0
      ? (all.filter((t) => (t.pnl || 0) > 0).length / all.length) * 100
      : 0;
  await db
    .prepare(
      "UPDATE bots SET total_profit = ?, total_trades = ?, win_rate = ?, updated_at = ? WHERE id = ?",
    )
    .bind(
      +tp.toFixed(2),
      all.length,
      +wr.toFixed(1),
      new Date().toISOString(),
      botId,
    )
    .run();
}

async function getLastTradeTime(
  db: D1Database,
  botId: string,
): Promise<number> {
  const r = await db
    .prepare(
      "SELECT timestamp FROM trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(botId)
    .first<{ timestamp: string }>();
  return r ? new Date(r.timestamp).getTime() : 0;
}

function getBotState(config: Record<string, unknown>): Record<string, unknown> {
  return (config._state as Record<string, unknown>) || {};
}

async function saveBotState(
  db: D1Database,
  botId: string,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
) {
  config._state = state;
  await db
    .prepare("UPDATE bots SET config = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(config), new Date().toISOString(), botId)
    .run();
}

// ============ Strategy Functions v3 ============
// 핵심 원칙: 비대칭 R/R, 추세 필터, 과매도 진입, 빠른 이익 실현

// 1. DCA v2 - 스마트 적립식 + 능동적 이익 실현
function strategyDCA(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  const base = Number(config.investmentAmount || 300);

  // 매도 먼저: 능동적 이익 실현
  if (pos && pos.amount > 0.000001) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    // RSI 과매수 + 수익: 60% 매도
    if (ind.rsi > 68 && pnlPct > 0.005) {
      const qty = pos.amount * 0.6;
      return {
        side: "SELL",
        quantity: qty,
        cost: qty * price,
        reason: `DCA 과매수 이익실현 (RSI ${ind.rsi.toFixed(0)}, +${(pnlPct * 100).toFixed(1)}%)`,
      };
    }
    // +4% 이상: 40% 매도
    if (pnlPct >= 0.04) {
      const qty = pos.amount * 0.4;
      return {
        side: "SELL",
        quantity: qty,
        cost: qty * price,
        reason: `DCA 목표 이익실현 (+${(pnlPct * 100).toFixed(1)}%)`,
      };
    }
    // 강한 하락추세 + -6%: 전량 손절
    if (pnlPct <= -0.06 && ind.trend < -0.5) {
      return {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `DCA 추세 손절 (${(pnlPct * 100).toFixed(1)}%)`,
      };
    }
  }

  // RSI 기반 매수
  let amount: number;
  if (ind.rsi < 25) amount = base * 2.0;
  else if (ind.rsi < 32) amount = base * 1.5;
  else if (ind.rsi < 40) amount = base * 1.0;
  else if (ind.rsi < 50 && ind.trend >= 0) amount = base * 0.5;
  else return null;

  // 하락추세 감쇄
  if (ind.trend <= -0.5) amount *= 0.3;
  else if (ind.trend < 0) amount *= 0.6;

  // 최대 노출도 체크
  const exposure = pos ? pos.amount * price : 0;
  if (exposure > cash * 1.5) return null; // 이미 50% 이상 노출

  if (cash < amount) amount = Math.min(cash * 0.4, cash);
  if (amount < 10) return null;
  return {
    side: "BUY",
    quantity: amount / price,
    cost: amount,
    reason: `스마트 DCA (RSI ${ind.rsi.toFixed(0)}, 추세 ${ind.trend > 0 ? "↑" : ind.trend < 0 ? "↓" : "→"}, $${amount.toFixed(0)})`,
  };
}

// 2. GRID v2 - 추세 적응형 그리드
function strategyGrid(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const gridLevels = Number(config.gridLevels || 10);
  const investPerGrid = Number(config.investPerGrid || 200);
  const upper = Number(config.upperPrice) || ind.bbUpper25;
  const lower = Number(config.lowerPrice) || ind.bbLower25;
  if (price > upper || price < lower) return { signal: null, newState: state };

  const step = (upper - lower) / gridLevels;
  // step=0 방지: upper==lower일 때 NaN/Infinity 방지 (MEDIUM-2)
  if (step <= 0) return { signal: null, newState: state };
  const curLevel = Math.floor((price - lower) / step);
  const lastLevel = Number(state.lastGridLevel ?? -1);
  const cooldown = Number(state.gridCooldown || 0);

  let signal: TradeSignal | null = null;

  // 손절: -3%
  if (pos && pos.amount > 0.000001) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    if (pnlPct <= -0.03) {
      signal = {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `그리드 손절 (${(pnlPct * 100).toFixed(1)}%)`,
      };
      return {
        signal,
        newState: { ...state, lastGridLevel: curLevel, gridCooldown: 3 },
      };
    }
  }

  // 매도 우선 (수익 확보)
  if (lastLevel >= 0 && curLevel > lastLevel && pos && pos.amount > 0) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    if (pnlPct > 0.002) {
      const qty = Math.min(pos.amount, investPerGrid / price);
      signal = {
        side: "SELL",
        quantity: qty,
        cost: qty * price,
        reason: `그리드 매도 (L${curLevel}, +${(pnlPct * 100).toFixed(1)}%)`,
      };
    }
  }
  // 매수: RSI < 38, 하락추세 금지, 쿨다운 체크
  else if (
    lastLevel >= 0 &&
    curLevel < lastLevel &&
    ind.rsi < 38 &&
    cooldown <= 0 &&
    ind.trend > -0.5
  ) {
    const amount = ind.trend < 0 ? investPerGrid * 0.4 : investPerGrid * 0.7;
    const exposure = pos ? pos.amount * price : 0;
    if (exposure < cash * 0.5 && amount <= cash && amount >= 30) {
      signal = {
        side: "BUY",
        quantity: amount / price,
        cost: amount,
        reason: `그리드 매수 (L${curLevel}, RSI ${ind.rsi.toFixed(0)})`,
      };
    }
  }

  const newCooldown = cooldown > 0 ? cooldown - 1 : 0;
  return {
    signal,
    newState: { ...state, lastGridLevel: curLevel, gridCooldown: newCooldown },
  };
}

// 3. MOMENTUM v4 - 초보수적 딥밸류 모멘텀
function strategyMomentum(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const sizePct = 0.15;
  const tp = 0.025;
  const sl = 0.015;
  const prevMacdHist = Number(state.prevMacdHist || 0);

  if (!pos || pos.amount <= 0.000001) {
    let reason = "";

    // 강한 하락추세 금지
    if (ind.trend <= -0.3) {
      // 진입 안함
    }
    // 1) 과매도 + BB 하단
    else if (ind.rsi < 28 && price < ind.bbLower && ind.trend >= -0.15) {
      reason = `과매도+BB하단 (RSI ${ind.rsi.toFixed(0)})`;
    }
    // 2) MACD 골든크로스 + 추세 상승
    else if (
      prevMacdHist < 0 &&
      ind.macdHist > 0 &&
      ind.trend >= 0.2 &&
      ind.rsi > 35 &&
      ind.rsi < 52
    ) {
      reason = `MACD 골든크로스 (추세↑, RSI ${ind.rsi.toFixed(0)})`;
    }
    // 3) 전조건 정렬
    else if (
      ind.ema9 > ind.ema21 &&
      ind.macdHist > 0 &&
      ind.rsi > 38 &&
      ind.rsi < 52 &&
      ind.trend >= 0.2 &&
      price < ind.bbMid
    ) {
      reason = `전조건 정렬 (RSI ${ind.rsi.toFixed(0)})`;
    }

    if (reason && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) {
        return {
          signal: {
            side: "BUY",
            quantity: amount / price,
            cost: amount,
            reason,
          },
          newState: { ...state, prevMacdHist: ind.macdHist },
        };
      }
    }
    return { signal: null, newState: { ...state, prevMacdHist: ind.macdHist } };
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  let signal: TradeSignal | null = null;
  if (pnlPct >= tp)
    signal = {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  else if (pnlPct >= 0.012)
    signal = {
      side: "SELL",
      quantity: pos.amount * 0.5,
      cost: pos.amount * 0.5 * price,
      reason: `부분익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  else if (pnlPct <= -sl)
    signal = {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
    };
  else if (ind.rsi > 65 && pnlPct > 0)
    signal = {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `RSI 과매수 (${ind.rsi.toFixed(0)})`,
    };
  else if (ind.trend <= -0.15 && pnlPct > -0.005)
    signal = {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `추세전환 매도 (${(pnlPct * 100).toFixed(1)}%)`,
    };

  return { signal, newState: { ...state, prevMacdHist: ind.macdHist } };
}

// 4. MEAN_REVERSION v2 - BB + RSI 수렴 반등
function strategyMeanReversion(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  const sizePct = 0.3;
  const tp = 0.035;
  const sl = 0.02;

  if (!pos || pos.amount <= 0.000001) {
    // 1차: BB(2.5σ) + RSI < 35
    if (price < ind.bbLower25 && ind.rsi < 35 && cash > 50) {
      const amount = Math.min(cash * sizePct * 1.2, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `BB(2.5σ)하단 매수 (RSI ${ind.rsi.toFixed(0)})`,
        };
    }
    // 2차: BB(2σ) + RSI < 40
    if (price < ind.bbLower && ind.rsi < 40 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `BB(2σ)하단 매수 (RSI ${ind.rsi.toFixed(0)})`,
        };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (price >= ind.bbMid && pnlPct > 0.005)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `평균회귀 완료 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (ind.rsi > 60 && pnlPct > 0.01)
    return {
      side: "SELL",
      quantity: pos.amount * 0.5,
      cost: pos.amount * 0.5 * price,
      reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})`,
    };
  if (pnlPct <= -sl)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
    };
  return null;
}

// 5. TRAILING v5 - BB밴드 반등 + 트레일링 (MR 하이브리드)
function strategyTrailing(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const sizePct = 0.2;
  const trailPct = Math.max(0.015, Math.min(0.04, (ind.atr / price) * 2));
  const partialSold = Boolean(state.trailPartialSold);

  if (!pos || pos.amount <= 0.000001) {
    let reason = "";
    // 1) BB(2.5σ) 하단 + RSI < 35
    if (price < ind.bbLower25 && ind.rsi < 35) {
      reason = `BB(2.5σ)하단+트레일 (RSI ${ind.rsi.toFixed(0)})`;
    }
    // 2) BB(2σ) 하단 + RSI < 38
    else if (price < ind.bbLower && ind.rsi < 38) {
      reason = `BB(2σ)하단+트레일 (RSI ${ind.rsi.toFixed(0)})`;
    }

    if (reason && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) {
        return {
          signal: {
            side: "BUY",
            quantity: amount / price,
            cost: amount,
            reason,
          },
          newState: {
            ...state,
            highSinceEntry: price,
            trailPartialSold: false,
          },
        };
      }
    }
    return { signal: null, newState: state };
  }

  const high = Math.max(Number(state.highSinceEntry || pos.entryPrice), price);
  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;

  // BB 중간선 도달 시 부분 매도
  if (!partialSold && price >= ind.bbMid && pnlPct > 0.003) {
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount * 0.5,
        cost: pos.amount * 0.5 * price,
        reason: `BB중간선 부분매도 (+${(pnlPct * 100).toFixed(1)}%)`,
      },
      newState: { ...state, highSinceEntry: high, trailPartialSold: true },
    };
  }
  // 트레일링 스탑: +1.5% 이상
  if (pnlPct >= 0.015) {
    const dropFromHigh = high > pos.entryPrice ? (high - price) / high : 0;
    if (dropFromHigh >= trailPct) {
      return {
        signal: {
          side: "SELL",
          quantity: pos.amount,
          cost: pos.amount * price,
          reason: `트레일링 (+${(pnlPct * 100).toFixed(1)}%)`,
        },
        newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
      };
    }
  }
  // BB 상단 도달 시 전량 매도
  if (price >= ind.bbUpper && pnlPct > 0) {
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `BB상단 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
      },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  if (pnlPct >= 0.035) {
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
      },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  // 손절: -2%
  if (pnlPct <= -0.02) {
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
      },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  return { signal: null, newState: { ...state, highSinceEntry: high } };
}

// 6. MARTINGALE v2 - 보수적 마틴게일 + 비대칭 R/R
function strategyMartingale(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const baseSize = Number(config.investmentAmount || 200);
  const maxMult = 3;
  const tp = 0.03;
  const sl = 0.015;
  const mult = Number(state.multiplier || 1);
  const consLoss = Number(state.consecutiveLoss || 0);

  if (!pos || pos.amount <= 0.000001) {
    // 진입: RSI < 32 (하락추세에서는 < 25)
    const entryRsi = ind.trend <= -0.5 ? 25 : 32;
    if (ind.rsi < entryRsi) {
      const size = Math.min(baseSize * mult, cash * 0.35);
      if (size >= 20 && cash >= size) {
        return {
          signal: {
            side: "BUY",
            quantity: size / price,
            cost: size,
            reason: `마틴게일 매수 (x${mult.toFixed(1)}, RSI ${ind.rsi.toFixed(0)}, $${size.toFixed(0)})`,
          },
          newState: { ...state, multiplier: mult, consecutiveLoss: consLoss },
        };
      }
    }
    return { signal: null, newState: state };
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp) {
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `익절 (+${(pnlPct * 100).toFixed(1)}%) → x1 리셋`,
      },
      newState: { ...state, multiplier: 1, consecutiveLoss: 0 },
    };
  }
  if (pnlPct <= -sl) {
    const newConsLoss = consLoss + 1;
    if (newConsLoss >= 3) {
      return {
        signal: {
          side: "SELL",
          quantity: pos.amount,
          cost: pos.amount * price,
          reason: `손절 + 3연패 리셋 (${(pnlPct * 100).toFixed(1)}%) → x1`,
        },
        newState: { ...state, multiplier: 1, consecutiveLoss: 0 },
      };
    }
    const newMult = Math.min(mult * 1.5, maxMult);
    return {
      signal: {
        side: "SELL",
        quantity: pos.amount,
        cost: pos.amount * price,
        reason: `손절 (${(pnlPct * 100).toFixed(1)}%) → x${newMult.toFixed(1)}`,
      },
      newState: { ...state, multiplier: newMult, consecutiveLoss: newConsLoss },
    };
  }
  return { signal: null, newState: state };
}

// 7. SCALPING v2 - BB(10,1.5) + RSI(7)
function strategyScalping(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  const sizePct = 0.2;
  const tp = 0.01;
  const sl = 0.012;

  if (!pos || pos.amount <= 0.000001) {
    if (price < ind.bbLower10 && ind.rsi7 < 35 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `스캘핑 BB하단 (RSI7 ${ind.rsi7.toFixed(0)})`,
        };
    }
    if (ind.chg1h < -1.5 && ind.rsi7 < 30 && cash > 50) {
      const amount = Math.min(cash * sizePct * 0.8, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `스캘핑 급락반등 (1h ${ind.chg1h.toFixed(1)}%)`,
        };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `스캘핑 익절 (+${(pnlPct * 100).toFixed(2)}%)`,
    };
  if (pnlPct <= -sl)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `스캘핑 손절 (${(pnlPct * 100).toFixed(2)}%)`,
    };
  if (ind.rsi7 > 72)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `스캘핑 RSI매도 (${ind.rsi7.toFixed(0)})`,
    };
  return null;
}

// 8. STAT_ARB v2 - Z-Score + RSI 이중 필터
function strategyStatArb(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  const sizePct = 0.3;
  const entryZ = Number(config.entryZScore || -1.8);
  const tp = 0.035;
  const sl = 0.02;

  if (!pos || pos.amount <= 0.000001) {
    if (ind.zScore < entryZ && ind.rsi < 42 && cash > 50) {
      const sizeAdj = ind.zScore < -2.5 ? 1.3 : 1.0;
      const amount = Math.min(cash * sizePct * sizeAdj, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `Z-Score 매수 (Z=${ind.zScore.toFixed(2)}, RSI ${ind.rsi.toFixed(0)})`,
        };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (ind.zScore >= 0 && pnlPct > 0)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `Z 회귀 (Z=${ind.zScore.toFixed(2)}, +${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (pnlPct >= tp)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (ind.rsi > 65 && pnlPct > 0.005)
    return {
      side: "SELL",
      quantity: pos.amount * 0.5,
      cost: pos.amount * 0.5 * price,
      reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})`,
    };
  if (pnlPct <= -sl)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
    };
  return null;
}

// 9. FUNDING_ARB v2 - 펀딩비 차익거래
function strategyFundingArb(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  const sizePct = 0.3;
  const tp = 0.03;
  const sl = 0.02;
  const momentum = ind.chg24h;
  const funding =
    momentum > 3
      ? 0.03
      : momentum > 1
        ? 0.01
        : momentum < -3
          ? -0.03
          : momentum < -1
            ? -0.01
            : 0;

  if (!pos || pos.amount <= 0.000001) {
    if (funding < -0.01 && ind.rsi < 50 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `펀딩차익 롱 (펀딩 ${(funding * 100).toFixed(2)}%, RSI ${ind.rsi.toFixed(0)})`,
        };
    }
    if (ind.rsi < 30 && cash > 50) {
      const amount = Math.min(cash * sizePct * 0.8, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `펀딩차익 과매도 매수 (RSI ${ind.rsi.toFixed(0)})`,
        };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (funding > 0.025)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `펀딩 양전환 청산 (${(funding * 100).toFixed(2)}%)`,
    };
  if (pnlPct >= tp)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (ind.rsi > 65 && pnlPct > 0.005)
    return {
      side: "SELL",
      quantity: pos.amount * 0.5,
      cost: pos.amount * 0.5 * price,
      reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})`,
    };
  if (pnlPct <= -sl)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
    };
  return null;
}

// 10. RL_AGENT v2 - 가중 앙상블 AI
function strategyRLAgent(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
): TradeSignal | null {
  // 가중 점수 계산
  let score = 0;
  if (ind.rsi < 30) score += 2;
  else if (ind.rsi < 40) score += 1;
  else if (ind.rsi > 70) score -= 2;
  else if (ind.rsi > 60) score -= 1;
  if (price < ind.bbLower) score += 2;
  else if (price > ind.bbUpper) score -= 2;
  if (ind.zScore < -2) score += 1.5;
  else if (ind.zScore < -1.5) score += 1;
  else if (ind.zScore > 2) score -= 1.5;
  else if (ind.zScore > 1.5) score -= 1;
  if (ind.ema9 > ind.ema21) score += 1;
  else score -= 1;
  if (ind.macdHist > 0) score += 1;
  else if (ind.macdHist < 0) score -= 1;
  score += ind.trend * 0.5;

  if (!pos || pos.amount <= 0.000001) {
    if (score >= 3 && cash > 50) {
      const sizePct = Math.min(0.15 + (score - 3) * 0.05, 0.4);
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50)
        return {
          side: "BUY",
          quantity: amount / price,
          cost: amount,
          reason: `AI 매수 (점수 ${score.toFixed(1)}, RSI ${ind.rsi.toFixed(0)}, ${(sizePct * 100).toFixed(0)}%)`,
        };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (score <= -3)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `AI 강한 매도 (점수 ${score.toFixed(1)})`,
    };
  if (pnlPct >= 0.05)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `AI 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (pnlPct <= -0.025)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `AI 손절 (${(pnlPct * 100).toFixed(1)}%)`,
    };
  if (score <= -1 && pnlPct > 0.01)
    return {
      side: "SELL",
      quantity: pos.amount * 0.5,
      cost: pos.amount * 0.5 * price,
      reason: `AI 부분매도 (점수 ${score.toFixed(1)})`,
    };
  if (ind.rsi > 68 && pnlPct > 0.005)
    return {
      side: "SELL",
      quantity: pos.amount,
      cost: pos.amount * price,
      reason: `AI RSI매도 (${ind.rsi.toFixed(0)})`,
    };
  return null;
}

// 11. ENSEMBLE - 가중 투표 앙상블 전략 (개선: 병렬 실행, 신뢰도 기반 사이징)
function strategyEnsemble(
  price: number,
  ind: Indicators,
  pos: Position | undefined,
  cash: number,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  // strategies 파싱: 배열 또는 쉼표 구분 문자열 지원 (HIGH-2)
  let strategies: string[] = [];
  if (Array.isArray(config.strategies)) {
    strategies = config.strategies as string[];
  } else if (typeof config.strategies === "string") {
    strategies = (config.strategies as string)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  // weights 파싱: weights 키 또는 개별 전략명 키에서 추출
  let weights: Record<string, number> = {};
  if (config.weights && typeof config.weights === "object") {
    weights = config.weights as Record<string, number>;
  } else {
    // 개별 키에서 전략 가중치 추출 (폴백)
    for (const s of strategies) {
      if (typeof config[s] === "number") weights[s] = config[s] as number;
    }
  }
  const buyThreshold = Number(config.buyThreshold || 0.5);
  const sellThreshold = Number(config.sellThreshold || -0.5);

  if (strategies.length < 1) return { signal: null, newState: state };

  // 서브 전략 디스패치 함수 (중복 제거 + 각 전략 독립 실행)
  function runSubStrategy(strat: string): {
    signal: TradeSignal | null;
    state: Record<string, unknown>;
  } {
    switch (strat) {
      case "DCA":
        return { signal: strategyDCA(price, ind, pos, cash, config), state };
      case "GRID": {
        const r = strategyGrid(price, ind, pos, cash, config, state);
        return { signal: r.signal, state: r.newState };
      }
      case "MOMENTUM": {
        const r = strategyMomentum(price, ind, pos, cash, config, state);
        return { signal: r.signal, state: r.newState };
      }
      case "MEAN_REVERSION":
        return {
          signal: strategyMeanReversion(price, ind, pos, cash, config),
          state,
        };
      case "TRAILING": {
        const r = strategyTrailing(price, ind, pos, cash, config, state);
        return { signal: r.signal, state: r.newState };
      }
      case "MARTINGALE": {
        const r = strategyMartingale(price, ind, pos, cash, config, state);
        return { signal: r.signal, state: r.newState };
      }
      case "SCALPING":
        return {
          signal: strategyScalping(price, ind, pos, cash, config),
          state,
        };
      case "STAT_ARB":
        return {
          signal: strategyStatArb(price, ind, pos, cash, config),
          state,
        };
      case "FUNDING_ARB":
        return {
          signal: strategyFundingArb(price, ind, pos, cash, config),
          state,
        };
      case "RL_AGENT":
        return {
          signal: strategyRLAgent(price, ind, pos, cash, config),
          state,
        };
      default:
        return { signal: null, state };
    }
  }

  // 모든 서브 전략 병렬 실행 (동기 함수이므로 즉시 결과)
  const results = strategies.map((strat) => ({
    strat,
    ...runSubStrategy(strat),
  }));

  let buyVotes = 0;
  let sellVotes = 0;
  let totalBuySize = 0;
  let totalSellSize = 0;
  let buyCount = 0;
  let sellCount = 0;
  const reasons: string[] = [];
  let updatedState = { ...state };

  for (const { strat, signal: subSignal, state: subState } of results) {
    const w = weights[strat] ?? 1.0;

    if (subSignal) {
      if (subSignal.side === "BUY") {
        buyVotes += w;
        totalBuySize += subSignal.cost;
        buyCount++;
        reasons.push(`${strat}:BUY(w${w.toFixed(1)})`);
      } else {
        sellVotes += w;
        totalSellSize += subSignal.quantity;
        sellCount++;
        reasons.push(`${strat}:SELL(w${w.toFixed(1)})`);
      }
    }

    if (subState !== state) {
      updatedState = { ...updatedState, [`_${strat}`]: subState };
    }
  }

  const totalWeight = strategies.reduce(
    (sum, s) => sum + (weights[s] ?? 1.0),
    0,
  );
  const normalizedBuy =
    totalWeight > 0 ? (buyVotes / totalWeight) * strategies.length : buyVotes;
  const normalizedSell =
    totalWeight > 0
      ? (-sellVotes / totalWeight) * strategies.length
      : -sellVotes;

  // 신호 합의 비율 (얼마나 많은 전략이 동의하는지)
  const buyConsensus = strategies.length > 0 ? buyCount / strategies.length : 0;
  const sellConsensus =
    strategies.length > 0 ? sellCount / strategies.length : 0;

  let signal: TradeSignal | null = null;

  if (normalizedBuy >= buyThreshold && totalBuySize > 0) {
    // 신뢰도 기반 사이징: 합의 비율과 점수에 비례
    const confidenceRatio = Math.min(
      1.0,
      0.4 + buyConsensus * 0.4 + (normalizedBuy - buyThreshold) * 0.15,
    );
    const avgBuySize = totalBuySize / buyCount;
    const cost = avgBuySize * confidenceRatio;
    if (cost >= 20 && cash >= cost) {
      signal = {
        side: "BUY",
        quantity: cost / price,
        cost,
        reason: `앙상블 매수 (${reasons.join(", ")}, 점수 ${normalizedBuy.toFixed(1)}, 합의 ${(buyConsensus * 100).toFixed(0)}%)`,
      };
    }
  } else if (
    normalizedSell <= sellThreshold &&
    totalSellSize > 0 &&
    pos &&
    pos.amount > 0
  ) {
    // 매도: 합의가 높을수록 더 많이 매도 (부분 청산 지원)
    const sellRatio = Math.min(1.0, 0.5 + sellConsensus * 0.5);
    const avgSellSize = totalSellSize / sellCount;
    const sellQty = Math.min(avgSellSize * sellRatio, pos.amount);
    if (sellQty > 0) {
      signal = {
        side: "SELL",
        quantity: sellQty,
        cost: sellQty * price,
        reason: `앙상블 매도 (${reasons.join(", ")}, 점수 ${normalizedSell.toFixed(1)}, 합의 ${(sellConsensus * 100).toFixed(0)}%)`,
      };
    }
  }

  return { signal, newState: updatedState };
}

// ============ Main Engine ============

export async function runPaperTrading(env: Env): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
  };
  const db = env.DB;

  // 동시 실행 방지 (CRITICAL-1): D1 lock row
  const lockId = "engine_lock";
  const lockTimeout = 4 * 60 * 1000; // 4분 (cron 5분 주기보다 짧게)
  try {
    // lock 테이블 없으면 생성
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS engine_locks (id TEXT PRIMARY KEY, locked_at TEXT, locked_by TEXT)",
      )
      .run();
    const existingLock = await db
      .prepare("SELECT locked_at FROM engine_locks WHERE id = ?")
      .bind(lockId)
      .first<{ locked_at: string }>();
    if (existingLock) {
      const elapsed = Date.now() - new Date(existingLock.locked_at).getTime();
      if (elapsed < lockTimeout) {
        log("엔진 이미 실행 중 (lock 활성) - 스킵");
        return logs;
      }
      // 타임아웃된 lock → 해제 후 진행
    }
    await db
      .prepare(
        "INSERT OR REPLACE INTO engine_locks (id, locked_at, locked_by) VALUES (?, ?, ?)",
      )
      .bind(lockId, new Date().toISOString(), "cron")
      .run();
  } catch {
    // lock 처리 실패해도 엔진은 실행 (호환성)
  }

  try {
    // 1. Get running bots
    const { results } = await db
      .prepare(
        "SELECT id, user_id, name, strategy, symbol, config, status FROM bots WHERE status = 'RUNNING'",
      )
      .all();
    const bots = (results || []) as unknown as BotRow[];
    if (!bots.length) {
      log("실행 중인 봇 없음");
      return logs;
    }
    log(`${bots.length}개 봇 처리 시작`);

    // 2. Collect unique symbols
    const symbols = [...new Set(bots.map((b) => b.symbol.replace("/", "")))];

    // 3. Fetch current prices (Bybit API)
    const prices = await fetchCurrentPrices(symbols);
    log(
      `가격: ${Object.entries(prices)
        .map(([s, p]) => `${s}=$${p.toFixed(2)}`)
        .join(", ")}`,
    );

    // 4. Fetch history & calculate indicators per symbol (Bybit v5)
    const indicatorMap: Record<string, Indicators> = {};
    const MIN_HISTORY = 20; // 최소 히스토리 길이 (MEDIUM-1)
    const historyPromises = symbols.map(async (sym) => {
      const history = await fetchHistory(sym);
      if (history.length < MIN_HISTORY) {
        log(
          `${sym}: 히스토리 부족 (${history.length}/${MIN_HISTORY}) - 거래 스킵`,
        );
        return; // indicatorMap에 추가하지 않음 → 해당 심볼 거래 skip
      }
      indicatorMap[sym] = calcIndicators(history, prices[sym] || 0);
      log(
        `${sym}: RSI=${indicatorMap[sym].rsi.toFixed(1)}, Z=${indicatorMap[sym].zScore.toFixed(2)}, 추세=${indicatorMap[sym].trend > 0 ? "↑" : indicatorMap[sym].trend < 0 ? "↓" : "→"}`,
      );
    });
    await Promise.all(historyPromises);

    // 5. Group bots by user
    const userBots = new Map<string, BotRow[]>();
    for (const b of bots) {
      const list = userBots.get(b.user_id) || [];
      list.push(b);
      userBots.set(b.user_id, list);
    }

    // 6. Process each user's bots
    for (const [userId, botList] of userBots) {
      const portfolio = await getPortfolio(db, userId);

      for (const bot of botList) {
        try {
          const sym = bot.symbol.replace("/", "");
          const price = prices[sym];
          if (!price) {
            log(`${bot.name}: 가격 없음 (${sym})`);
            continue;
          }

          const ind = indicatorMap[sym];
          if (!ind) {
            log(`${bot.name}: 지표 없음`);
            continue;
          }

          // Check min interval
          const lastTime = await getLastTradeTime(db, bot.id);
          const minInt = MIN_INTERVAL[bot.strategy] || 900000;
          if (lastTime > 0 && Date.now() - lastTime < minInt) continue;

          const config = JSON.parse(bot.config || "{}");
          const state = getBotState(config);
          const base = sym.replace("USDT", "");
          const pos = getPosition(portfolio.positions, base);
          const cash = getCash(portfolio.positions);

          let signal: TradeSignal | null = null;
          let newState = state;

          switch (bot.strategy) {
            case "DCA":
              signal = strategyDCA(price, ind, pos, cash, config);
              break;
            case "GRID": {
              const r = strategyGrid(price, ind, pos, cash, config, state);
              signal = r.signal;
              newState = r.newState;
              break;
            }
            case "MOMENTUM": {
              const r = strategyMomentum(price, ind, pos, cash, config, state);
              signal = r.signal;
              newState = r.newState;
              break;
            }
            case "MEAN_REVERSION":
              signal = strategyMeanReversion(price, ind, pos, cash, config);
              break;
            case "TRAILING": {
              const r = strategyTrailing(price, ind, pos, cash, config, state);
              signal = r.signal;
              newState = r.newState;
              break;
            }
            case "MARTINGALE": {
              const r = strategyMartingale(
                price,
                ind,
                pos,
                cash,
                config,
                state,
              );
              signal = r.signal;
              newState = r.newState;
              break;
            }
            case "SCALPING":
              signal = strategyScalping(price, ind, pos, cash, config);
              break;
            case "STAT_ARB":
              signal = strategyStatArb(price, ind, pos, cash, config);
              break;
            case "FUNDING_ARB":
              signal = strategyFundingArb(price, ind, pos, cash, config);
              break;
            case "RL_AGENT":
              signal = strategyRLAgent(price, ind, pos, cash, config);
              break;
            case "ENSEMBLE": {
              const r = strategyEnsemble(price, ind, pos, cash, config, state);
              signal = r.signal;
              newState = r.newState;
              break;
            }
            default:
              signal = strategyMomentum(
                price,
                ind,
                pos,
                cash,
                config,
                state,
              ).signal;
          }

          if (signal) {
            // SELL 시 보유량 초과 방지 (CRITICAL-3)
            if (signal.side === "SELL" && pos) {
              signal.quantity = Math.min(signal.quantity, pos.amount);
              signal.cost = signal.quantity * price;
            }

            // PnL 계산: 수수료 반영 (HIGH-6) - Bybit taker 0.1%
            const fee = price * signal.quantity * 0.001;
            let pnl = 0;
            if (signal.side === "SELL" && pos && pos.entryPrice > 0)
              pnl = (price - pos.entryPrice) * signal.quantity - fee;
            else if (signal.side === "BUY") pnl = -fee; // 매수 수수료는 비용으로 기록

            await recordTrade(
              db,
              userId,
              bot.id,
              bot.symbol,
              signal.side,
              price,
              signal.quantity,
              pnl,
              signal.reason,
            );
            portfolio.positions = updatePositions(
              portfolio.positions,
              signal.side,
              base,
              signal.quantity,
              price,
              signal.cost,
            );
            await updateBotStats(db, bot.id);

            log(
              `[${bot.name}] ${signal.side} ${signal.quantity.toFixed(6)} ${base} @ $${price.toFixed(2)} | ${signal.reason}`,
            );
          }

          // Save state if changed
          if (newState !== state)
            await saveBotState(db, bot.id, config, newState);
        } catch (err) {
          log(`[${bot.name}] 오류: ${err}`);
        }
      }

      await savePortfolio(
        db,
        portfolio.id,
        userId,
        portfolio.positions,
        prices,
      );
    }

    log(`엔진 실행 완료 (${new Date().toISOString()})`);
    return logs;
  } finally {
    // lock 해제 (CRITICAL-1)
    try {
      await db
        .prepare("DELETE FROM engine_locks WHERE id = ?")
        .bind(lockId)
        .run();
    } catch {
      /* lock 해제 실패 시 타임아웃으로 자동 해제 */
    }
  }
}
