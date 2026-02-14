"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BotConfig, getDefaultConfig } from "@/components/bots/bot-config";
import {
  StrategyType,
  TradingMode,
  Exchange,
} from "@cryptosentinel/shared";
import { useBotStore } from "@/stores/bot.store";
import { Plus } from "lucide-react";

interface CreateBotFormProps {
  onClose: () => void;
}

const exchangeOptions = Object.values(Exchange).map((v) => ({
  label: v,
  value: v,
}));

const strategyLabels: Record<string, string> = {
  DCA: "적립식 매수 (DCA)",
  GRID: "그리드 트레이딩",
  MARTINGALE: "마틴게일",
  TRAILING: "트레일링 스탑",
  MOMENTUM: "모멘텀",
  MEAN_REVERSION: "평균 회귀",
  RL_AGENT: "RL 에이전트 (AI)",
  STAT_ARB: "통계적 차익거래",
  SCALPING: "스캘핑",
  FUNDING_ARB: "펀딩비 차익거래",
};

const strategyOptions = Object.values(StrategyType).map((v) => ({
  label: strategyLabels[v] ?? v,
  value: v,
}));

export function CreateBotForm({ onClose }: CreateBotFormProps) {
  const { createBot, isLoading } = useBotStore();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [exchange, setExchange] = useState<Exchange>(Exchange.BINANCE);
  const [strategy, setStrategy] = useState<StrategyType>(StrategyType.DCA);
  const [mode, setMode] = useState<TradingMode>(TradingMode.PAPER);
  const [config, setConfig] = useState<Record<string, number | string | boolean>>(
    getDefaultConfig(StrategyType.DCA)
  );
  const [error, setError] = useState<string | null>(null);

  const handleStrategyChange = (newStrategy: StrategyType) => {
    setStrategy(newStrategy);
    setConfig(getDefaultConfig(newStrategy));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("봇 이름을 입력해주세요");
      return;
    }
    if (!symbol.trim()) {
      setError("종목을 입력해주세요");
      return;
    }

    const sym = symbol.trim().toUpperCase();
    if (!/^[A-Z]{2,10}USDT$/.test(sym) && !/^[A-Z]{2,10}\/USDT$/.test(sym)) {
      setError("종목 형식이 올바르지 않습니다. 예: BTCUSDT");
      return;
    }

    if (mode === TradingMode.REAL) {
      const confirmed = window.confirm(
        "⚠️ 실전 투자 모드로 봇을 생성합니다.\n\n" +
        "실제 자금이 사용되며, 손실이 발생할 수 있습니다.\n" +
        "API 키가 올바르게 설정되어 있는지 확인하셨나요?\n\n" +
        "계속 진행하시겠습니까?"
      );
      if (!confirmed) return;
    }

    try {
      await createBot({
        name: name.trim(),
        symbol: sym.replace("/", ""),
        exchange,
        strategy,
        mode,
        config,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "봇 생성에 실패했습니다");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="봇 이름"
          placeholder="BTC 적립식 매수 봇"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="종목"
          placeholder="BTCUSDT"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="거래소"
          options={exchangeOptions}
          value={exchange}
          onChange={(e) => setExchange(e.target.value as Exchange)}
        />
        <Select
          label="전략"
          options={strategyOptions}
          value={strategy}
          onChange={(e) => handleStrategyChange(e.target.value as StrategyType)}
        />
      </div>

      {/* Mode toggle */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">
          트레이딩 모드
        </label>
        <div className="flex rounded-lg border border-slate-700 p-1 w-fit">
          <button
            type="button"
            onClick={() => setMode(TradingMode.PAPER)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
              mode === TradingMode.PAPER
                ? "bg-amber-500/20 text-amber-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            모의 투자
          </button>
          <button
            type="button"
            onClick={() => setMode(TradingMode.REAL)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
              mode === TradingMode.REAL
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            실전 투자
          </button>
        </div>
        {mode === TradingMode.REAL && (
          <p className="text-xs text-amber-400">
            경고: 실전 투자는 실제 자금이 사용됩니다. API 키가 설정되어 있는지 확인하세요.
          </p>
        )}
      </div>

      {/* Strategy config */}
      <div className="border-t border-slate-800 pt-4">
        <BotConfig strategy={strategy} config={config} onChange={setConfig} />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
        <Button variant="secondary" type="button" onClick={onClose}>
          취소
        </Button>
        <Button
          variant="primary"
          type="submit"
          isLoading={isLoading}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          봇 생성
        </Button>
      </div>
    </form>
  );
}
