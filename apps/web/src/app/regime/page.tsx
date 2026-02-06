"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatPercent } from "@/lib/utils";
import { MarketRegime } from "@cryptosentinel/shared";
import api, { endpoints } from "@/lib/api";
import { Activity, TrendingUp, TrendingDown, Zap, Shield } from "lucide-react";

interface RegimeData {
  current: MarketRegime;
  probability: number;
  history: { date: string; regime: MarketRegime }[];
}

const REGIME_LABELS: Record<MarketRegime, string> = {
  [MarketRegime.BULL_HIGH_VOL]: "Bullish High Volatility",
  [MarketRegime.BULL_LOW_VOL]: "Bullish Low Volatility",
  [MarketRegime.BEAR_HIGH_VOL]: "Bearish High Volatility",
  [MarketRegime.BEAR_LOW_VOL]: "Bearish Low Volatility",
};

const REGIME_COLORS: Record<MarketRegime, { bg: string; text: string; border: string }> = {
  [MarketRegime.BULL_HIGH_VOL]: { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30" },
  [MarketRegime.BULL_LOW_VOL]: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/30" },
  [MarketRegime.BEAR_HIGH_VOL]: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30" },
  [MarketRegime.BEAR_LOW_VOL]: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" },
};

const REGIME_ICONS: Record<MarketRegime, React.ReactNode> = {
  [MarketRegime.BULL_HIGH_VOL]: <Zap className="h-6 w-6" />,
  [MarketRegime.BULL_LOW_VOL]: <TrendingUp className="h-6 w-6" />,
  [MarketRegime.BEAR_HIGH_VOL]: <Activity className="h-6 w-6" />,
  [MarketRegime.BEAR_LOW_VOL]: <TrendingDown className="h-6 w-6" />,
};

const REGIME_STRATEGIES: Record<MarketRegime, string[]> = {
  [MarketRegime.BULL_HIGH_VOL]: ["Momentum", "Trailing Stop", "Breakout"],
  [MarketRegime.BULL_LOW_VOL]: ["DCA", "Grid Bot", "Hold"],
  [MarketRegime.BEAR_HIGH_VOL]: ["Mean Reversion", "Short Sell", "Hedge"],
  [MarketRegime.BEAR_LOW_VOL]: ["Accumulate", "DCA", "Stablecoin Yield"],
};

// Demo data
const DEMO_REGIME: RegimeData = {
  current: MarketRegime.BULL_HIGH_VOL,
  probability: 0.78,
  history: Array.from({ length: 60 }, (_, i) => {
    const regimes = Object.values(MarketRegime);
    const idx = Math.floor(i / 15) % regimes.length;
    return {
      date: new Date(Date.now() - (59 - i) * 86400000).toISOString(),
      regime: regimes[idx],
    };
  }),
};

// Transition matrix probabilities
const TRANSITION_MATRIX = [
  [0.65, 0.20, 0.10, 0.05],
  [0.15, 0.60, 0.05, 0.20],
  [0.10, 0.05, 0.55, 0.30],
  [0.05, 0.15, 0.25, 0.55],
];

const REGIME_SHORT_LABELS = ["Bull HV", "Bull LV", "Bear HV", "Bear LV"];

export default function RegimePage() {
  const [regime, setRegime] = useState<RegimeData | null>(null);

  useEffect(() => {
    async function fetchRegime() {
      try {
        const res = await api.get(endpoints.regime.current);
        setRegime(res.data.data);
      } catch {
        setRegime(DEMO_REGIME);
      }
    }
    fetchRegime();
  }, []);

  const data = regime || DEMO_REGIME;
  const currentColors = REGIME_COLORS[data.current];
  const recommendedStrategies = REGIME_STRATEGIES[data.current];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Current regime */}
      <Card>
        <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
          <div className={cn("rounded-2xl p-6", currentColors.bg, currentColors.text)}>
            {REGIME_ICONS[data.current]}
          </div>
          <div className="text-center sm:text-left flex-1">
            <p className="text-sm text-slate-400 mb-1">Current Market Regime</p>
            <h2 className={cn("text-2xl font-bold mb-2", currentColors.text)}>
              {REGIME_LABELS[data.current]}
            </h2>
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <span className="text-sm text-slate-400">Confidence:</span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 rounded-full bg-slate-700">
                  <div
                    className={cn("h-2 rounded-full", currentColors.bg.replace("/20", ""))}
                    style={{ width: `${data.probability * 100}%` }}
                  />
                </div>
                <span className={cn("text-sm font-semibold", currentColors.text)}>
                  {(data.probability * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Recommended strategies */}
          <div className="sm:ml-auto">
            <p className="text-xs text-slate-400 mb-2 text-center sm:text-right">Recommended Strategies</p>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
              {recommendedStrategies.map((s) => (
                <Badge key={s} variant="info">{s}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Regime History Timeline */}
        <Card>
          <CardHeader>Regime History (60 days)</CardHeader>
          <div className="space-y-1">
            <div className="flex h-8 rounded-lg overflow-hidden">
              {data.history.map((entry, i) => {
                const color = REGIME_COLORS[entry.regime];
                return (
                  <div
                    key={i}
                    className={cn("flex-1 transition-all", color.bg)}
                    title={`${new Date(entry.date).toLocaleDateString()} - ${REGIME_LABELS[entry.regime]}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>60 days ago</span>
              <span>Today</span>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-3">
            {Object.entries(REGIME_LABELS).map(([key, label]) => {
              const colors = REGIME_COLORS[key as MarketRegime];
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={cn("h-3 w-3 rounded-sm", colors.bg)} />
                  <span className="text-xs text-slate-400">{label}</span>
                </div>
              );
            })}
          </div>

          {/* Distribution */}
          <div className="mt-6 space-y-2">
            <p className="text-xs text-slate-400 mb-2">Distribution</p>
            {Object.values(MarketRegime).map((r) => {
              const count = data.history.filter((h) => h.regime === r).length;
              const pct = (count / data.history.length) * 100;
              const colors = REGIME_COLORS[r];
              return (
                <div key={r} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-32">{REGIME_LABELS[r]}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-800">
                    <div
                      className={cn("h-2 rounded-full transition-all", colors.bg.replace("/20", ""))}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 w-10 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Transition Matrix Heatmap */}
        <Card>
          <CardHeader>Transition Probability Matrix</CardHeader>
          <p className="text-xs text-slate-500 mb-4">
            Probability of transitioning from one regime to another
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-xs text-slate-500 text-left">From / To</th>
                  {REGIME_SHORT_LABELS.map((label) => (
                    <th key={label} className="px-2 py-2 text-xs text-slate-500 text-center">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TRANSITION_MATRIX.map((row, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2 text-xs font-medium text-slate-300">
                      {REGIME_SHORT_LABELS[i]}
                    </td>
                    {row.map((prob, j) => {
                      const intensity = Math.round(prob * 255);
                      const isHigh = prob > 0.4;
                      const isMedium = prob > 0.15;
                      return (
                        <td key={j} className="px-2 py-2 text-center">
                          <div
                            className={cn(
                              "rounded-md px-2 py-1.5 text-xs font-medium",
                              isHigh
                                ? "bg-emerald-500/30 text-emerald-300"
                                : isMedium
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-slate-800/50 text-slate-500"
                            )}
                          >
                            {(prob * 100).toFixed(0)}%
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* All regimes info */}
          <div className="mt-6 space-y-3">
            <p className="text-xs text-slate-400">All Regimes</p>
            {Object.values(MarketRegime).map((r) => {
              const colors = REGIME_COLORS[r];
              const isCurrent = r === data.current;
              return (
                <div
                  key={r}
                  className={cn(
                    "flex items-center justify-between rounded-lg border p-3 transition-all",
                    isCurrent
                      ? `${colors.bg} ${colors.border}`
                      : "border-slate-800/50 bg-slate-800/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("rounded-lg p-1.5", colors.bg, colors.text)}>
                      {REGIME_ICONS[r]}
                    </div>
                    <div>
                      <p className={cn("text-sm font-medium", isCurrent ? colors.text : "text-slate-300")}>
                        {REGIME_LABELS[r]}
                      </p>
                    </div>
                  </div>
                  {isCurrent && (
                    <Badge variant="running" dot>Active</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
