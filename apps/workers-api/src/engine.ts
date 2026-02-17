// Paper Trading Engine v3 - Advanced Strategy Execution
// 10 strategies with real technical indicators (RSI, EMA, MACD, BB, ATR, Z-Score)
// v3: 비대칭 R/R, 추세 필터, 과매도 진입, 빠른 이익 실현
// Runs every 5 minutes via Cloudflare Workers Cron
import type { Env } from './index';
import { generateId } from './utils';

const CG = 'https://api.coingecko.com/api/v3';
const COIN_MAP: Record<string, string> = {
  BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin', XRPUSDT: 'ripple', ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin', AVAXUSDT: 'avalanche-2', DOTUSDT: 'polkadot',
  MATICUSDT: 'matic-network', LINKUSDT: 'chainlink', UNIUSDT: 'uniswap',
};
const FALLBACK: Record<string, number> = {
  BTCUSDT: 97500, ETHUSDT: 3250, SOLUSDT: 198, BNBUSDT: 625,
  XRPUSDT: 2.45, ADAUSDT: 0.89, DOGEUSDT: 0.32, AVAXUSDT: 38.5,
  DOTUSDT: 7.89, MATICUSDT: 0.42, LINKUSDT: 19.50, UNIUSDT: 12.30,
};

// Min intervals per strategy (ms)
const MIN_INTERVAL: Record<string, number> = {
  DCA: 1800000,           // 30 min
  GRID: 300000,           // 5 min
  MOMENTUM: 900000,       // 15 min
  MEAN_REVERSION: 900000, // 15 min
  TRAILING: 600000,       // 10 min
  MARTINGALE: 600000,     // 10 min
  SCALPING: 300000,       // 5 min
  STAT_ARB: 900000,       // 15 min
  FUNDING_ARB: 3600000,   // 60 min
  RL_AGENT: 900000,       // 15 min
  ENSEMBLE: 600000,       // 10 min
};

// ============ Types ============

interface Position {
  symbol: string; amount: number; entryPrice: number;
  currentPrice: number; pnl: number; pnlPercent: number;
}
interface BotRow {
  id: string; user_id: string; name: string; strategy: string;
  symbol: string; config: string; status: string;
}
interface TradeSignal {
  side: 'BUY' | 'SELL'; quantity: number; cost: number; reason: string;
}
interface Indicators {
  prices: number[]; current: number;
  rsi: number; rsi7: number;
  ema9: number; ema21: number;
  macdLine: number; macdSignal: number; macdHist: number;
  bbUpper: number; bbMid: number; bbLower: number;
  bbUpper10: number; bbLower10: number;
  bbUpper25: number; bbLower25: number; // BB(20, 2.5) for mean reversion
  atr: number; zScore: number;
  trend: number; // -1 to +1
  chg1h: number; chg24h: number;
}

// ============ Price Fetching ============

