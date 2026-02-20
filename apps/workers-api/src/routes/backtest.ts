import { Hono } from "hono";
import type { Env, AppVariables } from "../index";
import { generateId } from "../utils";

type BacktestEnv = { Bindings: Env; Variables: AppVariables };
export const backtestRoutes = new Hono<BacktestEnv>();

const BYBIT_BASE = "https://api.bybit.com";

// ============ Types ============

interface DailyPrice {
  date: string;
  timestamp: number;
  price: number;
  high: number;
  low: number;
}
interface BacktestTrade {
  date: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  pnl: number;
  reason: string;
}
interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  equityCurve: { date: string; value: number }[];
  trades: BacktestTrade[];
  dataSource: string;
  priceRange: { start: number; end: number; high: number; low: number };
}

// ============ Fetch Historical Data ============

async function fetchHistoricalPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<DailyPrice[]> {
  const bybitSymbol = symbol.replace("/", "");
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const limit = Math.min(Math.ceil((endMs - startMs) / 86400000) + 1, 1000);

  const res = await fetch(
    `${BYBIT_BASE}/v5/market/kline?category=spot&symbol=${bybitSymbol}&interval=D&start=${startMs}&end=${endMs}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Bybit API 오류: ${res.status}`);
  const json = (await res.json()) as {
    retCode: number;
    retMsg?: string;
    result: { list: string[][] };
  };
  if (json.retCode !== 0)
    throw new Error(`Bybit API 오류: ${json.retMsg || json.retCode}`);

  const klines = json.result.list;
  if (!Array.isArray(klines) || klines.length < 2)
    throw new Error("가격 데이터가 부족합니다.");

  // Bybit returns klines in REVERSE order (newest first) — must reverse
  klines.reverse();

  const dailyMap = new Map<string, DailyPrice>();
  for (const k of klines) {
    // Bybit v5 kline format: [startTime, open, high, low, close, volume, turnover]
    const ts = Number(k[0]);
    const price = parseFloat(k[4]); // close
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    const existing = dailyMap.get(dayKey);
    if (!existing) {
      dailyMap.set(dayKey, {
        date: new Date(ts).toISOString(),
        timestamp: ts,
        price,
        high,
        low,
      });
    } else {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
    }
  }

  const result = Array.from(dailyMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  if (result.length < 2)
    throw new Error(
      `선택한 기간에 데이터가 부족합니다. 최근 1년 이내를 선택해주세요.`,
    );
  return result;
}

// ============ Technical Indicators ============

function calcEMA(prices: number[], period: number): number {
  if (!prices.length) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

function calcEMASeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [...prices];
  const k = 2 / (period + 1);
  const r = [...prices.slice(0, period - 1)];
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  r.push(e);
  for (let i = period; i < prices.length; i++) {
    e = prices[i] * k + e * (1 - k);
    r.push(e);
  }
  return r;
}

function calcRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let g = 0,
    l = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / period / (l / period));
}

function calcMACD(prices: number[]): {
  line: number;
  signal: number;
  hist: number;
} {
  if (prices.length < 26) return { line: 0, signal: 0, hist: 0 };
  const e12 = calcEMASeries(prices, 12);
  const e26 = calcEMASeries(prices, 26);
  const macdLine: number[] = [];
  for (let i = 25; i < prices.length; i++) macdLine.push(e12[i] - e26[i]);
  const line = macdLine[macdLine.length - 1] || 0;
  const signal = macdLine.length >= 9 ? calcEMA(macdLine, 9) : line * 0.8;
  return { line, signal, hist: line - signal };
}

function calcBB(prices: number[], period: number, mult: number) {
  if (prices.length < period) {
    const p = prices[prices.length - 1] || 0;
    return { u: p, m: p, l: p, width: 0 };
  }
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return {
    u: m + mult * std,
    m,
    l: m - mult * std,
    width: std > 0 ? ((2 * mult * std) / m) * 100 : 0,
  };
}

function calcATR(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 0;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++)
    sum += Math.abs(prices[i] - prices[i - 1]);
  return sum / period;
}

function calcZScore(prices: number[], period: number = 20): number {
  if (prices.length < period) return 0;
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return std === 0 ? 0 : (prices[prices.length - 1] - m) / std;
}

// Trend detection: -1 (strong bear) to +1 (strong bull)
function getTrend(prices: number[]): number {
  if (prices.length < 25) return 0;
  const e20now = calcEMA(prices, 20);
  const e20prev = calcEMA(prices.slice(0, -5), 20);
  const pctChange = (e20now - e20prev) / e20prev;
  if (pctChange > 0.03) return 1;
  if (pctChange > 0.01) return 0.5;
  if (pctChange < -0.03) return -1;
  if (pctChange < -0.01) return -0.5;
  return 0;
}

// ============ Metrics Builder ============

