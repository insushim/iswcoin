"use client";

import { useMemo } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { Ticker } from "@cryptosentinel/shared";

interface MarketOverviewProps {
  tickers: Ticker[];
}

const COIN_COLORS: Record<string, string> = {
  BTCUSDT: "text-crypto-btc",
  ETHUSDT: "text-crypto-eth",
  BNBUSDT: "text-crypto-bnb",
  SOLUSDT: "text-crypto-sol",
  XRPUSDT: "text-crypto-xrp",
};

const COIN_NAMES: Record<string, string> = {
  BTCUSDT: "비트코인",
  ETHUSDT: "이더리움",
  BNBUSDT: "BNB",
  SOLUSDT: "솔라나",
  XRPUSDT: "XRP",
  ADAUSDT: "카르다노",
  DOTUSDT: "폴카닷",
  AVAXUSDT: "아발란체",
};

export function MarketOverview({ tickers }: MarketOverviewProps) {
  // 24h 변화율 기반 결정론적 미니 바 생성 (랜덤 데이터 제거)
  const sparklineData = useMemo(() => {
    const data = new Map<string, number[]>();
    for (const t of tickers) {
      if (!data.has(t.symbol)) {
        // 가격 변화율 기반으로 12개 포인트 생성 (결정론적)
        const change = t.change24h || 0;
        const bars = Array.from({ length: 12 }, (_, i) => {
          // 0→현재 변화율까지 점진적 변화 + 약간의 사인파 변동
          const progress = i / 11;
          const trend = 40 + (change > 0 ? progress * 30 : -progress * 20);
          const wave = Math.sin(i * 0.8) * 10;
          return Math.max(5, Math.min(95, trend + wave));
        });
        data.set(t.symbol, bars);
      }
    }
    return data;
  }, [tickers.map(t => `${t.symbol}:${t.change24h}`).join(',')]);

  return (
    <Card>
      <CardHeader>시장 현황</CardHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tickers.map((ticker) => (
          <div
            key={ticker.symbol}
            className="rounded-lg border border-slate-800/50 bg-slate-800/20 p-3 transition-colors hover:bg-slate-800/40"
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className={cn(
                  "text-xs font-bold",
                  COIN_COLORS[ticker.symbol] || "text-slate-300"
                )}
              >
                {ticker.symbol.replace("USDT", "")}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  ticker.change24h >= 0 ? "text-emerald-400" : "text-red-400"
                )}
              >
                {formatPercent(ticker.change24h)}
              </span>
            </div>
            <p className="text-sm font-semibold text-white">
              {formatCurrency(ticker.price, "USD", ticker.price < 1 ? 4 : 2)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              거래량: {formatNumber(ticker.volume24h)}
            </p>
            {/* Mini sparkline placeholder */}
            <div className="mt-2 flex items-end gap-px h-6">
              {(sparklineData.get(ticker.symbol) ?? []).map((h, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-t-sm min-w-[2px]",
                    ticker.change24h >= 0 ? "bg-emerald-500/40" : "bg-red-500/40"
                  )}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        ))}

        {tickers.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-slate-500">
            시장 데이터를 불러올 수 없습니다
          </div>
        )}
      </div>
    </Card>
  );
}
