"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import { OrderSide } from "@cryptosentinel/shared";

interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
  price: number;
  amount: number;
  pnl: number;
  timestamp: string;
}

interface RecentTradesProps {
  trades: Trade[];
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <Card>
      <CardHeader>최근 거래</CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                시간
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                종목
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                구분
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                가격
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                수량
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                손익
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                  최근 거래 내역이 없습니다
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr
                  key={trade.id}
                  className="transition-colors hover:bg-slate-800/30"
                >
                  <td className="px-3 py-3 text-xs text-slate-400">
                    {formatRelativeTime(trade.timestamp)}
                  </td>
                  <td className="px-3 py-3 text-sm font-medium text-white">
                    {trade.symbol}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                        trade.side === OrderSide.BUY
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-red-500/15 text-red-400"
                      )}
                    >
                      {trade.side === OrderSide.BUY ? "매수" : "매도"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-slate-300">
                    {formatCurrency(trade.price)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-slate-300">
                    {trade.amount.toFixed(6)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right text-sm font-medium",
                      trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {trade.pnl >= 0 ? "+" : ""}
                    {formatCurrency(trade.pnl)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
