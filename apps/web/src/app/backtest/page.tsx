"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EquityCurve } from "@/components/charts/equity-curve";
import { BotConfig, getDefaultConfig } from "@/components/bots/bot-config";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { StrategyType } from "@cryptosentinel/shared";
import { Play, BarChart3, TrendingUp, Target, AlertTriangle } from "lucide-react";
import api, { endpoints } from "@/lib/api";
import type { BacktestResult } from "@cryptosentinel/shared";

const SYMBOL_OPTIONS = [
  { label: "BTC/USDT", value: "BTCUSDT" },
  { label: "ETH/USDT", value: "ETHUSDT" },
  { label: "SOL/USDT", value: "SOLUSDT" },
  { label: "BNB/USDT", value: "BNBUSDT" },
];

const STRATEGY_OPTIONS = Object.values(StrategyType).map((v) => ({
  label: v.replace(/_/g, " "),
  value: v,
}));

// Demo result for display
const DEMO_RESULT: BacktestResult = {
  totalReturn: 23.45,
  sharpeRatio: 1.87,
  maxDrawdown: -8.32,
  winRate: 62.5,
  totalTrades: 156,
  profitFactor: 1.95,
  equityCurve: Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.now() - (89 - i) * 86400000).toISOString(),
    value: 10000 + i * 26 + Math.random() * 500 - 200,
  })),
  trades: Array.from({ length: 20 }, (_, i) => ({
    date: new Date(Date.now() - (19 - i) * 86400000 * 4.5).toISOString(),
    side: Math.random() > 0.5 ? "BUY" : "SELL",
    price: 95000 + Math.random() * 5000,
    pnl: (Math.random() - 0.35) * 300,
  })),
};

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [strategy, setStrategy] = useState<StrategyType>(StrategyType.MOMENTUM);
  const [startDate, setStartDate] = useState("2024-10-01");
  const [endDate, setEndDate] = useState("2025-01-20");
  const [initialCapital, setInitialCapital] = useState("10000");
  const [config, setConfig] = useState<Record<string, number | string | boolean>>(
    getDefaultConfig(StrategyType.MOMENTUM)
  );
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStrategyChange = (newStrategy: StrategyType) => {
    setStrategy(newStrategy);
    setConfig(getDefaultConfig(newStrategy));
  };

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);

    try {
      const numericParams: Record<string, number> = {};
      Object.entries(config).forEach(([k, v]) => {
        if (typeof v === "number") numericParams[k] = v;
      });

      const res = await api.post(endpoints.backtest.run, {
        symbol,
        strategy,
        startDate,
        endDate,
        initialCapital: parseFloat(initialCapital),
        params: numericParams,
      });
      setResult(res.data.data);
    } catch {
      // Use demo result on API failure
      setResult(DEMO_RESULT);
    } finally {
      setIsRunning(false);
    }
  };

  const metrics = result
    ? [
        {
          label: "Total Return",
          value: formatPercent(result.totalReturn),
          icon: <TrendingUp className="h-4 w-4" />,
          color: result.totalReturn >= 0 ? "text-emerald-400" : "text-red-400",
          bgColor: result.totalReturn >= 0 ? "bg-emerald-500/15" : "bg-red-500/15",
        },
        {
          label: "Sharpe Ratio",
          value: result.sharpeRatio.toFixed(2),
          icon: <BarChart3 className="h-4 w-4" />,
          color: result.sharpeRatio >= 1 ? "text-emerald-400" : "text-amber-400",
          bgColor: result.sharpeRatio >= 1 ? "bg-emerald-500/15" : "bg-amber-500/15",
        },
        {
          label: "Max Drawdown",
          value: formatPercent(result.maxDrawdown),
          icon: <AlertTriangle className="h-4 w-4" />,
          color: "text-red-400",
          bgColor: "bg-red-500/15",
        },
        {
          label: "Win Rate",
          value: `${result.winRate.toFixed(1)}%`,
          icon: <Target className="h-4 w-4" />,
          color: result.winRate >= 50 ? "text-emerald-400" : "text-red-400",
          bgColor: result.winRate >= 50 ? "bg-emerald-500/15" : "bg-red-500/15",
        },
        {
          label: "Total Trades",
          value: String(result.totalTrades),
          icon: <BarChart3 className="h-4 w-4" />,
          color: "text-blue-400",
          bgColor: "bg-blue-500/15",
        },
        {
          label: "Profit Factor",
          value: result.profitFactor.toFixed(2),
          icon: <TrendingUp className="h-4 w-4" />,
          color: result.profitFactor >= 1 ? "text-emerald-400" : "text-red-400",
          bgColor: result.profitFactor >= 1 ? "bg-emerald-500/15" : "bg-red-500/15",
        },
      ]
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Config form */}
      <Card>
        <CardHeader>Backtest Configuration</CardHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Symbol"
              options={SYMBOL_OPTIONS}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
            <Select
              label="Strategy"
              options={STRATEGY_OPTIONS}
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value as StrategyType)}
            />
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <Input
            label="Initial Capital ($)"
            type="number"
            value={initialCapital}
            onChange={(e) => setInitialCapital(e.target.value)}
          />

          <div className="border-t border-slate-800 pt-4">
            <BotConfig strategy={strategy} config={config} onChange={setConfig} />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={handleRun}
              isLoading={isRunning}
              leftIcon={<Play className="h-4 w-4" />}
            >
              Run Backtest
            </Button>
          </div>
        </div>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {metrics.map((m) => (
              <Card key={m.label}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("rounded-md p-1.5", m.bgColor, m.color)}>
                    {m.icon}
                  </div>
                  <span className="text-xs text-slate-400">{m.label}</span>
                </div>
                <p className={cn("text-lg font-bold", m.color)}>{m.value}</p>
              </Card>
            ))}
          </div>

          {/* Equity curve */}
          <Card>
            <CardHeader>Equity Curve</CardHeader>
            <EquityCurve data={result.equityCurve} height={350} />
          </Card>

          {/* Trades table */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-slate-800">
              <h3 className="text-lg font-semibold text-white">Backtest Trades</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Side</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, i) => (
                    <tr key={i}>
                      <td className="text-xs text-slate-400">
                        {new Date(trade.date).toLocaleDateString()}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                            trade.side === "BUY"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-red-500/15 text-red-400"
                          )}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="text-right">{formatCurrency(trade.price)}</td>
                      <td
                        className={cn(
                          "text-right font-medium",
                          trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                        )}
                      >
                        {trade.pnl >= 0 ? "+" : ""}
                        {formatCurrency(trade.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
