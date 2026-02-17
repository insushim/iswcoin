"use client";

import { useState, useEffect, useCallback } from "react";
import { PriceChart } from "@/components/charts/price-chart";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { useMarketStore } from "@/stores/market.store";
import { Timeframe } from "@cryptosentinel/shared";
import type { Time } from "lightweight-charts";
import api, { endpoints } from "@/lib/api";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Gauge,
} from "lucide-react";

const SYMBOL_OPTIONS = [
  { label: "BTC/USDT", value: "BTCUSDT" },
  { label: "ETH/USDT", value: "ETHUSDT" },
  { label: "SOL/USDT", value: "SOLUSDT" },
  { label: "BNB/USDT", value: "BNBUSDT" },
  { label: "XRP/USDT", value: "XRPUSDT" },
];

const TIMEFRAME_OPTIONS = Object.values(Timeframe).map((t) => ({
  label: t,
  value: t,
}));

export default function MarketPage() {
  const { selectedSymbol, setSelectedSymbol, indicators, sentiment, fetchIndicators, fetchSentiment } = useMarketStore();
  const [timeframe, setTimeframe] = useState(Timeframe.D1);
  const [isDemo, setIsDemo] = useState(false);
  const [chartData, setChartData] = useState<Array<{ time: Time; open: number; high: number; low: number; close: number; volume: number }>>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const fetchOHLCV = useCallback(async (symbol: string) => {
    setChartLoading(true);
    try {
      const res = await api.get(endpoints.market.ohlcv(symbol), { params: { days: 90 } });
      const raw = res.data.data ?? res.data;
      if (Array.isArray(raw) && raw.length > 0) {
        const formatted = raw.map((candle: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }) => ({
          time: Math.floor(candle.timestamp / 1000) as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0,
        }));
        setChartData(formatted);
        setIsDemo(false);
      } else {
        setChartData([]);
        setIsDemo(true);
      }
    } catch {
      setChartData([]);
      setIsDemo(true);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOHLCV(selectedSymbol);
    fetchIndicators(selectedSymbol).catch(() => {});
    fetchSentiment().catch(() => {});
  }, [selectedSymbol, fetchOHLCV, fetchIndicators, fetchSentiment]);

  // API 데이터 또는 빈 폴백 (가짜 수치 제거)
  const demoIndicators = indicators || {
    rsi: 0,
    macd: { line: 0, signal: 0, histogram: 0 },
    bollingerBands: { upper: 0, middle: 0, lower: 0 },
    ema20: 0,
    ema50: 0,
    ema200: 0,
    atr: 0,
    volume24h: 0,
    volumeChange: 0,
  };

  const demoSentiment = sentiment || {
    fearGreedIndex: 0,
    fearGreedLabel: "데이터 없음",
    socialScore: 0,
    newsScore: 0,
    whaleActivity: "데이터 없음",
    timestamp: Date.now(),
  };

  const sentimentColor = demoSentiment.fearGreedIndex >= 60
    ? "text-emerald-400"
    : demoSentiment.fearGreedIndex >= 40
    ? "text-amber-400"
    : "text-red-400";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-48">
          <Select
            options={SYMBOL_OPTIONS}
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
          />
        </div>
        <div className="w-32">
          <Select
            options={TIMEFRAME_OPTIONS}
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          />
        </div>
      </div>

      {isDemo && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
          서버에 연결되지 않아 차트 데이터를 불러올 수 없습니다.
        </div>
      )}

      {/* Price Chart */}
      <Card padding="sm">
        <CardHeader>
          {selectedSymbol.replace("USDT", "/USDT")} - {timeframe}
        </CardHeader>
        {chartLoading ? (
          <div className="flex h-[500px] items-center justify-center text-slate-400">
            차트 데이터 로딩 중...
          </div>
        ) : chartData.length > 0 ? (
          <PriceChart data={chartData} height={500} />
        ) : (
          <div className="flex h-[500px] items-center justify-center text-slate-500">
            차트 데이터를 불러올 수 없습니다
          </div>
        )}
      </Card>

      {/* Indicators + Sentiment */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Technical Indicators */}
        <Card className="lg:col-span-2">
          <CardHeader>기술적 지표</CardHeader>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">RSI (14)</p>
              <p className={cn(
                "text-lg font-bold",
                demoIndicators.rsi > 70 ? "text-red-400" :
                demoIndicators.rsi < 30 ? "text-emerald-400" : "text-white"
              )}>
                {demoIndicators.rsi.toFixed(1)}
              </p>
              <p className="text-xs text-slate-500">
                {demoIndicators.rsi > 70 ? "과매수" :
                 demoIndicators.rsi < 30 ? "과매도" : "중립"}
              </p>
            </div>

            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">MACD</p>
              <p className={cn(
                "text-lg font-bold",
                demoIndicators.macd.histogram > 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {demoIndicators.macd.histogram.toFixed(1)}
              </p>
              <p className="text-xs text-slate-500">
                시그널: {demoIndicators.macd.signal.toFixed(1)}
              </p>
            </div>

            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">ATR</p>
              <p className="text-lg font-bold text-white">
                {formatCurrency(demoIndicators.atr)}
              </p>
              <p className="text-xs text-slate-500">변동성 지표</p>
            </div>

            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">볼린저 밴드</p>
              <div className="space-y-0.5">
                <p className="text-xs text-red-400">상단: {formatCurrency(demoIndicators.bollingerBands.upper)}</p>
                <p className="text-xs text-white">중단: {formatCurrency(demoIndicators.bollingerBands.middle)}</p>
                <p className="text-xs text-emerald-400">하단: {formatCurrency(demoIndicators.bollingerBands.lower)}</p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">EMA</p>
              <div className="space-y-0.5">
                <p className="text-xs text-blue-400">20: {formatCurrency(demoIndicators.ema20)}</p>
                <p className="text-xs text-amber-400">50: {formatCurrency(demoIndicators.ema50)}</p>
                <p className="text-xs text-purple-400">200: {formatCurrency(demoIndicators.ema200)}</p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/30 p-3">
              <p className="text-xs text-slate-400 mb-1">24시간 거래량</p>
              <p className="text-lg font-bold text-white">
                {formatNumber(demoIndicators.volume24h)}
              </p>
              <p className={cn(
                "text-xs",
                demoIndicators.volumeChange >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {formatPercent(demoIndicators.volumeChange)}
              </p>
            </div>
          </div>
        </Card>

        {/* Sentiment Gauge */}
        <Card>
          <CardHeader>시장 심리</CardHeader>
          <div className="space-y-6">
            {/* Fear & Greed */}
            <div className="text-center">
              <div className="relative mx-auto h-32 w-32">
                <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgb(51,65,85)" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={demoSentiment.fearGreedIndex >= 60 ? "#10b981" : demoSentiment.fearGreedIndex >= 40 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="10"
                    strokeDasharray={`${(demoSentiment.fearGreedIndex / 100) * 314} 314`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn("text-2xl font-bold", sentimentColor)}>
                    {demoSentiment.fearGreedIndex}
                  </span>
                  <span className="text-xs text-slate-400">{demoSentiment.fearGreedLabel}</span>
                </div>
              </div>
            </div>

            {/* Scores */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">소셜 점수</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full bg-slate-700">
                    <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${demoSentiment.socialScore}%` }} />
                  </div>
                  <span className="text-sm font-medium text-white">{demoSentiment.socialScore}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">뉴스 점수</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full bg-slate-700">
                    <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${demoSentiment.newsScore}%` }} />
                  </div>
                  <span className="text-sm font-medium text-white">{demoSentiment.newsScore}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">고래 활동</span>
                <Badge variant="success" dot>{demoSentiment.whaleActivity}</Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
