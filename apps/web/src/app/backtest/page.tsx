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
import { Play, BarChart3, TrendingUp, Target, AlertTriangle, Database, Info } from "lucide-react";
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

// 기본 날짜: 최근 3개월 (CoinGecko 무료 API 1년 한도 이내)
function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [strategy, setStrategy] = useState<StrategyType>(StrategyType.MOMENTUM);
  const [defaultDates] = useState(getDefaultDates);
  const [startDate, setStartDate] = useState(defaultDates.start);
  const [endDate, setEndDate] = useState(defaultDates.end);
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

    const capital = parseFloat(initialCapital);
    if (isNaN(capital) || capital <= 0) {
      setError("초기 자본은 0보다 큰 금액을 입력해주세요.");
      setIsRunning(false);
      return;
    }
    if (capital > 10_000_000) {
      setError("초기 자본은 $10,000,000 이하로 설정해주세요.");
      setIsRunning(false);
      return;
    }
    if (startDate >= endDate) {
      setError("시작일은 종료일보다 이전이어야 합니다.");
      setIsRunning(false);
      return;
    }

    try {
      // 숫자 파라미터 + 앙상블용 strategies/weights 전달
      const params: Record<string, unknown> = {};
      Object.entries(config).forEach(([k, v]) => {
        if (typeof v === "number") params[k] = v;
      });
      // ENSEMBLE: strategies 배열과 weights 객체 전달
      if (strategy === StrategyType.ENSEMBLE) {
        const strategies = (config as Record<string, unknown>).strategies;
        const weights = (config as Record<string, unknown>).weights;
        if (Array.isArray(strategies)) params.strategies = strategies;
        if (weights && typeof weights === "object") params.weights = weights;
      }

      const res = await api.post(endpoints.backtest.run, {
        symbol,
        strategy,
        startDate,
        endDate,
        initialCapital: capital,
        params,
      });
      if (res.data.error) {
        setError(res.data.error);
        setResult(null);
      } else {
        setResult(res.data.data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "백테스트 실행 중 오류가 발생했습니다.";
      setError(msg);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  };

  const metrics = result
    ? [
        {
          label: "총 수익률",
          value: formatPercent(result.totalReturn),
          icon: <TrendingUp className="h-4 w-4" />,
          color: result.totalReturn >= 0 ? "text-emerald-400" : "text-red-400",
          bgColor: result.totalReturn >= 0 ? "bg-emerald-500/15" : "bg-red-500/15",
        },
        {
          label: "샤프 비율",
          value: result.sharpeRatio.toFixed(2),
          icon: <BarChart3 className="h-4 w-4" />,
          color: result.sharpeRatio >= 1 ? "text-emerald-400" : "text-amber-400",
          bgColor: result.sharpeRatio >= 1 ? "bg-emerald-500/15" : "bg-amber-500/15",
        },
        {
          label: "최대 낙폭",
          value: formatPercent(result.maxDrawdown),
          icon: <AlertTriangle className="h-4 w-4" />,
          color: "text-red-400",
          bgColor: "bg-red-500/15",
        },
        {
          label: "승률",
          value: `${result.winRate.toFixed(1)}%`,
          icon: <Target className="h-4 w-4" />,
          color: result.winRate >= 50 ? "text-emerald-400" : "text-red-400",
          bgColor: result.winRate >= 50 ? "bg-emerald-500/15" : "bg-red-500/15",
        },
        {
          label: "총 거래",
          value: String(result.totalTrades),
          icon: <BarChart3 className="h-4 w-4" />,
          color: "text-blue-400",
          bgColor: "bg-blue-500/15",
        },
        {
          label: "수익 팩터",
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
        <CardHeader>백테스트 설정</CardHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="종목"
              options={SYMBOL_OPTIONS}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
            <Select
              label="전략"
              options={STRATEGY_OPTIONS}
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value as StrategyType)}
            />
            <Input
              label="시작일"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="종료일"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <Input
            label="초기 자본 ($)"
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
              백테스트 실행
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

          {/* Data source & price range info */}
          {(result.dataSource || result.priceRange) && (
            <Card>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {result.dataSource && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <Database className="h-4 w-4 text-blue-400" />
                    <span>데이터: <span className="font-medium text-blue-400">{result.dataSource}</span></span>
                  </div>
                )}
                {result.priceRange && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <Info className="h-4 w-4 text-slate-400" />
                    <span>
                      시작가 {formatCurrency(result.priceRange.start)} → 종가 {formatCurrency(result.priceRange.end)}
                      {" "}(최고 {formatCurrency(result.priceRange.high)} / 최저 {formatCurrency(result.priceRange.low)})
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Equity curve */}
          <Card>
            <CardHeader>자산 곡선</CardHeader>
            <EquityCurve data={result.equityCurve} height={350} />
          </Card>

          {/* Trades table */}
          <Card padding="none">
            <div className="px-6 py-4 border-b border-slate-800">
              <h3 className="text-lg font-semibold text-white">백테스트 거래 내역</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>구분</th>
                    <th className="text-right">가격</th>
                    <th className="text-right">수량</th>
                    <th className="text-right">손익</th>
                    <th>사유</th>
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
                          {trade.side === "BUY" ? "매수" : "매도"}
                        </span>
                      </td>
                      <td className="text-right">{formatCurrency(trade.price)}</td>
                      <td className="text-right text-xs text-slate-400">
                        {trade.quantity ? trade.quantity.toFixed(6) : "-"}
                      </td>
                      <td
                        className={cn(
                          "text-right font-medium",
                          trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                        )}
                      >
                        {trade.pnl >= 0 ? "+" : ""}
                        {formatCurrency(trade.pnl)}
                      </td>
                      <td className="text-xs text-slate-400 max-w-[200px] truncate">
                        {trade.reason || "-"}
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
