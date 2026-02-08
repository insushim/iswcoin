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