function buildResult(
  trades: BacktestTrade[],
  equityCurve: { date: string; value: number }[],
  initialCapital: number,
  prices: DailyPrice[],
): BacktestResult {
  const sells = trades.filter((t) => t.side === "SELL");
  const wins = sells.filter((t) => t.pnl > 0);
  const losses = sells.filter((t) => t.pnl <= 0);
  const totalPnl = sells.reduce((s, t) => s + t.pnl, 0);
  const totalReturn =
    initialCapital > 0 ? +((totalPnl / initialCapital) * 100).toFixed(2) : 0;
  const winRate =
    sells.length > 0 ? +((wins.length / sells.length) * 100).toFixed(1) : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor =
    grossLoss > 0
      ? +(grossProfit / grossLoss).toFixed(2)
      : grossProfit > 0
        ? 999
        : 0;

  let maxDD = 0,
    peak = initialCapital;
  for (const p of equityCurve) {
    if (p.value > peak) peak = p.value;
    const dd = ((peak - p.value) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  let sharpe = 0;
  if (equityCurve.length > 1) {
    const rets: number[] = [];
    for (let i = 1; i < equityCurve.length; i++)
      rets.push(
        (equityCurve[i].value - equityCurve[i - 1].value) /
          equityCurve[i - 1].value,
      );
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const std = Math.sqrt(
      rets.reduce((s, r) => s + (r - avg) ** 2, 0) / rets.length,
    );
    sharpe = std > 0 ? +((avg / std) * Math.sqrt(365)).toFixed(2) : 0;
  }

  const allP = prices.map((p) => p.price);
  return {
    totalReturn,
    sharpeRatio: sharpe,
    maxDrawdown: +(-maxDD).toFixed(2),
    winRate,
    totalTrades: trades.length,
    profitFactor,
    equityCurve,
    trades: trades.slice(0, 200),
    dataSource: "Bybit 실제 과거 데이터",
    priceRange: {
      start: +allP[0].toFixed(2),
      end: +allP[allP.length - 1].toFixed(2),
      high: +Math.max(...allP).toFixed(2),
      low: +Math.min(...allP).toFixed(2),
    },
  };
}

// ============ Strategy Backtests v2 ============
// 핵심 원칙: 비대칭 리스크/리워드 (TP > SL), 과매도 진입, 빠른 이익 실현, 추세 필터

// 1. DCA v2 - 스마트 적립식 + 능동적 이익 실현
function backtestDCA(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const baseAmount = Number(
    params.investmentAmount || params.positionSize || 200,
  );
  const interval = Number(params.interval || 3);
  let cash = capital,
    holdings = 0,
    avgEntry = 0,
    daysSince = interval;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    daysSince++;
    const r = hist.length > 14 ? calcRSI(hist, 14) : 50;
    const trend = getTrend(hist);

    // SELL first: 능동적 이익 실현
    if (holdings > 0) {
      const pnlPct = (price - avgEntry) / avgEntry;

      if (r > 68 && pnlPct > 0.005) {
        // RSI 과매수: 60% 매도
        const qty = holdings * 0.6;
        const pnl = (price - avgEntry) * qty;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +pnl.toFixed(2),
          reason: `DCA 과매수 이익실현 (RSI ${r.toFixed(0)}, +${(pnlPct * 100).toFixed(1)}%)`,
        });
      } else if (pnlPct >= 0.04) {
        // +4% 이상: 40% 매도
        const qty = holdings * 0.4;
        const pnl = (price - avgEntry) * qty;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +pnl.toFixed(2),
          reason: `DCA 목표 이익실현 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
      } else if (pnlPct <= -0.06 && trend < -0.5) {
        // 강한 하락추세에서 -6%: 전량 손절
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `DCA 추세 손절 (${(pnlPct * 100).toFixed(1)}%, 하락추세)`,
        });
        holdings = 0;
      }
    }

    // BUY: RSI 기반 적립식
    if (daysSince >= interval && cash > 100) {
      let amount = 0;
      if (r < 25) amount = baseAmount * 2.0;
      else if (r < 32) amount = baseAmount * 1.5;
      else if (r < 40) amount = baseAmount * 1.0;
      else if (r < 50 && trend >= 0) amount = baseAmount * 0.5;

      // 하락추세 감쇄
      if (trend <= -0.5) amount *= 0.3;
      else if (trend < 0) amount *= 0.6;

      // 최대 노출도: 자본의 50%
      const exposure = holdings * price;
      if (exposure > capital * 0.5) amount = 0;

      if (amount > 50 && cash >= amount) {
        const qty = amount / price;
        avgEntry =
          holdings > 0
            ? (avgEntry * holdings + price * qty) / (holdings + qty)
            : price;
        cash -= amount;
        holdings += qty;
        daysSince = 0;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `스마트 DCA (RSI ${r.toFixed(0)}, 추세 ${trend > 0 ? "↑" : trend < 0 ? "↓" : "→"}, $${amount.toFixed(0)})`,
        });
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 2. GRID v3 - 보수적 추세 적응형 그리드
function backtestGrid(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const gridLevels = Number(params.gridLevels || 10);
  const investPerGrid = Number(
    params.investPerGrid || params.positionSize || 200,
  );
  let cash = capital,
    holdings = 0,
    avgEntry = 0,
    lastLevel = -1;
  let cooldownDays = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    if (cooldownDays > 0) cooldownDays--;
    if (hist.length < 20) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const bb = calcBB(hist, 20, 2.5);
    const r = calcRSI(hist, 14);
    const trend = getTrend(hist);
    const step = (bb.u - bb.l) / gridLevels;

    if (step <= 0 || price < bb.l * 0.95 || price > bb.u * 1.05) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const level = Math.floor((price - bb.l) / step);

    // 매도 먼저 (수익 확보 우선)
    if (holdings > 0 && lastLevel >= 0 && level > lastLevel) {
      const pnlPct = (price - avgEntry) / avgEntry;
      // 수익 중이면 적극 매도
      if (pnlPct > 0.002) {
        const sellQty = Math.min(holdings, investPerGrid / price);
        const pnl = (price - avgEntry) * sellQty;
        cash += sellQty * price;
        holdings -= sellQty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: sellQty,
          pnl: +pnl.toFixed(2),
          reason: `그리드 매도 (L${level}, +${(pnlPct * 100).toFixed(1)}%)`,
        });
      }
    }

    // 매수: 가격 하락 + RSI 과매도 + 쿨다운 없음
    if (lastLevel >= 0 && level < lastLevel && r < 38 && cooldownDays === 0) {
      // 하락추세에서는 매수 정지
      if (trend <= -0.5) {
        // 강한 하락추세 → 매수 금지
      } else {
        const amount = trend < 0 ? investPerGrid * 0.4 : investPerGrid * 0.7;
        const exposure = holdings * price;
        // 최대 노출도: 25%
        if (exposure < capital * 0.25 && amount <= cash && amount >= 30) {
          const qty = amount / price;
          avgEntry =
            holdings > 0
              ? (avgEntry * holdings + price * qty) / (holdings + qty)
              : price;
          cash -= amount;
          holdings += qty;
          trades.push({
            date,
            side: "BUY",
            price,
            quantity: qty,
            pnl: 0,
            reason: `그리드 매수 (L${level}, RSI ${r.toFixed(0)}, $${amount.toFixed(0)})`,
          });
        }
      }
    }

    // 손절: -3% 이상 손실
    if (holdings > 0) {
      const pnlPct = (price - avgEntry) / avgEntry;
      if (pnlPct <= -0.03) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `그리드 손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
        cooldownDays = 3; // 손절 후 3일 쿨다운
      }
    }

    lastLevel = level;
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 3. MOMENTUM v5 - 적응형 모멘텀 (상승/하락장 모두 대응)
function backtestMomentum(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.2;
  const tp = 0.03; // +3% 익절
  const sl = 0.02; // -2% 손절 (비대칭 1.5:1)
  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];
  let prevMacdHist = 0;
  let cooldown = 0;

  for (const { date, price } of prices) {
    hist.push(price);
    if (cooldown > 0) cooldown--;
    if (hist.length < 26) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const r = calcRSI(hist, 14);
    const m = calcMACD(hist);
    const e9 = calcEMA(hist, 9),
      e21 = calcEMA(hist, 21);
    const trend = getTrend(hist);
    const bb = calcBB(hist, 20, 2);
    const z = calcZScore(hist, 20);

    if (holdings === 0 && cooldown === 0) {
      let reason = "";

      // 1) 과매도 반등: RSI < 32 + BB 하단 근접 (모든 시장환경)
      if (r < 32 && price < bb.l * 1.01) {
        reason = `과매도 반등 (RSI ${r.toFixed(0)}, Z=${z.toFixed(1)})`;
      }
      // 2) MACD 골든크로스 + 중립 이상 추세
      else if (
        prevMacdHist < 0 &&
        m.hist > 0 &&
        trend >= -0.3 &&
        r > 35 &&
        r < 55
      ) {
        reason = `MACD 골든크로스 (RSI ${r.toFixed(0)})`;
      }
      // 3) 전조건 정렬: EMA9>EMA21 + MACD+ + RSI 중립 + BB 하반
      else if (e9 > e21 && m.hist > 0 && r > 38 && r < 58 && price < bb.m) {
        reason = `모멘텀 정렬 (RSI ${r.toFixed(0)})`;
      }
      // 4) 급락 후 Z-Score 복귀 시그널 (하락장 대응)
      else if (z < -1.5 && r < 38 && m.hist > prevMacdHist) {
        reason = `Z-Score 반등 (Z=${z.toFixed(1)}, RSI ${r.toFixed(0)})`;
      }

      if (reason && cash > 100) {
        // 추세 역행 시 포지션 축소
        const adjSize = trend < -0.3 ? sizePct * 0.5 : sizePct;
        const amount = Math.min(cash * adjSize, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason,
        });
      }
    } else if (holdings > 0) {
      const pnlPct = (price - avgEntry) / avgEntry;

      // 빠른 익절
      if (pnlPct >= tp) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 부분 익절: +1.5%에서 절반
      else if (pnlPct >= 0.015) {
        const qty = holdings * 0.5;
        const pnl = (price - avgEntry) * qty;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +pnl.toFixed(2),
          reason: `부분익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
      }
      // 손절
      else if (pnlPct <= -sl) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
        cooldown = 3;
      }
      // RSI 과매수
      else if (r > 65 && pnlPct > 0) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `RSI 과매수 (${r.toFixed(0)})`,
        });
        holdings = 0;
      }
      // MACD 데드크로스 + 수익중
      else if (m.hist < 0 && prevMacdHist >= 0 && pnlPct > -0.005) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `MACD 데드크로스 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
    }
    prevMacdHist = m.hist;
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 4. MEAN_REVERSION v2 - 볼린저 밴드 + RSI 수렴 반등
function backtestMeanReversion(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.3;
  const tp = 0.035; // +3.5% 익절
  const sl = 0.02; // -2% 손절 (비대칭 1.75:1)
  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    if (hist.length < 20) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const bb20 = calcBB(hist, 20, 2);
    const bb25 = calcBB(hist, 20, 2.5);
    const r = calcRSI(hist, 14);

    if (holdings === 0) {
      // 1차 진입: BB(20,2.5) 하단 + RSI < 35 (강한 시그널)
      if (price < bb25.l && r < 35 && cash > 100) {
        const amount = Math.min(cash * sizePct * 1.2, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `BB(2.5σ)하단 매수 (RSI ${r.toFixed(0)})`,
        });
      }
      // 2차 진입: BB(20,2) 하단 + RSI < 40
      else if (price < bb20.l && r < 40 && cash > 100) {
        const amount = Math.min(cash * sizePct, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `BB(2σ)하단 매수 (RSI ${r.toFixed(0)})`,
        });
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;

      // 익절: BB 중간선 도달 또는 TP
      if (pnlPct >= tp) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      } else if (price >= bb20.m && pnlPct > 0.005) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `평균회귀 완료 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 부분 익절: RSI > 60 && 수익중
      else if (r > 60 && pnlPct > 0.01) {
        const qty = holdings * 0.5;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +((price - avgEntry) * qty).toFixed(2),
          reason: `RSI 과매수 부분익절 (${r.toFixed(0)})`,
        });
      }
      // 손절
      else if (pnlPct <= -sl) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 5. TRAILING v5 - BB밴드 반등 + 트레일링 (MR 하이브리드)
function backtestTrailing(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.2;
  let cash = capital,
    holdings = 0,
    avgEntry = 0,
    highSince = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];
  let cooldown = 0;
  let partialSold = false;

  for (const { date, price, high } of prices) {
    hist.push(price);
    if (cooldown > 0) cooldown--;
    if (hist.length < 20) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const r = calcRSI(hist, 14);
    const bb = calcBB(hist, 20, 2);
    const bb25 = calcBB(hist, 20, 2.5);
    const a = calcATR(hist, 14);
    const trailPct = Math.max(0.015, Math.min(0.04, (a / price) * 2));

    if (holdings === 0 && cooldown === 0) {
      let reason = "";

      // BB 하단 매수 (MEAN_REVERSION 스타일)
      // 1) BB(2.5σ) 하단 + RSI < 35 (강한 신호)
      if (price < bb25.l && r < 35) {
        reason = `BB(2.5σ)하단+트레일 (RSI ${r.toFixed(0)})`;
      }
      // 2) BB(2σ) 하단 + RSI < 38
      else if (price < bb.l && r < 38) {
        reason = `BB(2σ)하단+트레일 (RSI ${r.toFixed(0)})`;
      }

      if (reason && cash > 100) {
        const amount = Math.min(cash * sizePct, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        highSince = price;
        partialSold = false;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason,
        });
      }
    } else if (holdings > 0) {
      highSince = Math.max(highSince, high, price);
      const pnlPct = (price - avgEntry) / avgEntry;
      const dropFromHigh =
        highSince > avgEntry ? (highSince - price) / highSince : 0;

      // BB 중간선 도달 시 부분 매도 (MR 스타일 수익 확보)
      if (!partialSold && price >= bb.m && pnlPct > 0.003) {
        const qty = holdings * 0.5;
        cash += qty * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +((price - avgEntry) * qty).toFixed(2),
          reason: `BB중간선 부분매도 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings -= qty;
        partialSold = true;
      }
      // 트레일링 스탑: +1.5% 이상이면 가동
      else if (pnlPct >= 0.015 && dropFromHigh >= trailPct) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `트레일링 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // BB 상단 도달 시 전량 매도
      else if (price >= bb.u && pnlPct > 0) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `BB상단 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 목표 익절: +3.5%
      else if (pnlPct >= 0.035) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 손절: -2%
      else if (pnlPct <= -0.02) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
        cooldown = 2;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 6. MARTINGALE v2 - 보수적 마틴게일 + 비대칭 R/R
function backtestMartingale(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const baseSize = Number(
    params.positionSize || params.investmentAmount || 200,
  );
  const maxMult = Number(params.maxMultiplier || 3); // x3 캡 (x8에서 축소)
  const tp = 0.03; // +3% 익절
  const sl = 0.015; // -1.5% 손절 (비대칭 2:1)

  let cash = capital,
    holdings = 0,
    avgEntry = 0,
    mult = 1,
    consecutiveLoss = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    const r = hist.length > 14 ? calcRSI(hist, 14) : 50;
    const trend = getTrend(hist);

    if (holdings === 0) {
      // 진입: RSI < 32 (강한 과매도)에서만
      // 강한 하락추세에서는 RSI < 25까지 기다림
      const entryRsi = trend <= -0.5 ? 25 : 32;

      if (r < entryRsi) {
        const size = Math.min(baseSize * mult, cash * 0.35);
        if (size >= 30 && cash >= size) {
          const qty = size / price;
          cash -= size;
          holdings = qty;
          avgEntry = price;
          trades.push({
            date,
            side: "BUY",
            price,
            quantity: qty,
            pnl: 0,
            reason: `마틴게일 매수 (x${mult}, RSI ${r.toFixed(0)}, $${size.toFixed(0)})`,
          });
        }
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;
      if (pnlPct >= tp) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +pnl.toFixed(2),
          reason: `익절 (+${(pnlPct * 100).toFixed(1)}%) → x1 리셋`,
        });
        holdings = 0;
        mult = 1;
        consecutiveLoss = 0;
      } else if (pnlPct <= -sl) {
        const pnl = (price - avgEntry) * holdings;
        cash += holdings * price;
        consecutiveLoss++;
        // 3연패 이상이면 배율 리셋 (무한 손실 방지)
        if (consecutiveLoss >= 3) {
          mult = 1;
          consecutiveLoss = 0;
          trades.push({
            date,
            side: "SELL",
            price,
            quantity: holdings,
            pnl: +pnl.toFixed(2),
            reason: `손절 + 3연패 리셋 (${(pnlPct * 100).toFixed(1)}%) → x1`,
          });
        } else {
          mult = Math.min(mult * 1.5, maxMult);
          trades.push({
            date,
            side: "SELL",
            price,
            quantity: holdings,
            pnl: +pnl.toFixed(2),
            reason: `손절 (${(pnlPct * 100).toFixed(1)}%) → x${mult.toFixed(1)}`,
          });
        }
        holdings = 0;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 7. SCALPING v2 - 고빈도 스캘핑 (일중 시뮬레이션)
function backtestScalping(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.2;
  const tp = 0.01; // +1.0% 익절
  const sl = 0.012; // -1.2% 손절 (거의 대칭, 높은 승률로 커버)

  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price, high, low } of prices) {
    hist.push(price);
    if (hist.length < 10) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    // 일중 가격 시뮬레이션 (low → mid_low → mid_high → high → close)
    const intraday = [low, (low + price) / 2, (high + price) / 2, high, price];

    for (const p of intraday) {
      const bb10 = calcBB(hist, Math.min(10, hist.length), 1.5);
      const r7 = calcRSI(hist, Math.min(7, hist.length - 1));

      if (holdings === 0) {
        // 매수 시그널 1: BB 하단 + RSI < 35
        if (p < bb10.l && r7 < 35 && cash > 100) {
          const amount = Math.min(cash * sizePct, cash - 100);
          const qty = amount / p;
          cash -= amount;
          holdings = qty;
          avgEntry = p;
          trades.push({
            date,
            side: "BUY",
            price: p,
            quantity: qty,
            pnl: 0,
            reason: `스캘핑 BB하단 (RSI7 ${r7.toFixed(0)})`,
          });
        }
        // 매수 시그널 2: 급락 반등 (저가가 평균 대비 -2% 이상)
        else if (p <= low * 1.002 && r7 < 30 && cash > 100) {
          const amount = Math.min(cash * sizePct * 0.8, cash - 100);
          const qty = amount / p;
          cash -= amount;
          holdings = qty;
          avgEntry = p;
          trades.push({
            date,
            side: "BUY",
            price: p,
            quantity: qty,
            pnl: 0,
            reason: `스캘핑 급락반등 (RSI7 ${r7.toFixed(0)})`,
          });
        }
      } else {
        const pnlPct = (p - avgEntry) / avgEntry;
        if (pnlPct >= tp) {
          const pnl = (p - avgEntry) * holdings;
          cash += holdings * p;
          trades.push({
            date,
            side: "SELL",
            price: p,
            quantity: holdings,
            pnl: +pnl.toFixed(2),
            reason: `스캘핑 익절 (+${(pnlPct * 100).toFixed(2)}%)`,
          });
          holdings = 0;
        } else if (pnlPct <= -sl) {
          const pnl = (p - avgEntry) * holdings;
          cash += holdings * p;
          trades.push({
            date,
            side: "SELL",
            price: p,
            quantity: holdings,
            pnl: +pnl.toFixed(2),
            reason: `스캘핑 손절 (${(pnlPct * 100).toFixed(2)}%)`,
          });
          holdings = 0;
        } else if (r7 > 72) {
          const pnl = (p - avgEntry) * holdings;
          cash += holdings * p;
          trades.push({
            date,
            side: "SELL",
            price: p,
            quantity: holdings,
            pnl: +pnl.toFixed(2),
            reason: `스캘핑 RSI매도 (${r7.toFixed(0)})`,
          });
          holdings = 0;
        }
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 8. STAT_ARB v2 - Z-Score 평균회귀 + RSI 이중 필터
function backtestStatArb(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.3;
  const entryZ = Number(params.entryZScore || -1.8);
  const exitZ = 0; // 평균으로 회귀하면 청산
  const tp = 0.035; // +3.5%
  const sl = 0.02; // -2% (비대칭 1.75:1)

  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    if (hist.length < 20) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const z = calcZScore(hist, 20);
    const r = calcRSI(hist, 14);

    if (holdings === 0) {
      // 진입: Z-Score 크게 하락 + RSI 과매도 확인
      if (z < entryZ && r < 42 && cash > 100) {
        // Z-Score가 더 낮을수록 더 많이 매수
        const sizeAdj = z < -2.5 ? 1.3 : 1.0;
        const amount = Math.min(cash * sizePct * sizeAdj, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `Z-Score 매수 (Z=${z.toFixed(2)}, RSI ${r.toFixed(0)})`,
        });
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;

      // 평균 회귀: Z >= 0
      if (z >= exitZ && pnlPct > 0) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `Z 회귀 (Z=${z.toFixed(2)}, +${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 익절
      else if (pnlPct >= tp) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `목표 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // RSI 과매수: 부분 익절
      else if (r > 65 && pnlPct > 0.005) {
        const qty = holdings * 0.5;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +((price - avgEntry) * qty).toFixed(2),
          reason: `RSI 과매수 부분익절 (${r.toFixed(0)})`,
        });
      }
      // 손절
      else if (pnlPct <= -sl) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 9. FUNDING_ARB v2 - 펀딩비 차익거래 + 모멘텀 필터
function backtestFundingArb(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const sizePct = 0.3;
  const tp = 0.03; // +3%
  const sl = 0.02; // -2%
  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    const { date, price } = prices[i];
    hist.push(price);

    // 시뮬레이션된 펀딩비 (5일 모멘텀 기반, 8시간마다 지불)
    let funding = 0;
    if (hist.length > 5) {
      const change5d = (price - hist[hist.length - 6]) / hist[hist.length - 6];
      funding =
        change5d > 0.08
          ? 0.04
          : change5d > 0.04
            ? 0.02
            : change5d > 0.01
              ? 0.005
              : change5d < -0.08
                ? -0.04
                : change5d < -0.04
                  ? -0.02
                  : change5d < -0.01
                    ? -0.005
                    : 0;
    }
    const r = hist.length > 14 ? calcRSI(hist, 14) : 50;

    if (holdings === 0) {
      // 진입 1: 펀딩비 강한 음수 (숏이 롱에게 지불) → 롱
      if (funding < -0.01 && r < 50 && cash > 100) {
        const amount = Math.min(cash * sizePct, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `펀딩차익 롱 (펀딩 ${(funding * 100).toFixed(2)}%, RSI ${r.toFixed(0)})`,
        });
      }
      // 진입 2: 급락 후 과매도 → 펀딩비 음전환 기대
      else if (r < 30 && cash > 100) {
        const amount = Math.min(cash * sizePct * 0.8, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `펀딩차익 과매도 매수 (RSI ${r.toFixed(0)})`,
        });
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;
      // 펀딩비 양전환: 청산
      if (funding > 0.025) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `펀딩 양전환 청산 (${(funding * 100).toFixed(2)}%)`,
        });
        holdings = 0;
      }
      // 익절
      else if (pnlPct >= tp) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // RSI 과매수 부분 익절
      else if (r > 65 && pnlPct > 0.005) {
        const qty = holdings * 0.5;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +((price - avgEntry) * qty).toFixed(2),
          reason: `RSI과매수 부분익절 (${r.toFixed(0)})`,
        });
      }
      // 손절
      else if (pnlPct <= -sl) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 10. RL_AGENT v2 - 가중 앙상블 AI + 동적 포지션 사이징
