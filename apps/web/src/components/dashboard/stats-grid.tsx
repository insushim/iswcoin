"use client";

import { Card } from "@/components/ui/card";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import {
  DollarSign,
  TrendingUp,
  Bot,
  Activity,
} from "lucide-react";

interface StatItem {
  label: string;
  value: string;
  change: number;
  icon: React.ReactNode;
  iconBg: string;
}

interface StatsGridProps {
  totalValue: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  activeBots: number;
  totalBots: number;
  sentimentScore: number;
}

export function StatsGrid({
  totalValue,
  dailyPnL,
  dailyPnLPercent,
  activeBots,
  totalBots,
  sentimentScore,
}: StatsGridProps) {
  const stats: StatItem[] = [
    {
      label: "총 자산가치",
      value: formatCurrency(totalValue),
      change: dailyPnLPercent,
      icon: <DollarSign className="h-5 w-5 text-emerald-400" />,
      iconBg: "bg-emerald-500/15",
    },
    {
      label: "일일 손익",
      value: `${dailyPnL >= 0 ? "+" : ""}${formatCurrency(dailyPnL)}`,
      change: dailyPnLPercent,
      icon: <TrendingUp className="h-5 w-5 text-blue-400" />,
      iconBg: "bg-blue-500/15",
    },
    {
      label: "활성 봇",
      value: `${activeBots} / ${totalBots}`,
      change: 0,
      icon: <Bot className="h-5 w-5 text-purple-400" />,
      iconBg: "bg-purple-500/15",
    },
    {
      label: "시장 심리",
      value: sentimentScore >= 60 ? "탐욕" : sentimentScore >= 40 ? "중립" : "공포",
      change: sentimentScore,
      icon: <Activity className="h-5 w-5 text-amber-400" />,
      iconBg: "bg-amber-500/15",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} hover>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-white">{stat.value}</p>
              {stat.label !== "활성 봇" && stat.label !== "시장 심리" && (
                <p
                  className={cn(
                    "mt-1 text-xs font-medium",
                    stat.change >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {formatPercent(stat.change)} 오늘
                </p>
              )}
              {stat.label === "시장 심리" && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 w-full rounded-full bg-slate-700">
                    <div
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        sentimentScore >= 60
                          ? "bg-emerald-500"
                          : sentimentScore >= 40
                          ? "bg-amber-500"
                          : "bg-red-500"
                      )}
                      style={{ width: `${sentimentScore}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{sentimentScore}</span>
                </div>
              )}
            </div>
            <div className={cn("rounded-lg p-2.5", stat.iconBg)}>
              {stat.icon}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
