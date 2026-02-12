"use client";

import { useEffect } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { AllocationPieChart } from "@/components/charts/pie-chart";
import { EquityCurve } from "@/components/charts/equity-curve";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { Wallet, TrendingUp, TrendingDown, PieChart } from "lucide-react";

const COIN_COLORS: Record<string, string> = { BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff", BNB: "#f3ba2f", USDT: "#26a17b" };

export default function PortfolioPage() {
  const { summary, history, positions, fetchPortfolio, fetchHistory, fetchPositions } = usePortfolioStore();

  useEffect(() => {
    fetchPortfolio().catch(() => {});
    fetchHistory(60).catch(() => {});
    fetchPositions().catch(() => {});
  }, [fetchPortfolio, fetchHistory, fetchPositions]);

  const totalValue = summary?.totalValue ?? 0;
  const totalPnL = Number((summary as unknown as Record<string, unknown>)?.totalPnL ?? (summary as unknown as Record<string, unknown>)?.totalPnl ?? 0);
  const totalPnLPercent = summary?.totalPnLPercent ?? 0;
  const dailyPnL = summary?.dailyPnL ?? 0;
  const dailyPnLPercent = summary?.dailyPnLPercent ?? 0;

  const chartHistory = history.length > 0 ? history.map(h => ({ date: h.date, value: h.value })) : [];

  const displayPositions = positions.map((p) => {
    const posValue = Number(p.currentPrice ?? 0) * Number(p.amount ?? 0);
    const totalVal = totalValue || 1;
    return {
      symbol: p.symbol || "",
      amount: Number(p.amount ?? 0),
      entryPrice: Number(p.entryPrice ?? 0),
      currentPrice: Number(p.currentPrice ?? 0),
      pnl: Number(p.pnl ?? 0),
      pnlPercent: Number(p.pnlPercent ?? 0),
      allocation: Math.round((posValue / totalVal) * 1000) / 10,
    };
  });

  const displayAllocation = displayPositions.length > 0
    ? displayPositions.map((p) => ({
        name: p.symbol,
        value: p.currentPrice * p.amount,
        color: COIN_COLORS[p.symbol] || "#6366f1",
      }))
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-500/15 p-2.5">
              <Wallet className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">총 자산가치</p>
              <p className="text-xl font-bold text-white">{formatCurrency(totalValue)}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className={cn("rounded-lg p-2.5", totalPnL >= 0 ? "bg-emerald-500/15" : "bg-red-500/15")}>
              {totalPnL >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-400" /> : <TrendingDown className="h-5 w-5 text-red-400" />}
            </div>
            <div>
              <p className="text-xs text-slate-400">총 손익</p>
              <p className={cn("text-xl font-bold", totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
                {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
              </p>
              <p className={cn("text-xs", totalPnLPercent >= 0 ? "text-emerald-500" : "text-red-500")}>
                {formatPercent(totalPnLPercent)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className={cn("rounded-lg p-2.5", dailyPnL >= 0 ? "bg-blue-500/15" : "bg-red-500/15")}>
              <TrendingUp className={cn("h-5 w-5", dailyPnL >= 0 ? "text-blue-400" : "text-red-400")} />
            </div>
            <div>
              <p className="text-xs text-slate-400">일일 손익</p>
              <p className={cn("text-xl font-bold", dailyPnL >= 0 ? "text-blue-400" : "text-red-400")}>
                {dailyPnL >= 0 ? "+" : ""}{formatCurrency(dailyPnL)}
              </p>
              <p className={cn("text-xs", dailyPnLPercent >= 0 ? "text-blue-500" : "text-red-500")}>
                {formatPercent(dailyPnLPercent)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-purple-500/15 p-2.5">
              <PieChart className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">보유 자산</p>
              <p className="text-xl font-bold text-white">{displayPositions.length}</p>
              <p className="text-xs text-slate-500">포트폴리오 내 토큰</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Equity + Allocation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>포트폴리오 가치 (60일)</CardHeader>
          {chartHistory.length > 0 ? (
            <EquityCurve data={chartHistory} height={320} />
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">
              봇을 실행하면 포트폴리오 히스토리가 표시됩니다
            </div>
          )}
        </Card>
        <Card>
          <CardHeader>자산 배분</CardHeader>
          {displayAllocation.length > 0 ? (
            <AllocationPieChart data={displayAllocation} height={280} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">
              포지션이 없습니다
            </div>
          )}
        </Card>
      </div>

      {/* Positions table */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">보유 포지션</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>자산</th>
                <th className="text-right">수량</th>
                <th className="text-right">매입가</th>
                <th className="text-right">현재가</th>
                <th className="text-right">손익</th>
                <th className="text-right">수익률</th>
                <th className="text-right">비중</th>
              </tr>
            </thead>
            <tbody>
              {displayPositions.map((pos) => (
                <tr key={pos.symbol}>
                  <td className="font-medium text-white">{pos.symbol}</td>
                  <td className="text-right">{pos.amount.toFixed(pos.amount >= 100 ? 2 : 4)}</td>
                  <td className="text-right">{formatCurrency(pos.entryPrice)}</td>
                  <td className="text-right">{formatCurrency(pos.currentPrice)}</td>
                  <td className={cn("text-right font-medium", pos.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {pos.pnl >= 0 ? "+" : ""}{formatCurrency(pos.pnl)}
                  </td>
                  <td className={cn("text-right", pos.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {formatPercent(pos.pnlPercent)}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-700">
                        <div
                          className="h-1.5 rounded-full bg-emerald-500"
                          style={{ width: `${pos.allocation}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{pos.allocation}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
