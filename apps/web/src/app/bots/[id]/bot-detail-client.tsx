"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/loading";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import api, { endpoints } from "@/lib/api";
import {
  ArrowLeft,
  Bot as BotIcon,
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface BotDetail {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  strategy: string;
  mode: string;
  status: string;
  config: Record<string, unknown>;
  createdAt: string;
}

interface BotPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  totalFees: number;
  winRate: number;
  maxDrawdown: number;
  netPnl: number;
}

interface Trade {
  id: string;
  side: string;
  price: number;
  amount: number;
  pnl: number | null;
  fee: number | null;
  createdAt: string;
}

const TRADES_PER_PAGE = 20;

function mapBotDetail(raw: Record<string, unknown>): BotDetail {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || "",
    symbol: ((raw.symbol as string) || "").replace("/", ""),
    exchange: ((raw.exchange as string) || "").toUpperCase(),
    strategy: (raw.strategy as string) || "",
    mode: (raw.mode as string) || (raw.trading_mode as string) || "PAPER",
    status: (raw.status as string) || "STOPPED",
    config:
      typeof raw.config === "string"
        ? (() => {
            try {
              return JSON.parse(raw.config as string);
            } catch {
              return {};
            }
          })()
        : (raw.config as Record<string, unknown>) || {},
    createdAt:
      (raw.createdAt as string) ||
      (raw.created_at as string) ||
      new Date().toISOString(),
  };
}

function mapPerformance(raw: Record<string, unknown>): BotPerformance {
  return {
    totalTrades: Number(raw.totalTrades ?? raw.total_trades ?? 0),
    wins: Number(raw.wins ?? 0),
    losses: Number(raw.losses ?? 0),
    totalPnl: Number(raw.totalPnl ?? raw.total_pnl ?? 0),
    totalFees: Number(raw.totalFees ?? raw.total_fees ?? 0),
    winRate: Number(raw.winRate ?? raw.win_rate ?? 0),
    maxDrawdown: Number(raw.maxDrawdown ?? raw.max_drawdown ?? 0),
    netPnl: Number(raw.netPnl ?? raw.net_pnl ?? 0),
  };
}

function mapTrade(raw: Record<string, unknown>): Trade {
  return {
    id: (raw.id as string) || "",
    side: (raw.side as string) || "BUY",
    price: Number(raw.entry_price ?? raw.entryPrice ?? raw.price ?? 0),
    amount: Number(raw.quantity ?? raw.amount ?? 0),
    pnl: raw.pnl != null ? Number(raw.pnl) : null,
    fee: raw.fee != null ? Number(raw.fee) : null,
    createdAt:
      (raw.createdAt as string) ||
      (raw.created_at as string) ||
      (raw.timestamp as string) ||
      new Date().toISOString(),
  };
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "RUNNING":
      return "running" as const;
    case "ERROR":
      return "error" as const;
    case "IDLE":
      return "idle" as const;
    default:
      return "stopped" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "RUNNING":
      return "실행 중";
    case "STOPPED":
      return "중지됨";
    case "ERROR":
      return "오류";
    case "IDLE":
      return "대기 중";
    default:
      return status;
  }
}

