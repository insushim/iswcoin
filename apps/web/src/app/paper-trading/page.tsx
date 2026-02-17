"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import api, { endpoints } from "@/lib/api";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { EquityCurve } from "@/components/charts/equity-curve";
import { PnLChart } from "@/components/charts/pnl-chart";
import {
  Bot,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  BarChart3,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

interface BotInfo {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  strategy: string;
  status: string;
  mode: string;
}

interface PaperSummary {
  balance: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPct: number;
  netPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  equityCurve: { date: string; value: number }[];
  dailyPnl: { date: string; pnl: number }[];
}

interface PaperLogEntry {
  timestamp: number;
  signal: {
    action: string;
    confidence: number;
    reason: string;
    price: number;
  };
  execution: {
    fillPrice: number;
    amount: number;
    side: "buy" | "sell";
    fee: number;
  } | null;
  position: {
    isOpen: boolean;
    side: "long" | "short" | null;
    entryPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  } | null;
  paperBalance: number;
}

interface BotSummaryData {
  bot: BotInfo;
  summary: PaperSummary | null;
  logs: PaperLogEntry[];
  loading: boolean;
  error: string | null;
}

export default function PaperTradingPage() {
  const router = useRouter();
  const [paperBots, setPaperBots] = useState<BotInfo[]>([]);
  const [botData, setBotData] = useState<Map<string, BotSummaryData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  const fetchPaperBots = useCallback(async () => {
    try {
      const res = await api.get(endpoints.bots.list);
      const allBots: BotInfo[] = res.data.bots ?? [];
      const papers = allBots.filter((b) => b.mode === "PAPER");
      setPaperBots(papers);

      if (papers.length > 0 && !selectedBotId) {
        setSelectedBotId(papers[0].id);
      }

      return papers;
    } catch {
      return [];
    }
  }, [selectedBotId]);

  const fetchBotSummary = useCallback(async (botId: string) => {
    setBotData((prev) => {
      const existing = prev.get(botId);
      const next = new Map(prev);
      next.set(botId, {
        bot: existing?.bot ?? ({} as BotInfo),
        summary: existing?.summary ?? null,
        logs: existing?.logs ?? [],
        loading: true,
        error: null,
      });
      return next;
    });

    try {
      const [summaryRes, logsRes] = await Promise.all([
        api.get(endpoints.bots.paperSummary(botId)),
        api.get(endpoints.bots.paperLogs(botId, 20, 0)),
      ]);

      setBotData((prev) => {
        const existing = prev.get(botId);
        const next = new Map(prev);
        next.set(botId, {
          bot: existing?.bot ?? ({} as BotInfo),
          summary: summaryRes.data.summary,
          logs: logsRes.data.logs ?? [],
          loading: false,
          error: null,
        });
        return next;
      });
    } catch (err) {
      setBotData((prev) => {
        const existing = prev.get(botId);
        const next = new Map(prev);
        next.set(botId, {
          bot: existing?.bot ?? ({} as BotInfo),
          summary: existing?.summary ?? null,
          logs: existing?.logs ?? [],
          loading: false,
          error: err instanceof Error ? err.message : "조회 실패",
        });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const bots = await fetchPaperBots();
      // 각 봇의 summary 초기화
      const initialData = new Map<string, BotSummaryData>();
      for (const bot of bots) {
        initialData.set(bot.id, {
          bot,
          summary: null,
          logs: [],
          loading: false,
          error: null,
        });
      }
      setBotData(initialData);
      setLoading(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 선택된 봇 변경 시 데이터 로드
  useEffect(() => {
    if (selectedBotId) {
      fetchBotSummary(selectedBotId);
    }
  }, [selectedBotId, fetchBotSummary]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPaperBots();
    if (selectedBotId) {
      await fetchBotSummary(selectedBotId);
    }
    setRefreshing(false);
  };

  const runningCount = paperBots.filter((b) => b.status === "RUNNING").length;
  const selectedData = selectedBotId ? botData.get(selectedBotId) : null;
  const selectedBot = paperBots.find((b) => b.id === selectedBotId);
  const summary = selectedData?.summary;

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">모의 투자</h1>
          <p className="text-sm text-slate-400">
            PAPER 모드 봇 {paperBots.length}개 | 실행 중 {runningCount}개
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            새로고침
          </button>
          <button
            onClick={() => router.push("/bots")}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            <Bot className="h-4 w-4" />
            봇 관리
          </button>
        </div>
      </div>

      {paperBots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900 py-20">
          <AlertTriangle className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">PAPER 모드 봇이 없습니다</h3>
          <p className="mt-2 text-sm text-slate-400">
            봇 관리에서 PAPER 모드로 봇을 생성하고 시작하세요
          </p>
          <button
            onClick={() => router.push("/bots")}
            className="mt-4 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            봇 생성하기
          </button>
        </div>
      ) : (
        <>
          {/* 봇 선택 탭 */}
          <div className="flex flex-wrap gap-2">
            {paperBots.map((bot) => (
              <button
                key={bot.id}
                onClick={() => setSelectedBotId(bot.id)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  selectedBotId === bot.id
                    ? "border-emerald-500 bg-emerald-600/10 text-emerald-400"
                    : "border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    bot.status === "RUNNING" ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {bot.name}
                <span className="text-xs text-slate-500">({bot.strategy})</span>
              </button>
            ))}
          </div>

          {/* 선택된 봇 정보 */}
          {selectedBot && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bot className="h-5 w-5 text-emerald-400" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">{selectedBot.name}</h2>
                    <p className="text-sm text-slate-400">
                      {selectedBot.exchange} | {selectedBot.symbol} | {selectedBot.strategy}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    selectedBot.status === "RUNNING"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-slate-700 text-slate-400"
                  }`}
                >
                  {selectedBot.status === "RUNNING" ? "실행 중" : "중지됨"}
                </span>
              </div>
            </div>
          )}

          {/* 로딩 */}
          {selectedData?.loading && (
            <div className="flex h-40 items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}

          {/* 에러 */}
          {selectedData?.error && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
              {selectedData.error}
            </div>
          )}

          {/* 통계 카드 */}
          {summary && (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  label="총 거래"
                  value={String(summary.totalTrades)}
                  icon={<Activity className="h-5 w-5" />}
                  color="blue"
                />
                <StatCard
                  label="승률"
                  value={formatPercent(summary.winRate)}
                  sub={`${summary.wins}승 ${summary.losses}패`}
                  icon={<Target className="h-5 w-5" />}
                  color={summary.winRate >= 40 ? "green" : "red"}
                />
                <StatCard
                  label="총 PnL"
                  value={formatCurrency(summary.totalPnl)}
                  sub={`${summary.totalPnlPct >= 0 ? "+" : ""}${formatPercent(summary.totalPnlPct)}`}
                  icon={
                    summary.totalPnl >= 0 ? (
                      <TrendingUp className="h-5 w-5" />
                    ) : (
                      <TrendingDown className="h-5 w-5" />
                    )
                  }
                  color={summary.totalPnl >= 0 ? "green" : "red"}
                />
                <StatCard
                  label="순 PnL (수수료 차감)"
                  value={formatCurrency(summary.netPnl)}
                  icon={<BarChart3 className="h-5 w-5" />}
                  color={summary.netPnl >= 0 ? "green" : "red"}
                />
                <StatCard
                  label="MDD"
                  value={formatPercent(summary.maxDrawdownPct)}
                  sub={formatCurrency(summary.maxDrawdown)}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  color={summary.maxDrawdownPct < 15 ? "green" : "red"}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="샤프 비율"
                  value={String(summary.sharpeRatio)}
                  icon={<CheckCircle className="h-5 w-5" />}
                  color={summary.sharpeRatio >= 0.5 ? "green" : "yellow"}
                />
                <StatCard
                  label="수익 팩터"
                  value={summary.profitFactor >= 999 ? "∞" : String(summary.profitFactor)}
                  icon={<BarChart3 className="h-5 w-5" />}
                  color={summary.profitFactor >= 1.2 ? "green" : "yellow"}
                />
                <StatCard
                  label="평균 수익"
                  value={formatCurrency(summary.avgWin)}
                  icon={<ArrowUpRight className="h-5 w-5" />}
                  color="green"
                />
                <StatCard
                  label="평균 손실"
                  value={formatCurrency(summary.avgLoss)}
                  icon={<ArrowDownRight className="h-5 w-5" />}
                  color="red"
                />
              </div>

              {/* 잔고 표시 */}
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">현재 잔고</p>
                    <p className="text-2xl font-bold text-white">
                      {formatCurrency(summary.balance)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-400">초기 자본</p>
                    <p className="text-lg text-slate-300">
                      {formatCurrency(summary.initialBalance)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 에쿼티 커브 */}
              {summary.equityCurve.length > 1 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                  <h3 className="mb-4 text-lg font-semibold text-white">에쿼티 커브</h3>
                  <EquityCurve data={summary.equityCurve} height={350} />
                </div>
              )}

              {/* 일별 PnL */}
              {summary.dailyPnl.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                  <h3 className="mb-4 text-lg font-semibold text-white">일별 손익</h3>
                  <PnLChart data={summary.dailyPnl} height={300} />
                </div>
              )}

              {/* 최근 거래 테이블 */}
              {selectedData && selectedData.logs.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                  <h3 className="mb-4 text-lg font-semibold text-white">최근 시그널 로그</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400">
                          <th className="px-3 py-2">시각</th>
                          <th className="px-3 py-2">시그널</th>
                          <th className="px-3 py-2">가격</th>
                          <th className="px-3 py-2">체결</th>
                          <th className="px-3 py-2">수량</th>
                          <th className="px-3 py-2">수수료</th>
                          <th className="px-3 py-2">잔고</th>
                          <th className="px-3 py-2">이유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedData.logs.map((log, i) => (
                          <tr key={i} className="border-b border-slate-800 text-slate-300">
                            <td className="px-3 py-2 whitespace-nowrap text-xs">
                              <Clock className="mr-1 inline h-3 w-3 text-slate-500" />
                              {formatDate(log.timestamp, "MM.dd HH:mm")}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  log.signal.action === "buy"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : log.signal.action === "sell"
                                    ? "bg-red-500/10 text-red-400"
                                    : "bg-slate-700 text-slate-400"
                                }`}
                              >
                                {log.signal.action.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {formatCurrency(log.signal.price)}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {log.execution
                                ? formatCurrency(log.execution.fillPrice)
                                : "-"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {log.execution ? log.execution.amount.toFixed(6) : "-"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {log.execution ? formatCurrency(log.execution.fee) : "-"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {formatCurrency(log.paperBalance)}
                            </td>
                            <td className="max-w-[200px] truncate px-3 py-2 text-xs text-slate-500" title={log.signal.reason}>
                              {log.signal.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 데이터 없을 때 */}
              {summary.totalTrades === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900 py-16">
                  <Clock className="mb-4 h-10 w-10 text-slate-600" />
                  <h3 className="text-lg font-medium text-white">아직 거래 내역이 없습니다</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    봇이 실행 중이면 시장 분석 후 자동으로 거래가 발생합니다
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: "green" | "red" | "blue" | "yellow";
}) {
  const colorMap = {
    green: "text-emerald-400",
    red: "text-red-400",
    blue: "text-blue-400",
    yellow: "text-amber-400",
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{label}</p>
        <span className={colorMap[color]}>{icon}</span>
      </div>
      <p className={`mt-2 text-xl font-bold ${colorMap[color]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
