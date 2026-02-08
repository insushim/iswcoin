"use client";

import { useEffect, useState } from "react";
import { BotCard } from "@/components/bots/bot-card";
import { CreateBotForm } from "@/components/bots/create-bot-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/loading";
import { useBotStore, type Bot } from "@/stores/bot.store";
import { Plus, Bot as BotIcon } from "lucide-react";
import {
  BotStatus,
  StrategyType,
  TradingMode,
  Exchange,
} from "@cryptosentinel/shared";

const DEMO_BOTS: Bot[] = [
  {
    id: "1",
    name: "BTC DCA Strategy",
    symbol: "BTCUSDT",
    exchange: Exchange.BINANCE,
    strategy: StrategyType.DCA,
    mode: TradingMode.PAPER,
    status: BotStatus.RUNNING,
    config: { investmentAmount: 100, interval: 24 },
    pnl: 1245.67,
    pnlPercent: 12.45,
    totalTrades: 48,
    winRate: 62.5,
    createdAt: "2025-01-15T00:00:00Z",
    updatedAt: "2025-01-20T00:00:00Z",
  },
  {
    id: "2",
    name: "ETH Grid Bot",
    symbol: "ETHUSDT",
    exchange: Exchange.BINANCE,
    strategy: StrategyType.GRID,
    mode: TradingMode.PAPER,
    status: BotStatus.RUNNING,
    config: { upperPrice: 4000, lowerPrice: 3000, gridLevels: 20 },
    pnl: 456.23,
    pnlPercent: 4.56,
    totalTrades: 156,
    winRate: 58.3,
    createdAt: "2025-01-10T00:00:00Z",
    updatedAt: "2025-01-20T00:00:00Z",
  },
  {
    id: "3",
    name: "SOL Momentum",
    symbol: "SOLUSDT",
    exchange: Exchange.BYBIT,
    strategy: StrategyType.MOMENTUM,
    mode: TradingMode.PAPER,
    status: BotStatus.RUNNING,
    config: { rsiPeriod: 14, rsiBuyThreshold: 30, rsiSellThreshold: 70 },
    pnl: -89.12,
    pnlPercent: -1.78,
    totalTrades: 23,
    winRate: 43.5,
    createdAt: "2025-01-18T00:00:00Z",
    updatedAt: "2025-01-20T00:00:00Z",
  },
  {
    id: "4",
    name: "BNB Mean Reversion",
    symbol: "BNBUSDT",
    exchange: Exchange.BINANCE,
    strategy: StrategyType.MEAN_REVERSION,
    mode: TradingMode.REAL,
    status: BotStatus.STOPPED,
    config: { bollingerPeriod: 20, bollingerStdDev: 2 },
    pnl: 234.56,
    pnlPercent: 2.35,
    totalTrades: 67,
    winRate: 55.2,
    createdAt: "2025-01-05T00:00:00Z",
    updatedAt: "2025-01-19T00:00:00Z",
  },
  {
    id: "5",
    name: "RL Agent Alpha",
    symbol: "BTCUSDT",
    exchange: Exchange.BINANCE,
    strategy: StrategyType.RL_AGENT,
    mode: TradingMode.PAPER,
    status: BotStatus.IDLE,
    config: { confidenceThreshold: 0.7, maxPositions: 3 },
    pnl: 0,
    pnlPercent: 0,
    totalTrades: 0,
    winRate: 0,
    createdAt: "2025-01-20T00:00:00Z",
    updatedAt: "2025-01-20T00:00:00Z",
  },
];

export default function BotsPage() {
  const { bots, fetchBots, startBot, stopBot, deleteBot, isLoading } = useBotStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [settingsBot, setSettingsBot] = useState<Bot | null>(null);

  useEffect(() => {
    fetchBots().catch(() => {});
  }, [fetchBots]);

  const displayBots = bots.length > 0 ? bots : DEMO_BOTS;

  if (isLoading && bots.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">트레이딩 봇</h2>
          <p className="text-sm text-slate-400 mt-1">
            자동매매 봇을 관리하고 모니터링하세요
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowCreateModal(true)}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          봇 생성
        </Button>
      </div>

      {/* Bot grid */}
      {displayBots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <BotIcon className="h-16 w-16 text-slate-700 mb-4" />
          <h3 className="text-lg font-semibold text-slate-400">봇이 없습니다</h3>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            첫 번째 트레이딩 봇을 만들어 시작하세요
          </p>
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            봇 생성
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayBots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onStart={startBot}
              onStop={stopBot}
              onDelete={deleteBot}
              onSettings={(b) => setSettingsBot(b)}
            />
          ))}
        </div>
      )}

      {/* Create bot modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="새 봇 생성"
        size="lg"
      >
        <CreateBotForm onClose={() => setShowCreateModal(false)} />
      </Modal>

      {/* Settings modal */}
      <Modal
        isOpen={!!settingsBot}
        onClose={() => setSettingsBot(null)}
        title={`${settingsBot?.name ?? "봇"} 설정`}
        size="lg"
      >
        {settingsBot && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400">전략</p>
                <p className="text-sm font-medium text-white">{settingsBot.strategy}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">종목</p>
                <p className="text-sm font-medium text-white">{settingsBot.symbol}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">거래소</p>
                <p className="text-sm font-medium text-white">{settingsBot.exchange}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">모드</p>
                <p className="text-sm font-medium text-white">{settingsBot.mode === "PAPER" ? "모의 투자" : "실전 투자"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-2">설정 값</p>
              <div className="rounded-lg bg-slate-800/30 p-3 space-y-1">
                {Object.entries(settingsBot.config).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-slate-400">{key}</span>
                    <span className="text-white">{String(val)}</span>
                  </div>
                ))}
                {Object.keys(settingsBot.config).length === 0 && (
                  <p className="text-sm text-slate-500">설정 값이 없습니다</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setSettingsBot(null)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
