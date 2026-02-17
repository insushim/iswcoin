"use client";

import { useState } from "react";
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

// 앙상블에서 선택 가능한 서브 전략
const ENSEMBLE_SUB_STRATEGIES = [
  { value: "DCA", label: "적립식 매수 (DCA)" },
  { value: "GRID", label: "그리드 트레이딩" },
  { value: "MARTINGALE", label: "마틴게일" },
  { value: "TRAILING", label: "트레일링 스탑" },
  { value: "MOMENTUM", label: "모멘텀" },
  { value: "MEAN_REVERSION", label: "평균 회귀" },
  { value: "RL_AGENT", label: "RL 에이전트 (AI)" },
  { value: "STAT_ARB", label: "통계적 차익거래" },
  { value: "SCALPING", label: "스캘핑" },
  { value: "FUNDING_ARB", label: "펀딩비 차익거래" },
] as const;

const ENSEMBLE_PRESETS: Record<string, { label: string; strategies: string[]; weights: Record<string, number> }> = {
  stable: { label: "안정형 (횡보장 최적)", strategies: ["DCA", "MEAN_REVERSION", "GRID"], weights: { DCA: 1.2, MEAN_REVERSION: 1.0, GRID: 0.8 } },
  aggressive: { label: "공격형 (추세장 최적)", strategies: ["MOMENTUM", "SCALPING", "TRAILING"], weights: { MOMENTUM: 1.2, SCALPING: 1.0, TRAILING: 0.8 } },
  balanced: { label: "균형형 (전천후)", strategies: ["DCA", "MOMENTUM", "STAT_ARB"], weights: { DCA: 1.0, MOMENTUM: 1.0, STAT_ARB: 1.0 } },
  ai: { label: "AI형 (데이터 기반)", strategies: ["RL_AGENT", "MEAN_REVERSION", "FUNDING_ARB"], weights: { RL_AGENT: 1.5, MEAN_REVERSION: 1.0, FUNDING_ARB: 0.8 } },
};

