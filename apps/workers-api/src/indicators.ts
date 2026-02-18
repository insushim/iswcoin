// Technical Indicators - extracted from engine.ts
// Shared by engine.ts and routes/market.ts

export function ema(prices: number[], period: number): number {
  if (!prices.length) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

export function emaSeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [...prices];
  const k = 2 / (period + 1);
  const r = [...prices.slice(0, period - 1)];
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  r.push(e);
  for (let i = period; i < prices.length; i++) { e = prices[i] * k + e * (1 - k); r.push(e); }
  return r;
}

export function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let g = 0, l = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + (g / period) / (l / period));
}

export function macd(prices: number[]): { line: number; signal: number; hist: number } {
  if (prices.length < 26) return { line: 0, signal: 0, hist: 0 };
  const e12 = emaSeries(prices, 12);
  const e26 = emaSeries(prices, 26);
  const macdLine: number[] = [];
  for (let i = 25; i < prices.length; i++) macdLine.push(e12[i] - e26[i]);
  const line = macdLine[macdLine.length - 1] || 0;
  const signal = macdLine.length >= 9 ? ema(macdLine, 9) : line * 0.8;
  return { line, signal, hist: line - signal };
}

export function bb(prices: number[], period: number, mult: number) {
  if (prices.length < period) { const p = prices[prices.length - 1] || 0; return { u: p, m: p, l: p }; }
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return { u: m + mult * std, m, l: m - mult * std };
}

export function atr(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 0;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) sum += Math.abs(prices[i] - prices[i - 1]);
  return sum / period;
}

export function zScore(prices: number[], period: number = 20): number {
  if (prices.length < period) return 0;
  const s = prices.slice(-period);
  const m = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((sum, p) => sum + (p - m) ** 2, 0) / period);
  return std === 0 ? 0 : (prices[prices.length - 1] - m) / std;
}

export function getTrend(prices: number[]): number {
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

export interface Indicators {
  prices: number[]; current: number;
  rsi: number; rsi7: number;
  ema9: number; ema21: number;
  macdLine: number; macdSignal: number; macdHist: number;
  bbUpper: number; bbMid: number; bbLower: number;
  bbUpper10: number; bbLower10: number;
  bbUpper25: number; bbLower25: number;
  atr: number; zScore: number;
  trend: number;
  chg1h: number; chg24h: number;
}

export function calcIndicators(history: number[], current: number): Indicators {
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
