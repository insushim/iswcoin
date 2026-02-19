import { BaseStrategy, type TradeSignal } from "./base.strategy.js";
import type { OHLCVData } from "../services/indicators.service.js";
import { DCAStrategy } from "./dca.strategy.js";
import { GridStrategy } from "./grid.strategy.js";
import { MomentumStrategy } from "./momentum.strategy.js";
import { MeanReversionStrategy } from "./mean-reversion.strategy.js";
import { TrailingStrategy } from "./trailing.strategy.js";
import { MartingaleStrategy } from "./martingale.strategy.js";
import { StatArbStrategy } from "./stat-arb.strategy.js";
import { ScalpingStrategy } from "./scalping.strategy.js";
import { FundingArbStrategy } from "./funding-arb.strategy.js";
import { DetailedMarketRegime } from "@cryptosentinel/shared";
import {
  marketRegimeService,
  type MarketRegime,
} from "../services/regime.service.js";
import { logger } from "../utils/logger.js";

/**
 * 앙상블 전략: 여러 서브 전략을 병렬 실행하고 가중 투표로 최종 신호 결정
 *
 * - 모든 서브 전략이 독립적으로 분석 실행
 * - 각 전략의 가중치(weight)에 따라 투표
 * - 정규화된 점수가 임계값을 넘으면 매수/매도 신호 생성
 * - 합의 비율이 높을수록 포지션 사이즈 확대
 */
// 레짐별 전략 가중치 곱셈 맵 (최소 0.5로 완화 - 극단적 차단 방지)
const REGIME_WEIGHT_MULTIPLIERS: Record<
  MarketRegime,
  Record<string, number>
> = {
  [DetailedMarketRegime.TRENDING_UP]: {
    MOMENTUM: 1.5,
    TRAILING: 1.3,
    DCA: 1.0,
    MEAN_REVERSION: 0.5,
    GRID: 0.6,
    SCALPING: 0.7,
    STAT_ARB: 0.6,
    MARTINGALE: 0.5,
    FUNDING_ARB: 1.0,
  },
  [DetailedMarketRegime.TRENDING_DOWN]: {
    MOMENTUM: 1.5,
    TRAILING: 1.3,
    DCA: 0.7,
    MEAN_REVERSION: 0.5,
    GRID: 0.6,
    SCALPING: 0.7,
    STAT_ARB: 0.6,
    MARTINGALE: 0.5,
    FUNDING_ARB: 1.0,
  },
  [DetailedMarketRegime.RANGING]: {
    GRID: 1.5,
    MEAN_REVERSION: 1.5,
    STAT_ARB: 1.3,
    MOMENTUM: 0.5,
    TRAILING: 0.6,
    DCA: 1.0,
    SCALPING: 1.0,
    MARTINGALE: 0.8,
    FUNDING_ARB: 1.0,
  },
  [DetailedMarketRegime.VOLATILE]: {
    SCALPING: 1.4,
    GRID: 1.0,
    MARTINGALE: 0.8,
    DCA: 0.7,
    MOMENTUM: 0.7,
    TRAILING: 0.7,
    MEAN_REVERSION: 0.6,
    STAT_ARB: 0.8,
    FUNDING_ARB: 0.5,
  },
  [DetailedMarketRegime.QUIET]: {
    DCA: 1.4,
    STAT_ARB: 1.3,
    GRID: 1.2,
    MEAN_REVERSION: 1.0,
    MOMENTUM: 0.6,
    TRAILING: 0.6,
    SCALPING: 0.5,
    MARTINGALE: 0.6,
    FUNDING_ARB: 1.2,
  },
};

// 전략별 신뢰도 범위 (정규화용)
const CONFIDENCE_RANGES: Record<string, { min: number; max: number }> = {
  DCA: { min: 0.5, max: 0.9 },
  GRID: { min: 0.6, max: 0.7 },
  MOMENTUM: { min: 0.4, max: 0.85 },
  MEAN_REVERSION: { min: 0.4, max: 0.85 },
  TRAILING: { min: 0.4, max: 0.8 },
  MARTINGALE: { min: 0.5, max: 0.9 },
  STAT_ARB: { min: 0.3, max: 0.8 },
  SCALPING: { min: 0.3, max: 0.8 },
  FUNDING_ARB: { min: 0.0, max: 0.95 },
};

export class EnsembleStrategy extends BaseStrategy {
  private subStrategies: Map<string, BaseStrategy> = new Map();

  constructor(config?: Record<string, number>) {
    super("ENSEMBLE", config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      buyThreshold: 0.5,
      sellThreshold: -0.5,
    };
  }

