"use client";

import { useEffect, useMemo, useState } from "react";
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
import api, { endpoints } from "@/lib/api";

interface DashboardTrade {
  id: string;
  symbol: string;
  side: OrderSide;
  price: number;
  amount: number;
  pnl: number;
  timestamp: string;
}

export default function DashboardPage() {
  const { loadFromStorage, isAuthenticated } = useAuthStore();
  const { bots, fetchBots } = useBotStore();
  const { summary, history, fetchPortfolio, fetchHistory } = usePortfolioStore();
  const { tickers, fetchTickers } = useMarketStore();
  const [recentTrades, setRecentTrades] = useState<DashboardTrade[]>([]);
  const [sentimentScore, setSentimentScore] = useState(50);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchBots().catch((e) => console.error('Failed to fetch bots:', e));
    fetchPortfolio().catch((e) => console.error('Failed to fetch portfolio:', e));
    fetchHistory(30).catch((e) => console.error('Failed to fetch history:', e));
    fetchTickers().catch((e) => console.error('Failed to fetch tickers:', e));

    // Fetch recent trades
    api.get(endpoints.trades.list, { params: { limit: 10 } })
      .then((res) => {
        const data = res.data.data ?? res.data;
        if (Array.isArray(data)) {
          setRecentTrades(data.map((t: Record<string, unknown>) => ({
            id: t.id as string,
            symbol: t.symbol as string,
            side: t.side as OrderSide,
            price: Number(t.price ?? 0),
            amount: Number(t.amount ?? 0),
            pnl: Number(t.pnl ?? 0),
            timestamp: (t.timestamp as string) || (t.createdAt as string) || new Date().toISOString(),
          })));
        }
      })
      .catch((e) => console.error('Failed to fetch trades:', e));

    // Fetch sentiment
    api.get(endpoints.market.sentiment)
      .then((res) => {
        const data = res.data.data ?? res.data;
        if (data?.fearGreedIndex !== undefined) {
          setSentimentScore(Number(data.fearGreedIndex));
        }
      })
      .catch((e) => console.error('Failed to fetch sentiment:', e));
  }, [isAuthenticated, fetchBots, fetchPortfolio, fetchHistory, fetchTickers]);

  const activeBotCount = bots.filter((b) => b.status === BotStatus.RUNNING).length;

  const tickerList = useMemo(() => {
    return Array.from(tickers.values());
  }, [tickers]);

  const pnlData = useMemo(() => {
    if (history.length > 0) {
      return history.map((h) => ({ date: h.date, pnl: h.pnl }));
    }
    return [];
  }, [history]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <StatsGrid
        totalValue={summary?.totalValue ?? 0}
        dailyPnL={summary?.dailyPnL ?? 0}
        dailyPnLPercent={summary?.dailyPnLPercent ?? 0}
        activeBots={activeBotCount}
        totalBots={bots.length}
        sentimentScore={sentimentScore}
      />

      {/* Charts + Active bots row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>일일 손익 (30일)</CardHeader>
            {pnlData.length > 0 ? (
              <PnLChart data={pnlData} height={280} />
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">
                봇을 실행하면 손익 차트가 표시됩니다
              </div>
            )}
          </Card>
        </div>
        <div className="lg:col-span-1">
          <ActiveBots bots={bots} />
        </div>
      </div>

      {/* Trades + Market overview row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentTrades trades={recentTrades} />
        <MarketOverview tickers={tickerList} />
      </div>
    </div>
  );
}
