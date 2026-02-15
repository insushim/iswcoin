"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { OrderSide } from "@cryptosentinel/shared";
import { ChevronLeft, ChevronRight, Search, Filter } from "lucide-react";
import api, { endpoints } from "@/lib/api";

interface TradeRow {
  id: string;
  symbol: string;
  side: OrderSide;
  type: string;
  price: number;
  amount: number;
  total: number;
  fee: number;
  pnl: number;
  botName: string;
  timestamp: string;
}


function mapTrade(raw: Record<string, unknown>): TradeRow {
  const price = Number(raw.entry_price ?? raw.entryPrice ?? raw.price ?? 0);
  const amount = Number(raw.quantity ?? raw.amount ?? 0);
  return {
    id: (raw.id as string) || "",
    symbol: ((raw.symbol as string) || "").replace("/", ""),
    side: (raw.side as OrderSide) || OrderSide.BUY,
    type: (raw.order_type as string) || (raw.type as string) || "MARKET",
    price,
    amount,
    total: price * amount,
    fee: Number(raw.fee ?? 0),
    pnl: Number(raw.pnl ?? 0),
    botName: (raw.botName as string) || (raw.bot_name as string) || "",
    timestamp: (raw.timestamp as string) || (raw.created_at as string) || new Date().toISOString(),
  };
}

const PAGE_SIZE = 10;

export default function TradesPage() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchTrades = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get(endpoints.trades.list, { params: { limit: 100 } });
      const raw = res.data.data ?? res.data;
      const tradeData = raw.trades ?? raw.data ?? raw;
      const list = Array.isArray(tradeData) ? tradeData.map(mapTrade) : [];
      setTrades(list);
    } catch {
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (symbolFilter && !trade.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) {
        return false;
      }
      if (sideFilter !== "all" && trade.side !== sideFilter) {
        return false;
      }
      if (dateFrom && new Date(trade.timestamp) < new Date(dateFrom)) {
        return false;
      }
      if (dateTo && new Date(trade.timestamp) > new Date(dateTo + "T23:59:59")) {
        return false;
      }
      return true;
    });
  }, [trades, symbolFilter, sideFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredTrades.length / PAGE_SIZE);
  const paginatedTrades = filteredTrades.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const totalPnL = filteredTrades.reduce((sum, t) => sum + t.pnl, 0);
  const winCount = filteredTrades.filter((t) => t.pnl > 0).length;
  const winRate = filteredTrades.length > 0 ? (winCount / filteredTrades.length) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-400">총 거래</p>
          <p className="text-xl font-bold text-white mt-1">{filteredTrades.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">총 손익</p>
          <p className={cn("text-xl font-bold mt-1", totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
            {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">승률</p>
          <p className="text-xl font-bold text-white mt-1">{winRate.toFixed(1)}%</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">평균 손익</p>
          <p className="text-xl font-bold text-white mt-1">
            {filteredTrades.length > 0
              ? formatCurrency(totalPnL / filteredTrades.length)
              : "$0.00"}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <Input
              label="종목"
              placeholder="종목 검색..."
              value={symbolFilter}
              onChange={(e) => { setSymbolFilter(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-36">
            <Select
              label="구분"
              options={[
                { label: "전체", value: "all" },
                { label: "매수", value: "BUY" },
                { label: "매도", value: "SELL" },
              ]}
              value={sideFilter}
              onChange={(e) => { setSideFilter(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-40">
            <Input
              label="시작일"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-40">
            <Input
              label="종료일"
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>종목</th>
                <th>구분</th>
                <th>유형</th>
                <th className="text-right">가격</th>
                <th className="text-right">수량</th>
                <th className="text-right">총액</th>
                <th className="text-right">수수료</th>
                <th className="text-right">손익</th>
                <th>봇</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-500">
                    거래 내역이 없습니다
                  </td>
                </tr>
              ) : (
                paginatedTrades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(trade.timestamp, "MMM dd HH:mm")}
                    </td>
                    <td className="font-medium text-white">{trade.symbol}</td>
                    <td>
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                          trade.side === OrderSide.BUY
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-red-500/15 text-red-400"
                        )}
                      >
                        {trade.side === "BUY" ? "매수" : "매도"}
                      </span>
                    </td>
                    <td className="text-slate-400">{trade.type === "LIMIT" ? "지정가" : "시장가"}</td>
                    <td className="text-right">{formatCurrency(trade.price)}</td>
                    <td className="text-right">{trade.amount.toFixed(4)}</td>
                    <td className="text-right">{formatCurrency(trade.total)}</td>
                    <td className="text-right text-slate-500">{formatCurrency(trade.fee)}</td>
                    <td
                      className={cn(
                        "text-right font-medium",
                        trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      )}
                    >
                      {trade.pnl >= 0 ? "+" : ""}{formatCurrency(trade.pnl)}
                    </td>
                    <td className="text-xs text-slate-500">{trade.botName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
            <p className="text-sm text-slate-500">
              {filteredTrades.length}건 중{" "}
              {(currentPage - 1) * PAGE_SIZE + 1} -{" "}
              {Math.min(currentPage * PAGE_SIZE, filteredTrades.length)} 표시
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {(() => {
                const maxVisible = 5;
                let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                const end = Math.min(totalPages, start + maxVisible - 1);
                if (end - start + 1 < maxVisible) {
                  start = Math.max(1, end - maxVisible + 1);
                }
                return Array.from({ length: end - start + 1 }, (_, i) => {
                  const page = start + i;
                  return (
                    <Button
                      key={page}
                      variant={page === currentPage ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  );
                });
              })()}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
