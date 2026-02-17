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
  [MarketRegime.BULL_HIGH_VOL]: "상승장 고변동성",
  [MarketRegime.BULL_LOW_VOL]: "상승장 저변동성",
  [MarketRegime.BEAR_HIGH_VOL]: "하락장 고변동성",
  [MarketRegime.BEAR_LOW_VOL]: "하락장 저변동성",
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
  [MarketRegime.BULL_HIGH_VOL]: ["모멘텀", "트레일링 스탑", "돌파 매매"],
  [MarketRegime.BULL_LOW_VOL]: ["적립식 매수", "그리드 봇", "홀딩"],
  [MarketRegime.BEAR_HIGH_VOL]: ["평균 회귀", "공매도", "헤지"],
  [MarketRegime.BEAR_LOW_VOL]: ["분할 매수", "적립식 매수", "스테이블코인 수익"],
};

// 빈 폴백 (가짜 데이터 제거)
const EMPTY_REGIME: RegimeData = {
  current: MarketRegime.BEAR_LOW_VOL,
  probability: 0,
  history: [],
};

// Transition matrix probabilities
const TRANSITION_MATRIX = [
  [0.65, 0.20, 0.10, 0.05],
  [0.15, 0.60, 0.05, 0.20],
  [0.10, 0.05, 0.55, 0.30],
  [0.05, 0.15, 0.25, 0.55],
];

const REGIME_SHORT_LABELS = ["상승 고변", "상승 저변", "하락 고변", "하락 저변"];

export default function RegimePage() {
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    async function fetchRegime() {
      try {
        const res = await api.get(endpoints.regime.current);
        setRegime(res.data.data);
        setIsDemo(false);
      } catch {
        setRegime(EMPTY_REGIME);
        setIsDemo(true);
      }
    }
    fetchRegime();
  }, []);

  const data = regime || EMPTY_REGIME;
  const currentColors = REGIME_COLORS[data.current];
  const recommendedStrategies = REGIME_STRATEGIES[data.current];

  return (
    <div className="space-y-6 animate-fade-in">
      {isDemo && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
          서버에 연결되지 않아 시장 국면 데이터를 불러올 수 없습니다.
        </div>
      )}

      {/* Current regime */}
      <Card>
        <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
          <div className={cn("rounded-2xl p-6", currentColors.bg, currentColors.text)}>
            {REGIME_ICONS[data.current]}
          </div>
          <div className="text-center sm:text-left flex-1">
            <p className="text-sm text-slate-400 mb-1">현재 시장 국면</p>
            <h2 className={cn("text-2xl font-bold mb-2", currentColors.text)}>
              {REGIME_LABELS[data.current]}
            </h2>
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <span className="text-sm text-slate-400">신뢰도:</span>
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
            <p className="text-xs text-slate-400 mb-2 text-center sm:text-right">추천 전략</p>
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
          <CardHeader>국면 이력 (60일)</CardHeader>
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
              <span>60일 전</span>
              <span>오늘</span>
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
            <p className="text-xs text-slate-400 mb-2">분포</p>
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
          <CardHeader>전이 확률 행렬</CardHeader>
          <p className="text-xs text-slate-500 mb-4">
            한 국면에서 다른 국면으로 전환될 확률
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-xs text-slate-500 text-left">전환</th>
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
            <p className="text-xs text-slate-400">전체 국면</p>
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
                    <Badge variant="running" dot>활성</Badge>
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