  /**
   * 전략 타입명으로 서브 전략 인스턴스 생성 (캐싱)
   */
  private getSubStrategy(type: string): BaseStrategy | null {
    if (this.subStrategies.has(type)) {
      return this.subStrategies.get(type)!;
    }

    let strategy: BaseStrategy | null = null;
    switch (type) {
      case "DCA":
        strategy = new DCAStrategy();
        break;
      case "GRID":
        strategy = new GridStrategy();
        break;
      case "MOMENTUM":
        strategy = new MomentumStrategy();
        break;
      case "MEAN_REVERSION":
        strategy = new MeanReversionStrategy();
        break;
      case "TRAILING":
        strategy = new TrailingStrategy();
        break;
      case "MARTINGALE":
        strategy = new MartingaleStrategy();
        break;
      case "STAT_ARB":
        strategy = new StatArbStrategy();
        break;
      case "SCALPING":
        strategy = new ScalpingStrategy();
        break;
      case "FUNDING_ARB":
        strategy = new FundingArbStrategy();
        break;
      case "RL_AGENT":
        strategy = new MomentumStrategy();
        break; // RL fallback
    }

    if (strategy) {
      this.subStrategies.set(type, strategy);
    }
    return strategy;
  }

  analyze(
    data: OHLCVData[],
    config?: Record<string, number>,
  ): TradeSignal | null {
    const cfg = config ?? this.config;

    // 앙상블 설정 파싱 (JSON 필드에서 복원)
    const strategies = this.parseStrategies(cfg);
    const weights = this.parseWeights(cfg);
    const buyThreshold = cfg["buyThreshold"] ?? 0.5;
    const sellThreshold = cfg["sellThreshold"] ?? -0.5;

    if (strategies.length < 1 || data.length < 20) return null;

    // 레짐 감지 (가중치 조정용)
    const regimeResult = marketRegimeService.detect(data);
    const regimeMultipliers = REGIME_WEIGHT_MULTIPLIERS[regimeResult.regime];

    // 모든 서브 전략 병렬 분석
    interface SubResult {
      strategy: string;
      signal: TradeSignal | null;
      weight: number;
    }

    const results: SubResult[] = strategies.map((stratType) => {
      const subStrategy = this.getSubStrategy(stratType);
      if (!subStrategy)
        return {
          strategy: stratType,
          signal: null,
          weight: weights[stratType] ?? 1.0,
        };

      const subSignal = subStrategy.analyze(data, cfg);

      // 신뢰도 정규화
      if (subSignal && subSignal.action !== "hold") {
        const range = CONFIDENCE_RANGES[stratType];
        if (range) {
          subSignal.confidence = BaseStrategy.calibrateConfidence(
            subSignal.confidence,
            range.min,
            range.max,
          );
        }
      }

      // 레짐 인식 가중치 적용
      const baseWeight = weights[stratType] ?? 1.0;
      const regimeMultiplier = regimeMultipliers[stratType] ?? 1.0;
      const adjustedWeight = baseWeight * regimeMultiplier;

      return {
        strategy: stratType,
        signal: subSignal,
        weight: adjustedWeight,
      };
    });

    // 투표 집계
    let buyVotes = 0;
    let sellVotes = 0;
    let buyCount = 0;
    let sellCount = 0;
    let maxBuyConfidence = 0;
    let maxSellConfidence = 0;
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    for (const { strategy, signal, weight } of results) {
      if (!signal || signal.action === "hold") continue;

      if (signal.action === "buy") {
        buyVotes += weight;
        buyCount++;
        maxBuyConfidence = Math.max(maxBuyConfidence, signal.confidence);
        buyReasons.push(`${strategy}(w${weight.toFixed(1)})`);
      } else if (signal.action === "sell") {
        sellVotes += weight;
        sellCount++;
        maxSellConfidence = Math.max(maxSellConfidence, signal.confidence);
        sellReasons.push(`${strategy}(w${weight.toFixed(1)})`);
      }
    }

    const totalWeight = strategies.reduce((sum, s) => {
      const base = weights[s] ?? 1.0;
      const rm = regimeMultipliers[s] ?? 1.0;
      return sum + base * rm;
    }, 0);
    const normalizedBuy =
      totalWeight > 0 ? (buyVotes / totalWeight) * strategies.length : buyVotes;
    const normalizedSell =
      totalWeight > 0
        ? (-sellVotes / totalWeight) * strategies.length
        : -sellVotes;

    const currentPrice = data[data.length - 1]!.close;
    const buyConsensus =
      strategies.length > 0 ? buyCount / strategies.length : 0;
    const sellConsensus =
      strategies.length > 0 ? sellCount / strategies.length : 0;

    // 진단 로깅: 투표 현황
    logger.debug("Ensemble vote summary", {
      regime: regimeResult.regime,
      strategies: strategies.join(","),
      buyVotes: buyVotes.toFixed(2),
      sellVotes: sellVotes.toFixed(2),
      totalWeight: totalWeight.toFixed(2),
      normalizedBuy: normalizedBuy.toFixed(2),
      normalizedSell: normalizedSell.toFixed(2),
      buyThreshold,
      sellThreshold,
      buyReasons: buyReasons.join("; "),
      sellReasons: sellReasons.join("; "),
      subResults: results.map((r) => ({
        s: r.strategy,
        action: r.signal?.action ?? "none",
        w: r.weight.toFixed(2),
        conf: r.signal?.confidence?.toFixed(2) ?? "-",
      })),
    });

    // 매수 신호
    if (normalizedBuy >= buyThreshold) {
      const confidence = Math.min(
        0.95,
        0.4 + buyConsensus * 0.35 + (normalizedBuy - buyThreshold) * 0.1,
      );

      // StopLoss/TakeProfit: 서브 전략 중 가장 좋은 값 사용
      let stopLoss: number | undefined;
      let takeProfit: number | undefined;
      for (const { signal } of results) {
        if (signal?.action === "buy") {
          if (signal.stopLoss && (!stopLoss || signal.stopLoss > stopLoss)) {
            stopLoss = signal.stopLoss; // 가장 타이트한 SL
          }
          if (
            signal.takeProfit &&
            (!takeProfit || signal.takeProfit < takeProfit)
          ) {
            takeProfit = signal.takeProfit; // 가장 보수적인 TP
          }
        }
      }

      // Fallback SL/TP
      if (!stopLoss) stopLoss = currentPrice * 0.97;
      if (!takeProfit) takeProfit = currentPrice * 1.06;

      return {
        action: "buy",
        confidence,
        reason: `앙상블 매수 [${regimeResult.regime}] (${buyReasons.join(", ")}, 점수 ${normalizedBuy.toFixed(1)}, 합의 ${(buyConsensus * 100).toFixed(0)}%)`,
        price: currentPrice,
        stopLoss,
        takeProfit,
        metadata: {
          regime: regimeResult.regime,
          regimeConfidence: String(regimeResult.confidence),
        },
      };
    }

    // 매도 신호
    if (normalizedSell <= sellThreshold) {
      const hasPosition = (cfg["_hasPosition"] ?? 0) > 0;
      if (!hasPosition) return null;

      const confidence = Math.min(
        0.95,
        0.4 +
          sellConsensus * 0.35 +
          (Math.abs(normalizedSell) - Math.abs(sellThreshold)) * 0.1,
      );

      return {
        action: "sell",
        confidence,
        reason: `앙상블 매도 [${regimeResult.regime}] (${sellReasons.join(", ")}, 점수 ${normalizedSell.toFixed(1)}, 합의 ${(sellConsensus * 100).toFixed(0)}%)`,
        price: currentPrice,
        metadata: {
          regime: regimeResult.regime,
          regimeConfidence: String(regimeResult.confidence),
        },
      };
    }

    return null;
  }

