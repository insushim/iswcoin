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
          <h2 className="text-2xl font-bold text-white">Trading Bots</h2>
          <p className="text-sm text-slate-400 mt-1">
            Manage and monitor your automated trading bots
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowCreateModal(true)}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          Create Bot
        </Button>
      </div>

      {/* Bot grid */}
      {displayBots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <BotIcon className="h-16 w-16 text-slate-700 mb-4" />
          <h3 className="text-lg font-semibold text-slate-400">No bots yet</h3>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Create your first trading bot to get started
          </p>
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Create Bot
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
            />
          ))}
        </div>
      )}

      {/* Create bot modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Bot"
        size="lg"
      >
        <CreateBotForm onClose={() => setShowCreateModal(false)} />
      </Modal>
    </div>
  );
}