function backtestRLAgent(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  let cash = capital,
    holdings = 0,
    avgEntry = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    if (hist.length < 26) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const r = calcRSI(hist, 14);
    const m = calcMACD(hist);
    const e9 = calcEMA(hist, 9),
      e21 = calcEMA(hist, 21);
    const b = calcBB(hist, 20, 2);
    const z = calcZScore(hist, 20);
    const trend = getTrend(hist);

    // 가중 점수 계산 (-10 ~ +10)
    let score = 0;
    // RSI (가중치 2): 가장 신뢰성 높은 단일 지표
    if (r < 30) score += 2;
    else if (r < 40) score += 1;
    else if (r > 70) score -= 2;
    else if (r > 60) score -= 1;
    // BB 위치 (가중치 2): 평균회귀
    if (price < b.l) score += 2;
    else if (price > b.u) score -= 2;
    // Z-Score (가중치 1.5)
    if (z < -2) score += 1.5;
    else if (z < -1.5) score += 1;
    else if (z > 2) score -= 1.5;
    else if (z > 1.5) score -= 1;
    // EMA 크로스 (가중치 1)
    if (e9 > e21) score += 1;
    else score -= 1;
    // MACD (가중치 1)
    if (m.hist > 0) score += 1;
    else if (m.hist < 0) score -= 1;
    // 추세 보정 (가중치 0.5)
    score += trend * 0.5;

    if (holdings === 0) {
      // 진입: 점수 3 이상 (높은 확신)
      if (score >= 3 && cash > 100) {
        // 동적 포지션 사이징: 점수에 비례
        const sizePct = Math.min(0.15 + (score - 3) * 0.05, 0.4);
        const amount = Math.min(cash * sizePct, cash - 100);
        const qty = amount / price;
        cash -= amount;
        holdings = qty;
        avgEntry = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `AI 매수 (점수 ${score.toFixed(1)}, RSI ${r.toFixed(0)}, ${(sizePct * 100).toFixed(0)}%)`,
        });
      }
    } else {
      const pnlPct = (price - avgEntry) / avgEntry;

      // 강한 매도 시그널
      if (score <= -3) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `AI 강한 매도 (점수 ${score.toFixed(1)})`,
        });
        holdings = 0;
      }
      // 익절: +5%
      else if (pnlPct >= 0.05) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `AI 익절 (+${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 손절: -2.5%
      else if (pnlPct <= -0.025) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `AI 손절 (${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
      // 부분 매도: 약한 매도 시그널 + 수익 중
      else if (score <= -1 && pnlPct > 0.01) {
        const qty = holdings * 0.5;
        cash += qty * price;
        holdings -= qty;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: qty,
          pnl: +((price - avgEntry) * qty).toFixed(2),
          reason: `AI 부분매도 (점수 ${score.toFixed(1)}, +${(pnlPct * 100).toFixed(1)}%)`,
        });
      }
      // RSI 기반 익절
      else if (r > 68 && pnlPct > 0.005) {
        cash += holdings * price;
        trades.push({
          date,
          side: "SELL",
          price,
          quantity: holdings,
          pnl: +((price - avgEntry) * holdings).toFixed(2),
          reason: `AI RSI매도 (${r.toFixed(0)}, +${(pnlPct * 100).toFixed(1)}%)`,
        });
        holdings = 0;
      }
    }
    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// 11. ENSEMBLE - 지표 기반 일별 투표 앙상블 (다중 전략 결합)
