"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { OrderSide } from "@cryptosentinel/shared";
import { ChevronLeft, ChevronRight, Search, Filter } from "lucide-react";

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

const DEMO_TRADES: TradeRow[] = Array.from({ length: 50 }, (_, i) => {
  const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
  const symbol = symbols[i % symbols.length];
  const basePrice: Record<string, number> = {
    BTCUSDT: 97000 + Math.random() * 2000,
    ETHUSDT: 3200 + Math.random() * 100,
    SOLUSDT: 190 + Math.random() * 20,
    BNBUSDT: 620 + Math.random() * 20,
    XRPUSDT: 2.3 + Math.random() * 0.3,
  };
  const price = basePrice[symbol];
  const amount = symbol === "BTCUSDT" ? 0.01 + Math.random() * 0.05 : 0.5 + Math.random() * 5;
  const total = price * amount;
  const pnl = (Math.random() - 0.4) * 200;
  const bots = ["BTC DCA Strategy", "ETH Grid Bot", "SOL Momentum", "BNB Mean Reversion"];

  return {
    id: `trade-${i + 1}`,
    symbol,
    side,
    type: Math.random() > 0.3 ? "MARKET" : "LIMIT",
    price,
    amount,
    total,
    fee: total * 0.001,
    pnl,
    botName: bots[i % bots.length],
    timestamp: new Date(Date.now() - i * 3600000 * (1 + Math.random() * 5)).toISOString(),
  };
});

const PAGE_SIZE = 10;

export default function TradesPage() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredTrades = useMemo(() => {
    return DEMO_TRADES.filter((trade) => {
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
  }, [symbolFilter, sideFilter, dateFrom, dateTo]);

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
          <p className="text-xs text-slate-400">Total Trades</p>
          <p className="text-xl font-bold text-white mt-1">{filteredTrades.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Total PnL</p>
          <p className={cn("text-xl font-bold mt-1", totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
            {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Win Rate</p>
          <p className="text-xl font-bold text-white mt-1">{winRate.toFixed(1)}%</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Avg Trade</p>
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
              label="Symbol"
              placeholder="Search symbol..."
              value={symbolFilter}
              onChange={(e) => { setSymbolFilter(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-36">
            <Select
              label="Side"
              options={[
                { label: "All", value: "all" },
                { label: "Buy", value: "BUY" },
                { label: "Sell", value: "SELL" },
              ]}
              value={sideFilter}
              onChange={(e) => { setSideFilter(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-40">
            <Input
              label="From"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-40">
            <Input
              label="To"
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
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Type</th>
                <th className="text-right">Price</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Total</th>
                <th className="text-right">Fee</th>
                <th className="text-right">PnL</th>
                <th>Bot</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-500">
                    No trades found
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
                        {trade.side}
                      </span>
                    </td>
                    <td className="text-slate-400">{trade.type}</td>
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
              Showing {(currentPage - 1) * PAGE_SIZE + 1} to{" "}
              {Math.min(currentPage * PAGE_SIZE, filteredTrades.length)} of{" "}
              {filteredTrades.length} trades
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
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const page = i + 1;
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
              })}
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
