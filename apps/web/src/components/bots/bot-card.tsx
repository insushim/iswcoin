"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { Play, Square, Trash2, Settings } from "lucide-react";
import { BotStatus } from "@cryptosentinel/shared";
import type { Bot } from "@/stores/bot.store";

interface BotCardProps {
  bot: Bot;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings?: (bot: Bot) => void;
}

function getBotStatusVariant(status: BotStatus) {
  switch (status) {
    case BotStatus.RUNNING:
      return "running" as const;
    case BotStatus.STOPPED:
      return "stopped" as const;
    case BotStatus.ERROR:
      return "error" as const;
    case BotStatus.IDLE:
      return "idle" as const;
    default:
      return "info" as const;
  }
}

export function BotCard({ bot, onStart, onStop, onDelete, onSettings }: BotCardProps) {
  const isRunning = bot.status === BotStatus.RUNNING;

  return (
    <Card hover className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">{bot.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {bot.symbol} &middot; {bot.exchange}
          </p>
        </div>
        <Badge variant={getBotStatusVariant(bot.status)} dot>
          {bot.status}
        </Badge>
      </div>

      {/* Strategy */}
      <div className="rounded-lg bg-slate-800/30 px-3 py-2 mb-4">
        <p className="text-xs text-slate-400">전략</p>
        <p className="text-sm font-medium text-white">{bot.strategy}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-slate-400">손익</p>
          <p
            className={cn(
              "text-sm font-semibold",
              bot.pnl >= 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {bot.pnl >= 0 ? "+" : ""}
            {formatCurrency(bot.pnl)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">수익률</p>
          <p
            className={cn(
              "text-sm font-semibold",
              bot.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {formatPercent(bot.pnlPercent)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">총 거래</p>
          <p className="text-sm font-medium text-white">{bot.totalTrades}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">승률</p>
          <p className="text-sm font-medium text-white">{bot.winRate.toFixed(1)}%</p>
        </div>
      </div>

      {/* Mode indicator */}
      <div className="mb-4">
        <span
          className={cn(
            "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
            bot.mode === "PAPER"
              ? "bg-amber-500/15 text-amber-400"
              : "bg-emerald-500/15 text-emerald-400"
          )}
        >
          {bot.mode === "PAPER" ? "모의 투자" : "실전 투자"}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-4 border-t border-slate-800/50">
        {isRunning ? (
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            onClick={() => onStop(bot.id)}
            leftIcon={<Square className="h-3.5 w-3.5" />}
          >
            중지
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={() => onStart(bot.id)}
            leftIcon={<Play className="h-3.5 w-3.5" />}
          >
            시작
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onSettings?.(bot)}>
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-400 hover:text-red-300"
          onClick={() => onDelete(bot.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