function backtestEnsemble(
  prices: DailyPrice[],
  capital: number,
  params: Record<string, unknown>,
): BacktestResult {
  const strategiesParam = (params.strategies as string[]) || [
    "DCA",
    "MOMENTUM",
    "STAT_ARB",
  ];
  const weightsParam = (params.weights as Record<string, number>) || {};

  const VALID = [
    "DCA",
    "GRID",
    "MOMENTUM",
    "MEAN_REVERSION",
    "TRAILING",
    "MARTINGALE",
    "SCALPING",
    "STAT_ARB",
    "FUNDING_ARB",
    "RL_AGENT",
  ];
  const activeStrategies = strategiesParam.filter((s) => VALID.includes(s));
  if (activeStrategies.length === 0)
    activeStrategies.push("DCA", "MOMENTUM", "STAT_ARB");

  // 지표 기반 시그널 함수: 매일 RSI/MACD/BB/EMA/trend 기반으로 BUY/SELL/HOLD 판단
  type Signal = "BUY" | "SELL" | "HOLD";
  type SignalFn = (ind: {
    rsi: number;
    rsi7: number;
    macd: { line: number; signal: number; hist: number };
    bb: { u: number; m: number; l: number; width: number };
    ema9: number;
    ema21: number;
    atr: number;
    zScore: number;
    trend: number;
    price: number;
    prevPrice: number;
    peak: number;
    hasPosition: boolean;
    pnlPct: number;
  }) => Signal;

  // 모든 전략 공통: 하락장 보호 로직
  // 포지션 보유 시 손절/추세전환 매도를 모든 전략에서 일관되게 적용
  const commonSell = (ind: Parameters<SignalFn>[0]): Signal | null => {
    if (!ind.hasPosition) return null;
    // 공통 손절: -5% 이하 → 강제 매도 (모든 전략 동의)
    if (ind.pnlPct <= -0.05) return "SELL";
    // 추세 하락 + 손실: 빠른 탈출
    if (ind.pnlPct <= -0.02 && ind.trend <= -0.5) return "SELL";
    // MACD 데드크로스 + EMA 역배열 + 손실: 추세 전환 매도
    if (ind.ema9 < ind.ema21 && ind.macd.hist < 0 && ind.pnlPct < -0.01)
      return "SELL";
    return null;
  };

  const signalFns: Record<string, SignalFn> = {
    DCA: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.rsi > 70 && ind.pnlPct > 0.01) return "SELL";
      if (ind.hasPosition && ind.pnlPct >= 0.05) return "SELL";
      // DCA는 꾸준히 매수 - 추세 무관 (적립식 본질)
      if (ind.rsi < 50) return "BUY";
      return "HOLD";
    },
    GRID: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.price > ind.bb.u * 0.98 && ind.pnlPct > 0)
        return "SELL";
      if (ind.hasPosition && ind.rsi > 65) return "SELL";
      // 그리드: BB 중간 이하에서 매수 (추세 무관, 레인지 전략)
      if (ind.price < ind.bb.m && ind.rsi < 50) return "BUY";
      return "HOLD";
    },
    MOMENTUM: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.ema9 < ind.ema21 && ind.macd.hist < 0)
        return "SELL";
      if (ind.hasPosition && ind.pnlPct >= 0.06) return "SELL";
      // 모멘텀: 단기 반등 신호에도 반응 (EMA 골든크로스 or MACD 반전)
      if (ind.macd.hist > 0 && ind.ema9 > ind.ema21 && ind.rsi < 60)
        return "BUY";
      if (ind.ema9 > ind.ema21 && ind.rsi < 55) return "BUY";
      return "HOLD";
    },
    MEAN_REVERSION: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && (ind.rsi > 62 || ind.zScore > 0.8)) return "SELL";
      if (ind.hasPosition && ind.pnlPct >= 0.04) return "SELL";
      // 과매도 매수 - 하락장에서 가장 유효한 전략
      if (ind.rsi < 30) return "BUY"; // 극단적 과매도 → 무조건 매수
      if (ind.rsi < 40 && ind.zScore < -0.5) return "BUY";
      if (ind.price < ind.bb.l * 1.02 && ind.rsi < 42) return "BUY";
      return "HOLD";
    },
    TRAILING: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.price < ind.peak - ind.atr * 1.5)
        return "SELL";
      if (ind.hasPosition && ind.pnlPct >= 0.05) return "SELL";
      // 트레일링: 단기 반등 시 진입 (EMA 골든크로스 or MACD 양전환)
      if (ind.macd.hist > 0 && ind.ema9 > ind.ema21 && ind.rsi < 55)
        return "BUY";
      if (ind.ema9 > ind.ema21 && ind.rsi < 48) return "BUY";
      return "HOLD";
    },
    MARTINGALE: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.pnlPct > 0.025) return "SELL";
      if (ind.hasPosition && ind.rsi > 65) return "SELL";
      // 마틴게일: 과매도에서 매수 (추세 무관)
      if (ind.rsi < 35) return "BUY";
      if (ind.rsi < 42 && ind.price < ind.bb.l * 1.02) return "BUY";
      return "HOLD";
    },
    SCALPING: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && (ind.rsi > 60 || ind.pnlPct > 0.02)) return "SELL";
      // 스캘핑: 단기 과매도에서 빠르게 진입 (추세 무관)
      if (ind.rsi < 40 && ind.price < ind.bb.m) return "BUY";
      if (ind.rsi7 < 25) return "BUY"; // 7일 RSI 극단적 과매도
      return "HOLD";
    },
    STAT_ARB: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.zScore > 0.5) return "SELL";
      if (ind.hasPosition && ind.pnlPct >= 0.03) return "SELL";
      // 통계적 차익: Z-Score 기반 (추세 무관)
      if (ind.zScore < -1.2 && ind.rsi < 48) return "BUY";
      if (ind.zScore < -0.8 && ind.rsi < 40) return "BUY";
      return "HOLD";
    },
    FUNDING_ARB: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      if (ind.hasPosition && ind.pnlPct > 0.015) return "SELL";
      if (ind.hasPosition && ind.rsi > 65) return "SELL";
      // 펀딩비 차익: 과매도 시 매수 (추세 무관)
      if (ind.rsi < 45 && ind.zScore < -0.3) return "BUY";
      return "HOLD";
    },
    RL_AGENT: (ind) => {
      const cs = commonSell(ind);
      if (cs) return cs;
      let score = 0;
      if (ind.rsi < 35) score += 2;
      else if (ind.rsi < 45) score += 1;
      if (ind.rsi > 65) score -= 2;
      else if (ind.rsi > 55) score -= 1;
      if (ind.macd.hist > 0) score += 1;
      else score -= 1;
      if (ind.zScore < -0.8) score += 1;
      else if (ind.zScore > 1) score -= 1;
      if (ind.price < ind.bb.m) score += 1;
      else score -= 1;
      if (ind.price < ind.bb.l * 1.02) score += 1; // BB 하단 보너스
      if (ind.hasPosition && score <= -2) return "SELL";
      if (ind.hasPosition && ind.pnlPct > 0.03) return "SELL";
      if (score >= 2) return "BUY"; // 임계값 3→2로 완화
      if (ind.hasPosition && score <= -1 && ind.pnlPct < -0.02) return "SELL";
      return "HOLD";
    },
  };

  // 투표 임계값 (비율 0~1). 프론트엔드가 구형 1.5/-1.5 형식을 보내면 변환
  let buyThreshold = Number(params.buyThreshold ?? 0.3);
  let sellThreshold = Math.abs(Number(params.sellThreshold ?? -0.3));
  if (buyThreshold > 1.0)
    buyThreshold = buyThreshold / (activeStrategies.length + 1);
  if (sellThreshold > 1.0)
    sellThreshold = sellThreshold / (activeStrategies.length + 1);
  buyThreshold = Math.max(0.15, Math.min(buyThreshold, 0.7));
  sellThreshold = Math.max(0.15, Math.min(sellThreshold, 0.7));

  let cash = capital,
    holdings = 0,
    avgEntry = 0,
    peak = 0;
  const trades: BacktestTrade[] = [],
    curve: { date: string; value: number }[] = [];
  const hist: number[] = [];

  for (const { date, price } of prices) {
    hist.push(price);
    if (price > peak) peak = price;

    // 최소 26일 데이터 필요 (MACD용)
    if (hist.length < 26) {
      curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
      continue;
    }

    const rsi = calcRSI(hist, 14);
    const rsi7 = calcRSI(hist, 7);
    const macd = calcMACD(hist);
    const bb = calcBB(hist, 20, 2);
    const ema9 = calcEMA(hist, 9);
    const ema21 = calcEMA(hist, 21);
    const atr = calcATR(hist, 14);
    const zScore = calcZScore(hist, 20);
    const trend = getTrend(hist);
    const prevPrice = hist.length > 1 ? hist[hist.length - 2] : price;
    const hasPosition = holdings > 0;
    const pnlPct =
      hasPosition && avgEntry > 0 ? (price - avgEntry) / avgEntry : 0;

    const ind = {
      rsi,
      rsi7,
      macd,
      bb,
      ema9,
      ema21,
      atr,
      zScore,
      trend,
      price,
      prevPrice,
      peak,
      hasPosition,
      pnlPct,
    };

    // 각 전략 투표
    let buyWeight = 0,
      sellWeight = 0,
      totalWeight = 0;
    const buyVoters: string[] = [],
      sellVoters: string[] = [];

    for (const name of activeStrategies) {
      const fn = signalFns[name];
      if (!fn) continue;
      const w = weightsParam[name] ?? 1.0;
      totalWeight += w;
      const sig = fn(ind);
      if (sig === "BUY") {
        buyWeight += w;
        buyVoters.push(name);
      } else if (sig === "SELL") {
        sellWeight += w;
        sellVoters.push(name);
      }
    }

    const buyRatio = totalWeight > 0 ? buyWeight / totalWeight : 0;
    const sellRatio = totalWeight > 0 ? sellWeight / totalWeight : 0;

    // SELL 우선 (리스크 관리)
    if (sellRatio >= sellThreshold && holdings > 0) {
      const pnl = (price - avgEntry) * holdings;
      cash += holdings * price;
      trades.push({
        date,
        side: "SELL",
        price,
        quantity: holdings,
        pnl: +pnl.toFixed(2),
        reason: `앙상블 매도 (${sellVoters.join("+")} ${(sellRatio * 100).toFixed(0)}%)`,
      });
      holdings = 0;
      avgEntry = 0;
      peak = 0;
    }
    // BUY
    else if (buyRatio >= buyThreshold && cash > 100 && !holdings) {
      // 포지션 크기: 자본의 15~25% (개별 전략과 동일 수준)
      const sizePct = 0.15 + buyRatio * 0.1;
      const amount = Math.min(cash * sizePct, cash - 100);
      if (amount > 50) {
        const qty = amount / price;
        avgEntry = price;
        cash -= amount;
        holdings = qty;
        peak = price;
        trades.push({
          date,
          side: "BUY",
          price,
          quantity: qty,
          pnl: 0,
          reason: `앙상블 매수 (${buyVoters.join("+")} ${(buyRatio * 100).toFixed(0)}%)`,
        });
      }
    }
    // 추가 매수 (기존 포지션에 DCA처럼, 최대 노출 30%)
    else if (
      buyRatio >= buyThreshold &&
      cash > 500 &&
      holdings > 0 &&
      pnlPct < -0.03
    ) {
      const exposure = holdings * price;
      if (exposure < capital * 0.3) {
        const amount = Math.min(cash * 0.08, cash - 100);
        if (amount > 50) {
          const qty = amount / price;
          avgEntry = (avgEntry * holdings + price * qty) / (holdings + qty);
          cash -= amount;
          holdings += qty;
          trades.push({
            date,
            side: "BUY",
            price,
            quantity: qty,
            pnl: 0,
            reason: `앙상블 물타기 (${buyVoters.join("+")} ${(buyRatio * 100).toFixed(0)}%, ${(pnlPct * 100).toFixed(1)}%)`,
          });
        }
      }
    }

    curve.push({ date, value: +(cash + holdings * price).toFixed(2) });
  }

  // 종료 시 잔여 포지션 청산
  if (holdings > 0) {
    const last = prices[prices.length - 1];
    trades.push({
      date: last.date,
      side: "SELL",
      price: last.price,
      quantity: holdings,
      pnl: +((last.price - avgEntry) * holdings).toFixed(2),
      reason: "종료",
    });
  }
  return buildResult(trades, curve, capital, prices);
}

