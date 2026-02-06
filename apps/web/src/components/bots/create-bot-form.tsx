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

const strategyOptions = Object.values(StrategyType).map((v) => ({
  label: v.replace(/_/g, " "),
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
      setError("Bot name is required");
      return;
    }
    if (!symbol.trim()) {
      setError("Symbol is required");
      return;
    }

    try {
      await createBot({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        exchange,
        strategy,
        mode,
        config,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bot");
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
          label="Bot Name"
          placeholder="My BTC DCA Bot"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Symbol"
          placeholder="BTCUSDT"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Exchange"
          options={exchangeOptions}
          value={exchange}
          onChange={(e) => setExchange(e.target.value as Exchange)}
        />
        <Select
          label="Strategy"
          options={strategyOptions}
          value={strategy}
          onChange={(e) => handleStrategyChange(e.target.value as StrategyType)}
        />
      </div>

      {/* Mode toggle */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">
          Trading Mode
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
            Paper Trading
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
            Real Trading
          </button>
        </div>
        {mode === TradingMode.REAL && (
          <p className="text-xs text-amber-400">
            Warning: Real trading uses actual funds. Make sure your API keys are configured.
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
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          isLoading={isLoading}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          Create Bot
        </Button>
      </div>
    </form>
  );
}
