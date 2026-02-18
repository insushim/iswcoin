"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { getBotStatusVariant } from "@/lib/bot-helpers";
import { BotStatus } from "@cryptosentinel/shared";
import type { Bot } from "@/stores/bot.store";

interface ActiveBotsProps {
  bots: Bot[];
}

export function ActiveBots({ bots }: ActiveBotsProps) {
  const activeBots = bots.filter((b) => b.status === BotStatus.RUNNING);

  return (
    <Card>
      <CardHeader>활성 봇</CardHeader>
      <div className="space-y-3">
        {activeBots.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">
            활성 봇이 없습니다. 새 봇을 생성해주세요.
          </p>
        ) : (
          activeBots.map((bot) => (
            <div
              key={bot.id}
              className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-800/30 px-4 py-3 transition-colors hover:bg-slate-800/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-white">{bot.name}</span>
                  <span className="text-xs text-slate-500">
                    {bot.symbol} &middot; {bot.strategy}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Badge variant={getBotStatusVariant(bot.status)} dot>
                  {bot.status === BotStatus.RUNNING ? "실행중" : bot.status === BotStatus.STOPPED ? "중지" : bot.status === BotStatus.ERROR ? "오류" : "대기"}
                </Badge>
                <div className="text-right">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      bot.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {bot.pnl >= 0 ? "+" : ""}
                    {formatCurrency(bot.pnl)}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      bot.pnlPercent >= 0 ? "text-emerald-500" : "text-red-500"
                    )}
                  >
                    {formatPercent(bot.pnlPercent)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
