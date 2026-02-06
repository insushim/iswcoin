"use client";

import { Input } from "@/components/ui/input";
import { StrategyType } from "@cryptosentinel/shared";

interface BotConfigProps {
  strategy: StrategyType;
  config: Record<string, number | string | boolean>;
  onChange: (config: Record<string, number | string | boolean>) => void;
}

interface ConfigField {
  key: string;
  label: string;
  type: "number" | "text" | "boolean";
  placeholder?: string;
  defaultValue: number | string | boolean;
  helperText?: string;
}

const STRATEGY_CONFIGS: Record<StrategyType, ConfigField[]> = {
  [StrategyType.DCA]: [
    { key: "investmentAmount", label: "Investment Amount ($)", type: "number", defaultValue: 100, helperText: "Amount per DCA buy" },
    { key: "interval", label: "Interval (hours)", type: "number", defaultValue: 24, helperText: "Hours between buys" },
    { key: "maxPositions", label: "Max Positions", type: "number", defaultValue: 10 },
    { key: "priceDropTrigger", label: "Price Drop Trigger (%)", type: "number", defaultValue: 5, helperText: "Extra buy on dip" },
  ],
  [StrategyType.GRID]: [
    { key: "upperPrice", label: "Upper Price ($)", type: "number", defaultValue: 50000 },
    { key: "lowerPrice", label: "Lower Price ($)", type: "number", defaultValue: 30000 },
    { key: "gridLevels", label: "Grid Levels", type: "number", defaultValue: 20 },
    { key: "amountPerGrid", label: "Amount Per Grid ($)", type: "number", defaultValue: 50 },
  ],
  [StrategyType.MARTINGALE]: [
    { key: "initialAmount", label: "Initial Amount ($)", type: "number", defaultValue: 100 },
    { key: "multiplier", label: "Multiplier", type: "number", defaultValue: 2 },
    { key: "maxSteps", label: "Max Steps", type: "number", defaultValue: 5 },
    { key: "takeProfit", label: "Take Profit (%)", type: "number", defaultValue: 2 },
  ],
  [StrategyType.TRAILING]: [
    { key: "trailPercent", label: "Trail Percent (%)", type: "number", defaultValue: 1.5 },
    { key: "activationPercent", label: "Activation (%)", type: "number", defaultValue: 2, helperText: "Min profit before trailing" },
    { key: "positionSize", label: "Position Size ($)", type: "number", defaultValue: 500 },
  ],
  [StrategyType.MOMENTUM]: [
    { key: "rsiPeriod", label: "RSI Period", type: "number", defaultValue: 14 },
    { key: "rsiBuyThreshold", label: "RSI Buy Threshold", type: "number", defaultValue: 30 },
    { key: "rsiSellThreshold", label: "RSI Sell Threshold", type: "number", defaultValue: 70 },
    { key: "positionSize", label: "Position Size ($)", type: "number", defaultValue: 500 },
    { key: "stopLoss", label: "Stop Loss (%)", type: "number", defaultValue: 3 },
  ],
  [StrategyType.MEAN_REVERSION]: [
    { key: "bollingerPeriod", label: "Bollinger Period", type: "number", defaultValue: 20 },
    { key: "bollingerStdDev", label: "Bollinger Std Dev", type: "number", defaultValue: 2 },
    { key: "positionSize", label: "Position Size ($)", type: "number", defaultValue: 500 },
    { key: "stopLoss", label: "Stop Loss (%)", type: "number", defaultValue: 2 },
  ],
  [StrategyType.RL_AGENT]: [
    { key: "modelPath", label: "Model Path", type: "text", defaultValue: "models/rl_agent_v1" },
    { key: "positionSize", label: "Position Size ($)", type: "number", defaultValue: 500 },
    { key: "confidenceThreshold", label: "Confidence Threshold", type: "number", defaultValue: 0.7 },
    { key: "maxPositions", label: "Max Positions", type: "number", defaultValue: 3 },
  ],
};

export function BotConfig({ strategy, config, onChange }: BotConfigProps) {
  const fields = STRATEGY_CONFIGS[strategy] || [];

  const handleFieldChange = (key: string, value: string, type: string) => {
    let parsedValue: number | string | boolean;
    if (type === "number") {
      parsedValue = parseFloat(value) || 0;
    } else if (type === "boolean") {
      parsedValue = value === "true";
    } else {
      parsedValue = value;
    }
    onChange({ ...config, [key]: parsedValue });
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-slate-300">
        {strategy} Configuration
      </h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            type={field.type === "number" ? "number" : "text"}
            placeholder={field.placeholder}
            helperText={field.helperText}
            value={String(config[field.key] ?? field.defaultValue)}
            onChange={(e) =>
              handleFieldChange(field.key, e.target.value, field.type)
            }
          />
        ))}
      </div>
    </div>
  );
}

export function getDefaultConfig(strategy: StrategyType): Record<string, number | string | boolean> {
  const fields = STRATEGY_CONFIGS[strategy] || [];
  const config: Record<string, number | string | boolean> = {};
  fields.forEach((f) => {
    config[f.key] = f.defaultValue;
  });
  return config;
}