export default function BotDetailClient() {
  const params = useParams();
  const router = useRouter();
  const botId = params.id as string;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [performance, setPerformance] = useState<BotPerformance | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTradePages, setTotalTradePages] = useState(1);

  const fetchBotData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 봇 상세 정보 가져오기
      const botRes = await api.get(endpoints.bots.get(botId));
      const botRaw = botRes.data.data ?? botRes.data;
      setBot(mapBotDetail(botRaw));

      // 성과 데이터 가져오기
      try {
        const perfRes = await api.get(endpoints.bots.performance(botId));
        const perfRaw = perfRes.data.data ?? perfRes.data;
        setPerformance(mapPerformance(perfRaw));
      } catch {
        // 성과 데이터가 없으면 기본값 사용
        setPerformance(null);
      }

      // 최근 거래 가져오기
      try {
        const tradesRes = await api.get(
          endpoints.bots.trades(botId, 1, TRADES_PER_PAGE)
        );
        const tradesRaw = tradesRes.data.data ?? tradesRes.data;
        const tradeList = tradesRaw.trades ?? tradesRaw.data ?? tradesRaw;
        if (Array.isArray(tradeList)) {
          setTrades(tradeList.map(mapTrade));
        }
        if (tradesRaw.totalPages) {
          setTotalTradePages(Number(tradesRaw.totalPages));
        }
      } catch {
        setTrades([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "봇 정보를 불러오는데 실패했습니다"
      );
    } finally {
      setIsLoading(false);
    }
  }, [botId]);

  const fetchTrades = useCallback(
    async (page: number) => {
      try {
        const tradesRes = await api.get(
          endpoints.bots.trades(botId, page, TRADES_PER_PAGE)
        );
        const tradesRaw = tradesRes.data.data ?? tradesRes.data;
        const tradeList = tradesRaw.trades ?? tradesRaw.data ?? tradesRaw;
        if (Array.isArray(tradeList)) {
          setTrades(tradeList.map(mapTrade));
        }
        if (tradesRaw.totalPages) {
          setTotalTradePages(Number(tradesRaw.totalPages));
        }
      } catch {
        // 페이지 변경 실패 시 무시
      }
    },
    [botId]
  );

  useEffect(() => {
    fetchBotData();
  }, [fetchBotData]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchTrades(page);
  };

  if (isLoading) {
    return <PageLoader />;
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/bots")}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          봇 목록으로
        </Button>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/bots")}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          봇 목록으로
        </Button>
        <div className="flex flex-col items-center justify-center py-20">
          <BotIcon className="h-16 w-16 text-slate-700 mb-4" />
          <h3 className="text-lg font-semibold text-slate-400">
            봇을 찾을 수 없습니다
          </h3>
        </div>
      </div>
    );
  }

  const perf = performance ?? {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalFees: 0,
    winRate: 0,
    maxDrawdown: 0,
    netPnl: 0,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/bots")}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            봇 목록
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-white">{bot.name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {bot.symbol} &middot; {bot.exchange} &middot; {bot.strategy}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={bot.mode === "PAPER" ? "info" : "warning"}>
            {bot.mode === "PAPER" ? "모의 투자" : "실전 투자"}
          </Badge>
          <Badge variant={statusBadgeVariant(bot.status)} dot>
            {statusLabel(bot.status)}
          </Badge>
        </div>
      </div>

      {/* Bot Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BotIcon className="h-5 w-5 text-slate-400" />
            봇 정보
          </div>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-400">전략</p>
            <p className="text-sm font-medium text-white mt-1">
              {bot.strategy}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">종목</p>
            <p className="text-sm font-medium text-white mt-1">{bot.symbol}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">거래소</p>
            <p className="text-sm font-medium text-white mt-1">
              {bot.exchange}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">생성일</p>
            <p className="text-sm font-medium text-white mt-1">
              {formatDate(bot.createdAt, "yyyy.MM.dd")}
            </p>
          </div>
        </div>
        {Object.keys(bot.config).length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-slate-400 mb-2">설정 값</p>
            <div className="rounded-lg bg-slate-800/30 p-3 space-y-1">
              {Object.entries(bot.config).map(([key, val]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-slate-400">{key}</span>
                  <span className="text-white">{String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Performance Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-500/15 p-2.5">
              <Activity className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">총 거래</p>
              <p className="text-xl font-bold text-white">
                {perf.totalTrades}
              </p>
              <p className="text-xs text-slate-500">
                {perf.wins}승 / {perf.losses}패
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-500/15 p-2.5">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">승률</p>
              <p className="text-xl font-bold text-white">
                {perf.winRate.toFixed(1)}%
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "rounded-lg p-2.5",
                perf.totalPnl >= 0 ? "bg-emerald-500/15" : "bg-red-500/15"
              )}
            >
              {perf.totalPnl >= 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-400" />
              )}
            </div>
            <div>
              <p className="text-xs text-slate-400">총 손익</p>
              <p
                className={cn(
                  "text-xl font-bold",
                  perf.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                )}
              >
                {perf.totalPnl >= 0 ? "+" : ""}
                {formatCurrency(perf.totalPnl)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "rounded-lg p-2.5",
                perf.netPnl >= 0 ? "bg-emerald-500/15" : "bg-red-500/15"
              )}
            >
              {perf.netPnl >= 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-400" />
              )}
            </div>
            <div>
              <p className="text-xs text-slate-400">순 손익</p>
              <p
                className={cn(
                  "text-xl font-bold",
                  perf.netPnl >= 0 ? "text-emerald-400" : "text-red-400"
                )}
              >
                {perf.netPnl >= 0 ? "+" : ""}
                {formatCurrency(perf.netPnl)}
              </p>
              <p className="text-xs text-slate-500">
                수수료: {formatCurrency(perf.totalFees)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-red-500/15 p-2.5">
              <TrendingDown className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">최대 낙폭</p>
              <p className="text-xl font-bold text-red-400">
                {perf.maxDrawdown.toFixed(2)}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Trades Table */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">최근 거래 내역</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>구분</th>
                <th className="text-right">가격</th>
                <th className="text-right">수량</th>
                <th className="text-right">손익</th>
                <th className="text-right">수수료</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8 text-slate-500"
                  >
                    거래 내역이 없습니다
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(trade.createdAt, "MMM dd HH:mm")}
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
                    <td className="text-right">
                      {formatCurrency(trade.price)}
                    </td>
                    <td className="text-right">
                      {trade.amount.toFixed(trade.amount >= 100 ? 2 : 4)}
                    </td>
                    <td
                      className={cn(
                        "text-right font-medium",
                        trade.pnl != null && trade.pnl >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      )}
                    >
                      {trade.pnl != null
                        ? `${trade.pnl >= 0 ? "+" : ""}${formatCurrency(trade.pnl)}`
                        : "-"}
                    </td>
                    <td className="text-right text-slate-500">
                      {trade.fee != null ? formatCurrency(trade.fee) : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalTradePages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
            <p className="text-sm text-slate-500">
              페이지 {currentPage} / {totalTradePages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {(() => {
                const maxVisible = 5;
                let start = Math.max(
                  1,
                  currentPage - Math.floor(maxVisible / 2)
                );
                const end = Math.min(
                  totalTradePages,
                  start + maxVisible - 1
                );
                if (end - start + 1 < maxVisible) {
                  start = Math.max(1, end - maxVisible + 1);
                }
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => {
                    const page = start + i;
                    return (
                      <Button
                        key={page}
                        variant={
                          page === currentPage ? "primary" : "ghost"
                        }
                        size="sm"
                        onClick={() => handlePageChange(page)}
                      >
                        {page}
                      </Button>
                    );
                  }
                );
              })()}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === totalTradePages}
                onClick={() => handlePageChange(currentPage + 1)}
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