async function fetchCurrentPrices(symbols: string[], db?: D1Database): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const ids = symbols.map(s => COIN_MAP[s]).filter(Boolean);

  // Try CoinGecko first
  if (ids.length > 0) {
    try {
      const res = await fetch(`${CG}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
        { headers: { Accept: 'application/json', 'User-Agent': 'CryptoSentinel/2.0' } });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as Record<string, { usd: number }>;
      for (const s of symbols) {
        const cid = COIN_MAP[s];
        if (cid && data[cid]?.usd) prices[s] = data[cid].usd;
      }
    } catch {
      console.log('[Engine] CoinGecko API 실패, DB 캐시 사용 시도');
    }
  }

  // For symbols without prices, try last trade price from DB
  const missing = symbols.filter(s => !prices[s]);
  if (missing.length > 0 && db) {
    for (const s of missing) {
      try {
        const row = await db.prepare(
          "SELECT entry_price FROM trades WHERE symbol = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1"
        ).bind(s.replace('/', '')).first<{ entry_price: number }>();
        if (row?.entry_price) {
          prices[s] = row.entry_price;
          console.log(`[Engine] ${s}: DB 캐시 가격 사용 ($${row.entry_price})`);
        }
      } catch { /* ignore */ }
    }
  }

  // Last resort: use FALLBACK WITHOUT random noise (clearly marked)
  const stillMissing = symbols.filter(s => !prices[s]);
  for (const s of stillMissing) {
    if (FALLBACK[s]) {
      prices[s] = FALLBACK[s];
      console.log(`[Engine] ⚠️ ${s}: 하드코딩 폴백 가격 사용 ($${FALLBACK[s]}) - 거래 건너뜀 권장`);
    }
  }

  return prices;
}

async function fetchHistory(symbol: string): Promise<number[]> {
  const cid = COIN_MAP[symbol];
  if (!cid) return [];
  try {
    const res = await fetch(`${CG}/coins/${cid}/market_chart?vs_currency=usd&days=3`,
      { headers: { Accept: 'application/json', 'User-Agent': 'CryptoSentinel/2.0' } });
    if (!res.ok) return [];
    const data = await res.json() as { prices?: number[][] };
    return (data.prices || []).map(p => p[1]);
  } catch { return []; }
}

// ============ Technical Indicators ============

function ema(prices: number[], period: number): number {
  if (!prices.length) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function emaSeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [...prices];
  const k = 2 / (period + 1);
  const r = [...prices.slice(0, period - 1)];
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  r.push(e);
  for (let i = period; i < prices.length; i++) { e = prices[i] * k + e * (1 - k); r.push(e); }
  return r;
}

function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + (g / period) / (l / period));
}

function macd(prices: number[]): { line: number; signal: number; hist: number } {
  if (prices.length < 26) return { line: 0, signal: 0, hist: 0 };
  const e12 = emaSeries(prices, 12);
  const e26 = emaSeries(prices, 26);
  const macdLine: number[] = [];
  for (let i = 25; i < prices.length; i++) macdLine.push(e12[i] - e26[i]);
  const line = macdLine[macdLine.length - 1] || 0;
  const signal = macdLine.length >= 9 ? ema(macdLine, 9) : line * 0.8;
  return { line, signal, hist: line - signal };
}

function bb(prices: number[], period: number, mult: number) {
  if (prices.length < period) { const p = prices[prices.length - 1] || 0; return { u: p, m: p, l: p }; }
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return { u: m + mult * std, m, l: m - mult * std };
}

function atr(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 0;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) sum += Math.abs(prices[i] - prices[i - 1]);
  return sum / period;
}

function zScore(prices: number[], period: number = 20): number {
  if (prices.length < period) return 0;
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return std === 0 ? 0 : (prices[prices.length - 1] - m) / std;
}

function getTrend(prices: number[]): number {
  if (prices.length < 25) return 0;
  const e20now = ema(prices, 20);
  const e20prev = ema(prices.slice(0, -5), 20);
  const pctChange = (e20now - e20prev) / e20prev;
  if (pctChange > 0.03) return 1;
  if (pctChange > 0.01) return 0.5;
  if (pctChange < -0.03) return -1;
  if (pctChange < -0.01) return -0.5;
  return 0;
}

function calcIndicators(history: number[], current: number): Indicators {
  const p = history.length > 2 ? history : [current, current, current];
  const n = p.length;
  const m = macd(p);
  const b20 = bb(p, 20, 2);
  const b10 = bb(p, 10, 1.5);
  const b25 = bb(p, 20, 2.5);
  return {
    prices: p, current,
    rsi: rsi(p, 14), rsi7: rsi(p, 7),
    ema9: ema(p, 9), ema21: ema(p, 21),
    macdLine: m.line, macdSignal: m.signal, macdHist: m.hist,
    bbUpper: b20.u, bbMid: b20.m, bbLower: b20.l,
    bbUpper10: b10.u, bbLower10: b10.l,
    bbUpper25: b25.u, bbLower25: b25.l,
    atr: atr(p, 14), zScore: zScore(p, 20),
    trend: getTrend(p),
    chg1h: n > 12 ? ((current - p[n - 13]) / p[n - 13]) * 100 : 0,
    chg24h: n > 24 ? ((current - p[Math.max(0, n - 25)]) / p[Math.max(0, n - 25)]) * 100 : 0,
  };
}

// ============ Portfolio Helpers ============

async function getPortfolio(db: D1Database, userId: string) {
  const row = await db.prepare('SELECT id, positions, total_value FROM portfolios WHERE user_id = ? LIMIT 1')
    .bind(userId).first<{ id: string; positions: string; total_value: number }>();
  if (!row) {
    const id = generateId();
    const pos: Position[] = [{ symbol: 'USDT', amount: 10000, entryPrice: 1, currentPrice: 1, pnl: 0, pnlPercent: 0 }];
    await db.prepare('INSERT INTO portfolios (id, user_id, total_value, daily_pnl, positions) VALUES (?, ?, 10000, 0, ?)')
      .bind(id, userId, JSON.stringify(pos)).run();
    return { id, positions: pos, totalValue: 10000 };
  }
  let positions: Position[] = [];
  try { positions = JSON.parse(row.positions || '[]'); } catch { /* */ }
  if (!positions.length) positions = [{ symbol: 'USDT', amount: row.total_value || 10000, entryPrice: 1, currentPrice: 1, pnl: 0, pnlPercent: 0 }];
  return { id: row.id, positions, totalValue: row.total_value || 10000 };
}

function getCash(positions: Position[]): number {
  return positions.find(p => p.symbol === 'USDT')?.amount || 0;
}

function getPosition(positions: Position[], baseSymbol: string): Position | undefined {
  return positions.find(p => p.symbol === baseSymbol && p.amount > 0.000001);
}

function updatePositions(positions: Position[], side: 'BUY' | 'SELL', base: string, qty: number, price: number, cost: number): Position[] {
  const up = [...positions];
  const ui = up.findIndex(p => p.symbol === 'USDT');
  if (ui >= 0) up[ui] = { ...up[ui], amount: up[ui].amount + (side === 'BUY' ? -cost : cost) };
  const ai = up.findIndex(p => p.symbol === base);
  if (side === 'BUY') {
    if (ai >= 0) {
      const tot = up[ai].amount + qty;
      const avg = (up[ai].entryPrice * up[ai].amount + price * qty) / tot;
      up[ai] = { symbol: base, amount: tot, entryPrice: +avg.toFixed(2), currentPrice: price, pnl: +((price - avg) * tot).toFixed(2), pnlPercent: +((price - avg) / avg * 100).toFixed(2) };
    } else {
      up.push({ symbol: base, amount: qty, entryPrice: price, currentPrice: price, pnl: 0, pnlPercent: 0 });
    }
  } else if (ai >= 0) {
    const rem = up[ai].amount - qty;
    if (rem <= 0.000001) up.splice(ai, 1);
    else up[ai] = { ...up[ai], amount: rem, currentPrice: price, pnl: +((price - up[ai].entryPrice) * rem).toFixed(2), pnlPercent: +((price - up[ai].entryPrice) / up[ai].entryPrice * 100).toFixed(2) };
  }
  return up;
}

async function savePortfolio(db: D1Database, id: string, positions: Position[], prices: Record<string, number>) {
  for (const p of positions) {
    if (p.symbol === 'USDT') continue;
    const pk = p.symbol + 'USDT';
    if (prices[pk]) {
      p.currentPrice = prices[pk];
      p.pnl = +((p.currentPrice - p.entryPrice) * p.amount).toFixed(2);
      p.pnlPercent = p.entryPrice > 0 ? +((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(2) : 0;
    }
  }
  let tv = 0;
  for (const p of positions) tv += p.symbol === 'USDT' ? p.amount : p.amount * p.currentPrice;
  await db.prepare('UPDATE portfolios SET total_value = ?, daily_pnl = ?, positions = ?, updated_at = ? WHERE id = ?')
    .bind(+tv.toFixed(2), +(tv - 10000).toFixed(2), JSON.stringify(positions), new Date().toISOString(), id).run();
}

// ============ Trade & State Helpers ============

async function recordTrade(db: D1Database, userId: string, botId: string, symbol: string, side: 'BUY' | 'SELL', price: number, quantity: number, pnl: number, reason: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO trades (id, user_id, bot_id, exchange, symbol, side, order_type, status, entry_price, quantity, pnl, pnl_percent, fee, exit_reason, timestamp, closed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(generateId(), userId, botId, 'BINANCE', symbol.replace('/', ''), side, 'MARKET', 'CLOSED', price, quantity, +pnl.toFixed(2), price > 0 ? +((pnl / (price * quantity)) * 100).toFixed(2) : 0, +(price * quantity * 0.001).toFixed(4), reason, now, now, now).run();
}

async function updateBotStats(db: D1Database, botId: string) {
  const { results } = await db.prepare("SELECT pnl FROM trades WHERE bot_id = ? AND status = 'CLOSED'").bind(botId).all();
  const all = (results || []) as Array<{ pnl: number }>;
  const tp = all.reduce((s, t) => s + (t.pnl || 0), 0);
  const wr = all.length > 0 ? (all.filter(t => (t.pnl || 0) > 0).length / all.length) * 100 : 0;
  await db.prepare('UPDATE bots SET total_profit = ?, total_trades = ?, win_rate = ?, updated_at = ? WHERE id = ?')
    .bind(+tp.toFixed(2), all.length, +wr.toFixed(1), new Date().toISOString(), botId).run();
}

async function getLastTradeTime(db: D1Database, botId: string): Promise<number> {
  const r = await db.prepare('SELECT timestamp FROM trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 1').bind(botId).first<{ timestamp: string }>();
  return r ? new Date(r.timestamp).getTime() : 0;
}

function getBotState(config: Record<string, unknown>): Record<string, unknown> {
  return (config._state as Record<string, unknown>) || {};
}

async function saveBotState(db: D1Database, botId: string, config: Record<string, unknown>, state: Record<string, unknown>) {
  config._state = state;
  await db.prepare('UPDATE bots SET config = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(config), new Date().toISOString(), botId).run();
}

// ============ Strategy Functions v3 ============
// 핵심 원칙: 비대칭 R/R, 추세 필터, 과매도 진입, 빠른 이익 실현

// 1. DCA v2 - 스마트 적립식 + 능동적 이익 실현
function strategyDCA(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  const base = Number(config.investmentAmount || 300);

  // 매도 먼저: 능동적 이익 실현
  if (pos && pos.amount > 0.000001) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    // RSI 과매수 + 수익: 60% 매도
    if (ind.rsi > 68 && pnlPct > 0.005) {
      const qty = pos.amount * 0.6;
      return { side: 'SELL', quantity: qty, cost: qty * price, reason: `DCA 과매수 이익실현 (RSI ${ind.rsi.toFixed(0)}, +${(pnlPct * 100).toFixed(1)}%)` };
    }
    // +4% 이상: 40% 매도
    if (pnlPct >= 0.04) {
      const qty = pos.amount * 0.4;
      return { side: 'SELL', quantity: qty, cost: qty * price, reason: `DCA 목표 이익실현 (+${(pnlPct * 100).toFixed(1)}%)` };
    }
    // 강한 하락추세 + -6%: 전량 손절
    if (pnlPct <= -0.06 && ind.trend < -0.5) {
      return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `DCA 추세 손절 (${(pnlPct * 100).toFixed(1)}%)` };
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
  return { side: 'BUY', quantity: amount / price, cost: amount, reason: `스마트 DCA (RSI ${ind.rsi.toFixed(0)}, 추세 ${ind.trend > 0 ? '↑' : ind.trend < 0 ? '↓' : '→'}, $${amount.toFixed(0)})` };
}

// 2. GRID v2 - 추세 적응형 그리드
function strategyGrid(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>, state: Record<string, unknown>): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const gridLevels = Number(config.gridLevels || 10);
  const investPerGrid = Number(config.investPerGrid || 200);
  const upper = Number(config.upperPrice) || ind.bbUpper25;
  const lower = Number(config.lowerPrice) || ind.bbLower25;
  if (price > upper || price < lower) return { signal: null, newState: state };

  const step = (upper - lower) / gridLevels;
  const curLevel = Math.floor((price - lower) / step);
  const lastLevel = Number(state.lastGridLevel ?? -1);
  const cooldown = Number(state.gridCooldown || 0);

  let signal: TradeSignal | null = null;

  // 손절: -3%
  if (pos && pos.amount > 0.000001) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    if (pnlPct <= -0.03) {
      signal = { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `그리드 손절 (${(pnlPct * 100).toFixed(1)}%)` };
      return { signal, newState: { ...state, lastGridLevel: curLevel, gridCooldown: 3 } };
    }
  }

  // 매도 우선 (수익 확보)
  if (lastLevel >= 0 && curLevel > lastLevel && pos && pos.amount > 0) {
    const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
    if (pnlPct > 0.002) {
      const qty = Math.min(pos.amount, investPerGrid / price);
      signal = { side: 'SELL', quantity: qty, cost: qty * price, reason: `그리드 매도 (L${curLevel}, +${(pnlPct * 100).toFixed(1)}%)` };
    }
  }
  // 매수: RSI < 38, 하락추세 금지, 쿨다운 체크
  else if (lastLevel >= 0 && curLevel < lastLevel && ind.rsi < 38 && cooldown <= 0 && ind.trend > -0.5) {
    const amount = ind.trend < 0 ? investPerGrid * 0.4 : investPerGrid * 0.7;
    const exposure = pos ? pos.amount * price : 0;
    if (exposure < cash * 0.5 && amount <= cash && amount >= 30) {
      signal = { side: 'BUY', quantity: amount / price, cost: amount, reason: `그리드 매수 (L${curLevel}, RSI ${ind.rsi.toFixed(0)})` };
    }
  }

  const newCooldown = cooldown > 0 ? cooldown - 1 : 0;
  return { signal, newState: { ...state, lastGridLevel: curLevel, gridCooldown: newCooldown } };
}

// 3. MOMENTUM v4 - 초보수적 딥밸류 모멘텀
function strategyMomentum(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>, state: Record<string, unknown>): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const sizePct = 0.15;
  const tp = 0.025;
  const sl = 0.015;
  const prevMacdHist = Number(state.prevMacdHist || 0);

  if (!pos || pos.amount <= 0.000001) {
    let reason = '';

    // 강한 하락추세 금지
    if (ind.trend <= -0.3) {
      // 진입 안함
    }
    // 1) 과매도 + BB 하단
    else if (ind.rsi < 28 && price < ind.bbLower && ind.trend >= -0.15) {
      reason = `과매도+BB하단 (RSI ${ind.rsi.toFixed(0)})`;
    }
    // 2) MACD 골든크로스 + 추세 상승
    else if (prevMacdHist < 0 && ind.macdHist > 0 && ind.trend >= 0.2 && ind.rsi > 35 && ind.rsi < 52) {
      reason = `MACD 골든크로스 (추세↑, RSI ${ind.rsi.toFixed(0)})`;
    }
    // 3) 전조건 정렬
    else if (ind.ema9 > ind.ema21 && ind.macdHist > 0 && ind.rsi > 38 && ind.rsi < 52 && ind.trend >= 0.2 && price < ind.bbMid) {
      reason = `전조건 정렬 (RSI ${ind.rsi.toFixed(0)})`;
    }

    if (reason && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) {
        return {
          signal: { side: 'BUY', quantity: amount / price, cost: amount, reason },
          newState: { ...state, prevMacdHist: ind.macdHist },
        };
      }
    }
    return { signal: null, newState: { ...state, prevMacdHist: ind.macdHist } };
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  let signal: TradeSignal | null = null;
  if (pnlPct >= tp) signal = { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  else if (pnlPct >= 0.012) signal = { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `부분익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  else if (pnlPct <= -sl) signal = { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%)` };
  else if (ind.rsi > 65 && pnlPct > 0) signal = { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `RSI 과매수 (${ind.rsi.toFixed(0)})` };
  else if (ind.trend <= -0.15 && pnlPct > -0.005) signal = { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `추세전환 매도 (${(pnlPct * 100).toFixed(1)}%)` };

  return { signal, newState: { ...state, prevMacdHist: ind.macdHist } };
}

// 4. MEAN_REVERSION v2 - BB + RSI 수렴 반등
function strategyMeanReversion(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  const sizePct = 0.30;
  const tp = 0.035;
  const sl = 0.02;

  if (!pos || pos.amount <= 0.000001) {
    // 1차: BB(2.5σ) + RSI < 35
    if (price < ind.bbLower25 && ind.rsi < 35 && cash > 50) {
      const amount = Math.min(cash * sizePct * 1.2, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `BB(2.5σ)하단 매수 (RSI ${ind.rsi.toFixed(0)})` };
    }
    // 2차: BB(2σ) + RSI < 40
    if (price < ind.bbLower && ind.rsi < 40 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `BB(2σ)하단 매수 (RSI ${ind.rsi.toFixed(0)})` };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  if (price >= ind.bbMid && pnlPct > 0.005) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `평균회귀 완료 (+${(pnlPct * 100).toFixed(1)}%)` };
  if (ind.rsi > 60 && pnlPct > 0.01) return { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})` };
  if (pnlPct <= -sl) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%)` };
  return null;
}

// 5. TRAILING v5 - BB밴드 반등 + 트레일링 (MR 하이브리드)
function strategyTrailing(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>, state: Record<string, unknown>): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const sizePct = 0.20;
  const trailPct = Math.max(0.015, Math.min(0.04, (ind.atr / price) * 2));
  const partialSold = Boolean(state.trailPartialSold);

  if (!pos || pos.amount <= 0.000001) {
    let reason = '';
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
          signal: { side: 'BUY', quantity: amount / price, cost: amount, reason },
          newState: { ...state, highSinceEntry: price, trailPartialSold: false },
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
      signal: { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `BB중간선 부분매도 (+${(pnlPct * 100).toFixed(1)}%)` },
      newState: { ...state, highSinceEntry: high, trailPartialSold: true },
    };
  }
  // 트레일링 스탑: +1.5% 이상
  if (pnlPct >= 0.015) {
    const dropFromHigh = high > pos.entryPrice ? (high - price) / high : 0;
    if (dropFromHigh >= trailPct) {
      return {
        signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `트레일링 (+${(pnlPct * 100).toFixed(1)}%)` },
        newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
      };
    }
  }
  // BB 상단 도달 시 전량 매도
  if (price >= ind.bbUpper && pnlPct > 0) {
    return {
      signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `BB상단 익절 (+${(pnlPct * 100).toFixed(1)}%)` },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  if (pnlPct >= 0.035) {
    return {
      signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)` },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  // 손절: -2%
  if (pnlPct <= -0.02) {
    return {
      signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%)` },
      newState: { ...state, highSinceEntry: 0, trailPartialSold: false },
    };
  }
  return { signal: null, newState: { ...state, highSinceEntry: high } };
}

// 6. MARTINGALE v2 - 보수적 마틴게일 + 비대칭 R/R
function strategyMartingale(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>, state: Record<string, unknown>): { signal: TradeSignal | null; newState: Record<string, unknown> } {
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
          signal: { side: 'BUY', quantity: size / price, cost: size, reason: `마틴게일 매수 (x${mult.toFixed(1)}, RSI ${ind.rsi.toFixed(0)}, $${size.toFixed(0)})` },
          newState: { ...state, multiplier: mult, consecutiveLoss: consLoss },
        };
      }
    }
    return { signal: null, newState: state };
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp) {
    return {
      signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `익절 (+${(pnlPct * 100).toFixed(1)}%) → x1 리셋` },
      newState: { ...state, multiplier: 1, consecutiveLoss: 0 },
    };
  }
  if (pnlPct <= -sl) {
    const newConsLoss = consLoss + 1;
    if (newConsLoss >= 3) {
      return {
        signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 + 3연패 리셋 (${(pnlPct * 100).toFixed(1)}%) → x1` },
        newState: { ...state, multiplier: 1, consecutiveLoss: 0 },
      };
    }
    const newMult = Math.min(mult * 1.5, maxMult);
    return {
      signal: { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%) → x${newMult.toFixed(1)}` },
      newState: { ...state, multiplier: newMult, consecutiveLoss: newConsLoss },
    };
  }
  return { signal: null, newState: state };
}

// 7. SCALPING v2 - BB(10,1.5) + RSI(7)
function strategyScalping(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  const sizePct = 0.20;
  const tp = 0.010;
  const sl = 0.012;

  if (!pos || pos.amount <= 0.000001) {
    if (price < ind.bbLower10 && ind.rsi7 < 35 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `스캘핑 BB하단 (RSI7 ${ind.rsi7.toFixed(0)})` };
    }
    if (ind.chg1h < -1.5 && ind.rsi7 < 30 && cash > 50) {
      const amount = Math.min(cash * sizePct * 0.8, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `스캘핑 급락반등 (1h ${ind.chg1h.toFixed(1)}%)` };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (pnlPct >= tp) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `스캘핑 익절 (+${(pnlPct * 100).toFixed(2)}%)` };
  if (pnlPct <= -sl) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `스캘핑 손절 (${(pnlPct * 100).toFixed(2)}%)` };
  if (ind.rsi7 > 72) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `스캘핑 RSI매도 (${ind.rsi7.toFixed(0)})` };
  return null;
}

// 8. STAT_ARB v2 - Z-Score + RSI 이중 필터
function strategyStatArb(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  const sizePct = 0.30;
  const entryZ = Number(config.entryZScore || -1.8);
  const tp = 0.035;
  const sl = 0.02;

  if (!pos || pos.amount <= 0.000001) {
    if (ind.zScore < entryZ && ind.rsi < 42 && cash > 50) {
      const sizeAdj = ind.zScore < -2.5 ? 1.3 : 1.0;
      const amount = Math.min(cash * sizePct * sizeAdj, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `Z-Score 매수 (Z=${ind.zScore.toFixed(2)}, RSI ${ind.rsi.toFixed(0)})` };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (ind.zScore >= 0 && pnlPct > 0) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `Z 회귀 (Z=${ind.zScore.toFixed(2)}, +${(pnlPct * 100).toFixed(1)}%)` };
  if (pnlPct >= tp) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  if (ind.rsi > 65 && pnlPct > 0.005) return { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})` };
  if (pnlPct <= -sl) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%)` };
  return null;
}

// 9. FUNDING_ARB v2 - 펀딩비 차익거래
function strategyFundingArb(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  const sizePct = 0.30;
  const tp = 0.03;
  const sl = 0.02;
  const momentum = ind.chg24h;
  const funding = momentum > 3 ? 0.03 : momentum > 1 ? 0.01 : momentum < -3 ? -0.03 : momentum < -1 ? -0.01 : 0;

  if (!pos || pos.amount <= 0.000001) {
    if (funding < -0.01 && ind.rsi < 50 && cash > 50) {
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `펀딩차익 롱 (펀딩 ${(funding * 100).toFixed(2)}%, RSI ${ind.rsi.toFixed(0)})` };
    }
    if (ind.rsi < 30 && cash > 50) {
      const amount = Math.min(cash * sizePct * 0.8, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `펀딩차익 과매도 매수 (RSI ${ind.rsi.toFixed(0)})` };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (funding > 0.025) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `펀딩 양전환 청산 (${(funding * 100).toFixed(2)}%)` };
  if (pnlPct >= tp) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  if (ind.rsi > 65 && pnlPct > 0.005) return { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `RSI 부분익절 (${ind.rsi.toFixed(0)})` };
  if (pnlPct <= -sl) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `손절 (${(pnlPct * 100).toFixed(1)}%)` };
  return null;
}

// 10. RL_AGENT v2 - 가중 앙상블 AI
function strategyRLAgent(price: number, ind: Indicators, pos: Position | undefined, cash: number, config: Record<string, unknown>): TradeSignal | null {
  // 가중 점수 계산
  let score = 0;
  if (ind.rsi < 30) score += 2; else if (ind.rsi < 40) score += 1; else if (ind.rsi > 70) score -= 2; else if (ind.rsi > 60) score -= 1;
  if (price < ind.bbLower) score += 2; else if (price > ind.bbUpper) score -= 2;
  if (ind.zScore < -2) score += 1.5; else if (ind.zScore < -1.5) score += 1; else if (ind.zScore > 2) score -= 1.5; else if (ind.zScore > 1.5) score -= 1;
  if (ind.ema9 > ind.ema21) score += 1; else score -= 1;
  if (ind.macdHist > 0) score += 1; else if (ind.macdHist < 0) score -= 1;
  score += ind.trend * 0.5;

  if (!pos || pos.amount <= 0.000001) {
    if (score >= 3 && cash > 50) {
      const sizePct = Math.min(0.15 + (score - 3) * 0.05, 0.40);
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount >= 50) return { side: 'BUY', quantity: amount / price, cost: amount, reason: `AI 매수 (점수 ${score.toFixed(1)}, RSI ${ind.rsi.toFixed(0)}, ${(sizePct * 100).toFixed(0)}%)` };
    }
    return null;
  }

  const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
  if (score <= -3) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `AI 강한 매도 (점수 ${score.toFixed(1)})` };
  if (pnlPct >= 0.05) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `AI 익절 (+${(pnlPct * 100).toFixed(1)}%)` };
  if (pnlPct <= -0.025) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `AI 손절 (${(pnlPct * 100).toFixed(1)}%)` };
  if (score <= -1 && pnlPct > 0.01) return { side: 'SELL', quantity: pos.amount * 0.5, cost: pos.amount * 0.5 * price, reason: `AI 부분매도 (점수 ${score.toFixed(1)})` };
  if (ind.rsi > 68 && pnlPct > 0.005) return { side: 'SELL', quantity: pos.amount, cost: pos.amount * price, reason: `AI RSI매도 (${ind.rsi.toFixed(0)})` };
  return null;
}

// 11. ENSEMBLE - 가중 투표 앙상블 전략
function strategyEnsemble(
  price: number, ind: Indicators, pos: Position | undefined, cash: number,
  config: Record<string, unknown>, state: Record<string, unknown>
): { signal: TradeSignal | null; newState: Record<string, unknown> } {
  const strategies = (config.strategies as string[]) || [];
  const weights = (config.weights as Record<string, number>) || {};
  const buyThreshold = Number(config.buyThreshold || 1.5);
  const sellThreshold = Number(config.sellThreshold || -1.5);

  if (strategies.length < 2) return { signal: null, newState: state };

  let buyVotes = 0;
  let sellVotes = 0;
  let maxBuySize = 0;
  let maxSellSize = 0;
  const reasons: string[] = [];
  let updatedState = { ...state };

  for (const strat of strategies) {
    const w = weights[strat] ?? 1.0;
    let subSignal: TradeSignal | null = null;
    let subState = state;

    switch (strat) {
      case 'DCA':
        subSignal = strategyDCA(price, ind, pos, cash, config);
        break;
      case 'GRID': {
        const r = strategyGrid(price, ind, pos, cash, config, state);
        subSignal = r.signal; subState = r.newState;
        break;
      }
      case 'MOMENTUM': {
        const r = strategyMomentum(price, ind, pos, cash, config, state);
        subSignal = r.signal; subState = r.newState;
        break;
      }
      case 'MEAN_REVERSION':
        subSignal = strategyMeanReversion(price, ind, pos, cash, config);
        break;
      case 'TRAILING': {
        const r = strategyTrailing(price, ind, pos, cash, config, state);
        subSignal = r.signal; subState = r.newState;
        break;
      }
      case 'MARTINGALE': {
        const r = strategyMartingale(price, ind, pos, cash, config, state);
        subSignal = r.signal; subState = r.newState;
        break;
      }
      case 'SCALPING':
        subSignal = strategyScalping(price, ind, pos, cash, config);
        break;
      case 'STAT_ARB':
        subSignal = strategyStatArb(price, ind, pos, cash, config);
        break;
      case 'FUNDING_ARB':
        subSignal = strategyFundingArb(price, ind, pos, cash, config);
        break;
      case 'RL_AGENT':
        subSignal = strategyRLAgent(price, ind, pos, cash, config);
        break;
    }

    if (subSignal) {
      if (subSignal.side === 'BUY') {
        buyVotes += w;
        if (subSignal.cost > maxBuySize) maxBuySize = subSignal.cost;
        reasons.push(`${strat}:BUY(w${w})`);
      } else {
        sellVotes += w;
        if (subSignal.quantity > maxSellSize) maxSellSize = subSignal.quantity;
        reasons.push(`${strat}:SELL(w${w})`);
      }
    }

    // 상태 가능한 전략 결과 병합
    if (subState !== state) {
      updatedState = { ...updatedState, [`_${strat}`]: subState };
    }
  }

  const totalWeight = strategies.reduce((sum, s) => sum + (weights[s] ?? 1.0), 0);
  const normalizedBuy = totalWeight > 0 ? (buyVotes / totalWeight) * strategies.length : buyVotes;
  const normalizedSell = totalWeight > 0 ? (-sellVotes / totalWeight) * strategies.length : -sellVotes;

  let signal: TradeSignal | null = null;

  if (normalizedBuy >= buyThreshold && maxBuySize > 0) {
    // 가중 평균 크기 계산 (최대 크기의 60~100%)
    const sizeRatio = Math.min(1.0, 0.6 + (normalizedBuy - buyThreshold) * 0.2);
    const cost = maxBuySize * sizeRatio;
    if (cost >= 30 && cash >= cost) {
      signal = {
        side: 'BUY', quantity: cost / price, cost,
        reason: `앙상블 매수 (${reasons.join(', ')}, 점수 ${normalizedBuy.toFixed(1)})`
      };
    }
  } else if (normalizedSell <= sellThreshold && maxSellSize > 0 && pos && pos.amount > 0) {
    const sellQty = Math.min(maxSellSize, pos.amount);
    signal = {
      side: 'SELL', quantity: sellQty, cost: sellQty * price,
      reason: `앙상블 매도 (${reasons.join(', ')}, 점수 ${normalizedSell.toFixed(1)})`
    };
  }

  return { signal, newState: updatedState };
}

// ============ Main Engine ============

export async function runPaperTrading(env: Env): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(msg); };
  const db = env.DB;

  // 1. Get running bots
  const { results } = await db.prepare("SELECT id, user_id, name, strategy, symbol, config, status FROM bots WHERE status = 'RUNNING'").all();
  const bots = (results || []) as unknown as BotRow[];
  if (!bots.length) { log('실행 중인 봇 없음'); return logs; }
  log(`${bots.length}개 봇 처리 시작`);

  // 2. Collect unique symbols
  const symbols = [...new Set(bots.map(b => b.symbol.replace('/', '')))];

  // 3. Fetch current prices (DB 캐시 폴백 포함)
  const prices = await fetchCurrentPrices(symbols, db);
  log(`가격: ${Object.entries(prices).map(([s, p]) => `${s}=$${p.toFixed(2)}`).join(', ')}`);

  // Wait 2s before fetching history to avoid CoinGecko rate limit
  await new Promise(r => setTimeout(r, 2000));

  // 4. Fetch history & calculate indicators per symbol (with rate limit delay)
  const indicatorMap: Record<string, Indicators> = {};
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (i > 0) await new Promise(r => setTimeout(r, 2000));
    const history = await fetchHistory(sym);
    indicatorMap[sym] = calcIndicators(history, prices[sym] || 0);
    log(`${sym}: RSI=${indicatorMap[sym].rsi.toFixed(1)}, Z=${indicatorMap[sym].zScore.toFixed(2)}, 추세=${indicatorMap[sym].trend > 0 ? '↑' : indicatorMap[sym].trend < 0 ? '↓' : '→'}${history.length === 0 ? ' (히스토리 없음)' : ''}`);
  }

  // 5. Group bots by user
  const userBots = new Map<string, BotRow[]>();
  for (const b of bots) { const list = userBots.get(b.user_id) || []; list.push(b); userBots.set(b.user_id, list); }

  // 6. Process each user's bots
  for (const [userId, botList] of userBots) {
    const portfolio = await getPortfolio(db, userId);

    for (const bot of botList) {
      try {
        const sym = bot.symbol.replace('/', '');
        const price = prices[sym];
        if (!price) { log(`${bot.name}: 가격 없음 (${sym})`); continue; }

        const ind = indicatorMap[sym];
        if (!ind) { log(`${bot.name}: 지표 없음`); continue; }

        // Check min interval
        const lastTime = await getLastTradeTime(db, bot.id);
        const minInt = MIN_INTERVAL[bot.strategy] || 900000;
        if (lastTime > 0 && Date.now() - lastTime < minInt) continue;

        const config = JSON.parse(bot.config || '{}');
        const state = getBotState(config);
        const base = sym.replace('USDT', '');
        const pos = getPosition(portfolio.positions, base);
        const cash = getCash(portfolio.positions);

        let signal: TradeSignal | null = null;
        let newState = state;

        switch (bot.strategy) {
          case 'DCA':
            signal = strategyDCA(price, ind, pos, cash, config);
            break;
          case 'GRID': {
            const r = strategyGrid(price, ind, pos, cash, config, state);
            signal = r.signal; newState = r.newState;
            break;
          }
          case 'MOMENTUM': {
            const r = strategyMomentum(price, ind, pos, cash, config, state);
            signal = r.signal; newState = r.newState;
            break;
          }
          case 'MEAN_REVERSION':
            signal = strategyMeanReversion(price, ind, pos, cash, config);
            break;
          case 'TRAILING': {
            const r = strategyTrailing(price, ind, pos, cash, config, state);
            signal = r.signal; newState = r.newState;
            break;
          }
          case 'MARTINGALE': {
            const r = strategyMartingale(price, ind, pos, cash, config, state);
            signal = r.signal; newState = r.newState;
            break;
          }
          case 'SCALPING':
            signal = strategyScalping(price, ind, pos, cash, config);
            break;
          case 'STAT_ARB':
            signal = strategyStatArb(price, ind, pos, cash, config);
            break;
          case 'FUNDING_ARB':
            signal = strategyFundingArb(price, ind, pos, cash, config);
            break;
          case 'RL_AGENT':
            signal = strategyRLAgent(price, ind, pos, cash, config);
            break;
          case 'ENSEMBLE': {
            const r = strategyEnsemble(price, ind, pos, cash, config, state);
            signal = r.signal; newState = r.newState;
            break;
          }
          default:
            signal = strategyMomentum(price, ind, pos, cash, config, state).signal;
        }

        if (signal) {
          let pnl = 0;
          if (signal.side === 'SELL' && pos) pnl = (price - pos.entryPrice) * signal.quantity;

          await recordTrade(db, userId, bot.id, bot.symbol, signal.side, price, signal.quantity, pnl, signal.reason);
          portfolio.positions = updatePositions(portfolio.positions, signal.side, base, signal.quantity, price, signal.cost);
          await updateBotStats(db, bot.id);

          log(`[${bot.name}] ${signal.side} ${signal.quantity.toFixed(6)} ${base} @ $${price.toFixed(2)} | ${signal.reason}`);
        }

        // Save state if changed
        if (newState !== state) await saveBotState(db, bot.id, config, newState);

      } catch (err) {
        log(`[${bot.name}] 오류: ${err}`);
      }
    }

    await savePortfolio(db, portfolio.id, portfolio.positions, prices);
  }

  log(`엔진 실행 완료 (${new Date().toISOString()})`);
  return logs;
}