  /**
   * config에서 strategies 배열 파싱
   * DB에서는 JSON으로 저장되므로 여러 형태 대응
   */
  private parseStrategies(cfg: Record<string, number>): string[] {
    const raw = (cfg as unknown as Record<string, unknown>)["strategies"];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === "string") {
      // JSON 배열 파싱 시도, 실패 시 쉼표 구분 문자열로 처리
      try {
        return JSON.parse(raw);
      } catch {
        return raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  /**
   * config에서 weights 객체 파싱
   * - weights 키가 있으면 그것을 사용
   * - 없으면 개별 전략명 키(DCA, GRID 등)를 weight로 사용
   */
  private parseWeights(cfg: Record<string, number>): Record<string, number> {
    const raw = (cfg as unknown as Record<string, unknown>)["weights"];
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      return raw as Record<string, number>;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        /* fall through */
      }
    }

    // fallback: 개별 전략명 키에서 weight 추출 (DCA: 0.8, GRID: 0.9 등)
    const STRATEGY_NAMES = [
      "DCA",
      "GRID",
      "MOMENTUM",
      "MEAN_REVERSION",
      "TRAILING",
      "MARTINGALE",
      "STAT_ARB",
      "SCALPING",
      "FUNDING_ARB",
      "RL_AGENT",
    ];
    const weights: Record<string, number> = {};
    for (const name of STRATEGY_NAMES) {
      if (typeof cfg[name] === "number") {
        weights[name] = cfg[name];
      }
    }
    return weights;
  }
}