const STRATEGY_CONFIGS: Record<StrategyType, ConfigField[]> = {
  [StrategyType.DCA]: [
    { key: "investmentAmount", label: "투자 금액 ($)", type: "number", defaultValue: 100, helperText: "DCA 회당 매수 금액" },
    { key: "interval", label: "매수 간격 (시간)", type: "number", defaultValue: 24, helperText: "매수 사이 대기 시간" },
    { key: "maxPositions", label: "최대 포지션", type: "number", defaultValue: 10 },
    { key: "priceDropTrigger", label: "하락 매수 트리거 (%)", type: "number", defaultValue: 5, helperText: "급락 시 추가 매수" },
  ],
  [StrategyType.GRID]: [
    { key: "upperPrice", label: "상한가 ($)", type: "number", defaultValue: 50000 },
    { key: "lowerPrice", label: "하한가 ($)", type: "number", defaultValue: 30000 },
    { key: "gridLevels", label: "그리드 단계", type: "number", defaultValue: 20 },
    { key: "amountPerGrid", label: "그리드당 금액 ($)", type: "number", defaultValue: 50 },
  ],
  [StrategyType.MARTINGALE]: [
    { key: "initialAmount", label: "초기 금액 ($)", type: "number", defaultValue: 100 },
    { key: "multiplier", label: "배율", type: "number", defaultValue: 2 },
    { key: "maxSteps", label: "최대 단계", type: "number", defaultValue: 5 },
    { key: "takeProfit", label: "익절 (%)", type: "number", defaultValue: 2 },
  ],
  [StrategyType.TRAILING]: [
    { key: "trailPercent", label: "추적 비율 (%)", type: "number", defaultValue: 1.5 },
    { key: "activationPercent", label: "활성화 (%)", type: "number", defaultValue: 2, helperText: "추적 시작 최소 수익률" },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
  ],
  [StrategyType.MOMENTUM]: [
    { key: "rsiPeriod", label: "RSI 기간", type: "number", defaultValue: 14 },
    { key: "rsiBuyThreshold", label: "RSI 매수 기준", type: "number", defaultValue: 30 },
    { key: "rsiSellThreshold", label: "RSI 매도 기준", type: "number", defaultValue: 70 },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
    { key: "stopLoss", label: "손절 (%)", type: "number", defaultValue: 3 },
  ],
  [StrategyType.MEAN_REVERSION]: [
    { key: "bollingerPeriod", label: "볼린저 기간", type: "number", defaultValue: 20 },
    { key: "bollingerStdDev", label: "볼린저 표준편차", type: "number", defaultValue: 2 },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
    { key: "stopLoss", label: "손절 (%)", type: "number", defaultValue: 2 },
  ],
  [StrategyType.RL_AGENT]: [
    { key: "modelPath", label: "모델 경로", type: "text", defaultValue: "models/rl_agent_v1" },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
    { key: "confidenceThreshold", label: "신뢰도 임계값", type: "number", defaultValue: 0.7 },
    { key: "maxPositions", label: "최대 포지션", type: "number", defaultValue: 3 },
  ],
  [StrategyType.STAT_ARB]: [
    { key: "lookbackPeriod", label: "분석 기간 (봉)", type: "number", defaultValue: 60 },
    { key: "zScoreEntry", label: "Z-Score 진입", type: "number", defaultValue: 2.0, helperText: "스프레드 진입 기준 Z값" },
    { key: "zScoreExit", label: "Z-Score 청산", type: "number", defaultValue: 0.5, helperText: "스프레드 청산 기준 Z값" },
    { key: "zScoreStopLoss", label: "Z-Score 손절", type: "number", defaultValue: 3.5 },
    { key: "halfLife", label: "반감기 (봉)", type: "number", defaultValue: 15, helperText: "평균 회귀 예상 속도" },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
  ],
  [StrategyType.SCALPING]: [
    { key: "emaFast", label: "EMA 빠른선", type: "number", defaultValue: 5 },
    { key: "emaSlow", label: "EMA 느린선", type: "number", defaultValue: 13 },
    { key: "rsiPeriod", label: "RSI 기간", type: "number", defaultValue: 7 },
    { key: "bbPeriod", label: "볼린저 기간", type: "number", defaultValue: 15 },
    { key: "atrTpMultiplier", label: "ATR 익절 배수", type: "number", defaultValue: 1.5, helperText: "ATR × 이 값 = 익절 거리" },
    { key: "atrSlMultiplier", label: "ATR 손절 배수", type: "number", defaultValue: 1.0, helperText: "ATR × 이 값 = 손절 거리" },
    { key: "volumeSpikeRatio", label: "거래량 급등 배율", type: "number", defaultValue: 2.0 },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 300 },
  ],
  [StrategyType.FUNDING_ARB]: [
    { key: "minAnnualizedRate", label: "최소 연환산 수익률 (%)", type: "number", defaultValue: 15, helperText: "이 수익률 이상일 때 진입" },
    { key: "maxAnnualizedRate", label: "최대 연환산 (%)", type: "number", defaultValue: 200, helperText: "과도한 펀딩비 회피" },
    { key: "positionSize", label: "포지션 크기 ($)", type: "number", defaultValue: 500 },
    { key: "stopLossPercent", label: "손절 (%)", type: "number", defaultValue: 2 },
    { key: "maxHoldingHours", label: "최대 보유 시간", type: "number", defaultValue: 72, helperText: "시간 단위" },
    { key: "minFundingCycles", label: "최소 펀딩 횟수", type: "number", defaultValue: 3, helperText: "최소 수취 주기 (8h × N)" },
  ],
  [StrategyType.ENSEMBLE]: [
    { key: "buyThreshold", label: "매수 임계값", type: "number", defaultValue: 1.5, helperText: "가중 투표 합산이 이 값 이상이면 매수" },
    { key: "sellThreshold", label: "매도 임계값", type: "number", defaultValue: -1.5, helperText: "가중 투표 합산이 이 값 이하이면 매도" },
  ],
};