// ============ Routes ============

backtestRoutes.post("/run", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const symbol = (body.symbol as string) || "BTCUSDT";
  const strategy = (body.strategy as string) || "MOMENTUM";
  const startDate = (body.startDate as string) || "2024-10-01";
  const endDate = (body.endDate as string) || "2025-01-20";
  const initialCapital = (body.initialCapital as number) || 10000;
  const params = (body.params as Record<string, unknown>) || {};

  try {
    const prices = await fetchHistoricalPrices(symbol, startDate, endDate);
    let result: BacktestResult;

    switch (strategy) {
      case "DCA":
        result = backtestDCA(prices, initialCapital, params);
        break;
      case "GRID":
        result = backtestGrid(prices, initialCapital, params);
        break;
      case "MOMENTUM":
        result = backtestMomentum(prices, initialCapital, params);
        break;
      case "MEAN_REVERSION":
        result = backtestMeanReversion(prices, initialCapital, params);
        break;
      case "TRAILING":
        result = backtestTrailing(prices, initialCapital, params);
        break;
      case "MARTINGALE":
        result = backtestMartingale(prices, initialCapital, params);
        break;
      case "SCALPING":
        result = backtestScalping(prices, initialCapital, params);
        break;
      case "STAT_ARB":
        result = backtestStatArb(prices, initialCapital, params);
        break;
      case "FUNDING_ARB":
        result = backtestFundingArb(prices, initialCapital, params);
        break;
      case "RL_AGENT":
        result = backtestRLAgent(prices, initialCapital, params);
        break;
      case "ENSEMBLE":
        result = backtestEnsemble(prices, initialCapital, params);
        break;
      default:
        result = backtestMomentum(prices, initialCapital, params);
    }

    const id = generateId();
    await c.env.DB.prepare(
      "INSERT INTO backtest_results (id, user_id, strategy, symbol, config, result) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        userId,
        strategy,
        symbol,
        JSON.stringify({ startDate, endDate, initialCapital, params }),
        JSON.stringify(result),
      )
      .run();

    return c.json({ data: result });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "백테스트 오류" },
      500,
    );
  }
});

backtestRoutes.get("/results", async (c) => {
  const userId = c.get("userId");
  const limit = parseInt(c.req.query("limit") || "20");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM backtest_results WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(userId, limit)
    .all();

  const backtests = (results || []).map((row) => {
    const r = row as Record<string, unknown>;
    let result = {},
      config = {};
    try {
      result = JSON.parse(r.result as string);
    } catch {
      /**/
    }
    try {
      config = JSON.parse(r.config as string);
    } catch {
      /**/
    }
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
