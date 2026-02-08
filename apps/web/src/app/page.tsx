"use client";

import { useEffect, useMemo } from "react";
import { StatsGrid } from "@/components/dashboard/stats-grid";
import { ActiveBots } from "@/components/dashboard/active-bots";
import { RecentTrades } from "@/components/dashboard/recent-trades";
import { MarketOverview } from "@/components/dashboard/market-overview";
import { PnLChart } from "@/components/charts/pnl-chart";
import { Card, CardHeader } from "@/components/ui/card";
import { useBotStore } from "@/stores/bot.store";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useMarketStore } from "@/stores/market.store";
import { useAuthStore } from "@/stores/auth.store";
import { BotStatus, OrderSide } from "@cryptosentinel/shared";
import type { Ticker } from "@cryptosentinel/shared";

// Demo data for when API is not available
const DEMO_TICKERS: Ticker[] = [
  { symbol: "BTCUSDT", price: 97523.45, bid: 97520, ask: 97525, volume24h: 28543000000, change24h: 2.34, timestamp: Date.now() },
  { symbol: "ETHUSDT", price: 3245.67, bid: 3245, ask: 3246, volume24h: 15234000000, change24h: -1.23, timestamp: Date.now() },
  { symbol: "BNBUSDT", price: 625.89, bid: 625, ask: 626, volume24h: 1823000000, change24h: 0.87, timestamp: Date.now() },
  { symbol: "SOLUSDT", price: 198.34, bid: 198, ask: 199, volume24h: 4532000000, change24h: 5.67, timestamp: Date.now() },
  { symbol: "XRPUSDT", price: 2.45, bid: 2.44, ask: 2.46, volume24h: 3254000000, change24h: -0.54, timestamp: Date.now() },
  { symbol: "ADAUSDT", price: 0.892, bid: 0.891, ask: 0.893, volume24h: 987000000, change24h: 1.12, timestamp: Date.now() },
  { symbol: "AVAXUSDT", price: 38.56, bid: 38.50, ask: 38.60, volume24h: 654000000, change24h: -2.1, timestamp: Date.now() },
  { symbol: "DOTUSDT", price: 7.89, bid: 7.88, ask: 7.90, volume24h: 432000000, change24h: 0.34, timestamp: Date.now() },
];

const DEMO_TRADES = [
  { id: "1", symbol: "BTCUSDT", side: OrderSide.BUY, price: 97100.00, amount: 0.015, pnl: 42.35, timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: "2", symbol: "ETHUSDT", side: OrderSide.SELL, price: 3260.50, amount: 0.5, pnl: -15.20, timestamp: new Date(Date.now() - 3600000).toISOString() },
  { id: "3", symbol: "SOLUSDT", side: OrderSide.BUY, price: 195.00, amount: 3.2, pnl: 10.69, timestamp: new Date(Date.now() - 7200000).toISOString() },
  { id: "4", symbol: "BTCUSDT", side: OrderSide.SELL, price: 97800.00, amount: 0.01, pnl: 78.00, timestamp: new Date(Date.now() - 14400000).toISOString() },
  { id: "5", symbol: "BNBUSDT", side: OrderSide.BUY, price: 620.00, amount: 1.0, pnl: 5.89, timestamp: new Date(Date.now() - 28800000).toISOString() },
];

const DEMO_PNL = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
  pnl: Math.round((Math.random() * 600 - 200) * 100) / 100,
}));

export default function DashboardPage() {
  const { loadFromStorage } = useAuthStore();
  const { bots, fetchBots } = useBotStore();
  const { summary, fetchPortfolio } = usePortfolioStore();
  const { tickers, fetchTickers } = useMarketStore();

  useEffect(() => {
    loadFromStorage();
    fetchBots().catch(() => {});
    fetchPortfolio().catch(() => {});
    fetchTickers().catch(() => {});
  }, [loadFromStorage, fetchBots, fetchPortfolio, fetchTickers]);

  const activeBotCount = bots.filter((b) => b.status === BotStatus.RUNNING).length;

  const tickerList = useMemo(() => {
    const fromStore = Array.from(tickers.values());
    return fromStore.length > 0 ? fromStore : DEMO_TICKERS;
  }, [tickers]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <StatsGrid
        totalValue={summary?.totalValue ?? 125432.56}
        dailyPnL={summary?.dailyPnL ?? 342.50}
        dailyPnLPercent={summary?.dailyPnLPercent ?? 0.27}
        activeBots={activeBotCount || 3}
        totalBots={bots.length || 5}
        sentimentScore={62}
      />

      {/* Charts + Active bots row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>일일 손익 (30일)</CardHeader>
            <PnLChart data={DEMO_PNL} height={280} />
          </Card>
        </div>
        <div className="lg:col-span-1">
          <ActiveBots bots={bots} />
        </div>
      </div>

      {/* Trades + Market overview row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentTrades trades={DEMO_TRADES} />
        <MarketOverview tickers={tickerList} />
      </div>
    </div>
  );
}