export function BotConfig({ strategy, config, onChange }: BotConfigProps) {
  const fields = STRATEGY_CONFIGS[strategy] || [];
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  const handleFieldChange = (key: string, value: string, type: string) => {
    let parsedValue: number | string | boolean;
    if (type === "number") {
      const num = parseFloat(value);
      parsedValue = isNaN(num) ? 0 : Math.max(0, num);
    } else if (type === "boolean") {
      parsedValue = value === "true";
    } else {
      parsedValue = value;
    }
    onChange({ ...config, [key]: parsedValue });
  };

  // 앙상블 전략: 서브 전략 토글
  const toggleSubStrategy = (strat: string) => {
    const current = (config.strategies as unknown as string[]) || [];
    const weights = (config.weights as unknown as Record<string, number>) || {};
    if (current.includes(strat)) {
      const next = current.filter((s) => s !== strat);
      const { [strat]: _, ...restWeights } = weights;
      onChange({ ...config, strategies: next as never, weights: restWeights as never });
    } else {
      onChange({ ...config, strategies: [...current, strat] as never, weights: { ...weights, [strat]: 1.0 } as never });
    }
    setSelectedPreset("");
  };

  // 앙상블 전략: 가중치 변경
  const changeWeight = (strat: string, value: number) => {
    const weights = (config.weights as unknown as Record<string, number>) || {};
    onChange({ ...config, weights: { ...weights, [strat]: value } as never });
  };

  // 앙상블 프리셋 적용
  const applyPreset = (presetKey: string) => {
    const preset = ENSEMBLE_PRESETS[presetKey];
    if (!preset) return;
    setSelectedPreset(presetKey);
    onChange({
      ...config,
      strategies: preset.strategies as never,
      weights: preset.weights as never,
    });
  };

  // 앙상블 전용 UI
  if (strategy === StrategyType.ENSEMBLE) {
    const selectedStrategies = (config.strategies as unknown as string[]) || [];
    const weights = (config.weights as unknown as Record<string, number>) || {};

    return (
      <div className="space-y-5">
        <h4 className="text-sm font-medium text-slate-300">앙상블 전략 설정</h4>

        {/* 프리셋 */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-400">추천 조합 (프리셋)</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ENSEMBLE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedPreset === key
                    ? "border-blue-500 bg-blue-500/20 text-blue-400"
                    : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 서브 전략 선택 */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-400">전략 선택 (2개 이상)</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ENSEMBLE_SUB_STRATEGIES.map((s) => {
              const isSelected = selectedStrategies.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSubStrategy(s.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all ${
                    isSelected
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                  }`}
                >
                  {isSelected ? "✓ " : ""}{s.label}
                </button>
              );
            })}
          </div>
          {selectedStrategies.length > 0 && selectedStrategies.length < 2 && (
            <p className="text-xs text-amber-400">최소 2개 전략을 선택해주세요</p>
          )}
        </div>

        {/* 가중치 슬라이더 */}
        {selectedStrategies.length >= 2 && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-400">전략별 가중치</label>
            {selectedStrategies.map((strat) => {
              const label = ENSEMBLE_SUB_STRATEGIES.find((s) => s.value === strat)?.label || strat;
              const w = weights[strat] ?? 1.0;
              return (
                <div key={strat} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-slate-300 truncate">{label}</span>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={w}
                    onChange={(e) => changeWeight(strat, parseFloat(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="w-10 text-right text-xs font-mono text-slate-400">{w.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 임계값 설정 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="number"
              helperText={field.helperText}
              value={String(config[field.key] ?? field.defaultValue)}
              step="any"
              onChange={(e) => handleFieldChange(field.key, e.target.value, field.type)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-slate-300">
        전략 파라미터 설정
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
            min={field.type === "number" ? "0" : undefined}
            step={field.type === "number" ? "any" : undefined}
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
  // 앙상블 기본값: 균형형 프리셋
  if (strategy === StrategyType.ENSEMBLE) {
    const preset = ENSEMBLE_PRESETS.balanced;
    (config as Record<string, unknown>).strategies = preset.strategies;
    (config as Record<string, unknown>).weights = preset.weights;
  }
  return config;
}
