"use client";

import { useEffect } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { AllocationPieChart } from "@/components/charts/pie-chart";
import { EquityCurve } from "@/components/charts/equity-curve";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { Wallet, TrendingUp, TrendingDown, PieChart } from "lucide-react";

const DEMO_POSITIONS = [
  { symbol: "BTC", amount: 0.45, entryPrice: 92000, currentPrice: 97523.45, pnl: 2485.55, pnlPercent: 5.99, allocation: 43.4 },
  { symbol: "ETH", amount: 5.2, entryPrice: 3100, currentPrice: 3245.67, pnl: 757.48, pnlPercent: 4.70, allocation: 16.7 },
  { symbol: "SOL", amount: 25.0, entryPrice: 180, currentPrice: 198.34, pnl: 458.50, pnlPercent: 10.19, allocation: 4.9 },
  { symbol: "BNB", amount: 3.5, entryPrice: 640, currentPrice: 625.89, pnl: -49.39, pnlPercent: -2.20, allocation: 2.2 },
  { symbol: "USDT", amount: 33245.00, entryPrice: 1, currentPrice: 1, pnl: 0, pnlPercent: 0, allocation: 32.8 },
];

const DEMO_ALLOCATION = [
  { name: "BTC", value: 43888.55, color: "#f7931a" },
  { name: "ETH", value: 16877.48, color: "#627eea" },
  { name: "SOL", value: 4958.50, color: "#9945ff" },
  { name: "BNB", value: 2190.62, color: "#f3ba2f" },
  { name: "USDT", value: 33245.00, color: "#26a17b" },
];

const DEMO_HISTORY = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.now() - (59 - i) * 86400000).toISOString(),
  value: 95000 + i * 100 + Math.random() * 2000 - 800,
}));

export default function PortfolioPage() {
  const { summary, history, fetchPortfolio, fetchHistory, fetchPositions } = usePortfolioStore();

  useEffect(() => {
    fetchPortfolio().catch(() => {});
    fetchHistory(60).catch(() => {});
    fetchPositions().catch(() => {});
  }, [fetchPortfolio, fetchHistory, fetchPositions]);

  const totalValue = summary?.totalValue ?? 101160.15;
  const totalPnL = summary?.totalPnL ?? 3652.14;
  const totalPnLPercent = summary?.totalPnLPercent ?? 3.75;
  const dailyPnL = summary?.dailyPnL ?? 342.50;
  const dailyPnLPercent = summary?.dailyPnLPercent ?? 0.34;

  const chartHistory = history.length > 0 ? history.map(h => ({ date: h.date, value: h.value })) : DEMO_HISTORY;

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
              <p className="text-xs text-slate-400">Total Value</p>
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
              <p className="text-xs text-slate-400">Total PnL</p>
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
              <p className="text-xs text-slate-400">Daily PnL</p>
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
              <p className="text-xs text-slate-400">Assets</p>
              <p className="text-xl font-bold text-white">{DEMO_POSITIONS.length}</p>
              <p className="text-xs text-slate-500">tokens in portfolio</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Equity + Allocation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>Portfolio Value (60 days)</CardHeader>
          <EquityCurve data={chartHistory} height={320} />
        </Card>
        <Card>
          <CardHeader>Allocation</CardHeader>
          <AllocationPieChart data={DEMO_ALLOCATION} height={280} />
        </Card>
      </div>

      {/* Positions table */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">Positions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Entry Price</th>
                <th className="text-right">Current Price</th>
                <th className="text-right">PnL</th>
                <th className="text-right">Return</th>
                <th className="text-right">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_POSITIONS.map((pos) => (
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
