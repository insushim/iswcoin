import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';
import { DCAStrategy } from './dca.strategy.js';
import { GridStrategy } from './grid.strategy.js';
import { MomentumStrategy } from './momentum.strategy.js';
import { MeanReversionStrategy } from './mean-reversion.strategy.js';
import { TrailingStrategy } from './trailing.strategy.js';
import { MartingaleStrategy } from './martingale.strategy.js';
import { StatArbStrategy } from './stat-arb.strategy.js';
import { ScalpingStrategy } from './scalping.strategy.js';
import { FundingArbStrategy } from './funding-arb.strategy.js';

/**
 * 앙상블 전략: 여러 서브 전략을 병렬 실행하고 가중 투표로 최종 신호 결정
 *
 * - 모든 서브 전략이 독립적으로 분석 실행
 * - 각 전략의 가중치(weight)에 따라 투표
 * - 정규화된 점수가 임계값을 넘으면 매수/매도 신호 생성
 * - 합의 비율이 높을수록 포지션 사이즈 확대
 */
export class EnsembleStrategy extends BaseStrategy {
  private subStrategies: Map<string, BaseStrategy> = new Map();

  constructor(config?: Record<string, number>) {
    super('ENSEMBLE', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      buyThreshold: 1.2,
      sellThreshold: -1.2,
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
      case 'DCA': strategy = new DCAStrategy(); break;
      case 'GRID': strategy = new GridStrategy(); break;
      case 'MOMENTUM': strategy = new MomentumStrategy(); break;
      case 'MEAN_REVERSION': strategy = new MeanReversionStrategy(); break;
      case 'TRAILING': strategy = new TrailingStrategy(); break;
      case 'MARTINGALE': strategy = new MartingaleStrategy(); break;
      case 'STAT_ARB': strategy = new StatArbStrategy(); break;
      case 'SCALPING': strategy = new ScalpingStrategy(); break;
      case 'FUNDING_ARB': strategy = new FundingArbStrategy(); break;
      case 'RL_AGENT': strategy = new MomentumStrategy(); break; // RL fallback
    }

    if (strategy) {
      this.subStrategies.set(type, strategy);
    }
    return strategy;
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;

    // 앙상블 설정 파싱 (JSON 필드에서 복원)
    const strategies = this.parseStrategies(cfg);
    const weights = this.parseWeights(cfg);
    const buyThreshold = cfg['buyThreshold'] ?? 1.2;
    const sellThreshold = cfg['sellThreshold'] ?? -1.2;

    if (strategies.length < 2 || data.length < 20) return null;

    // 모든 서브 전략 병렬 분석
    interface SubResult {
      strategy: string;
      signal: TradeSignal | null;
      weight: number;
    }

    const results: SubResult[] = strategies.map(stratType => {
      const subStrategy = this.getSubStrategy(stratType);
      if (!subStrategy) return { strategy: stratType, signal: null, weight: weights[stratType] ?? 1.0 };

      const subSignal = subStrategy.analyze(data, cfg);
      return {
        strategy: stratType,
        signal: subSignal,
        weight: weights[stratType] ?? 1.0,
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
      if (!signal || signal.action === 'hold') continue;

      if (signal.action === 'buy') {
        buyVotes += weight;
        buyCount++;
        maxBuyConfidence = Math.max(maxBuyConfidence, signal.confidence);
        buyReasons.push(`${strategy}(w${weight.toFixed(1)})`);
      } else if (signal.action === 'sell') {
        sellVotes += weight;
        sellCount++;
        maxSellConfidence = Math.max(maxSellConfidence, signal.confidence);
        sellReasons.push(`${strategy}(w${weight.toFixed(1)})`);
      }
    }

    const totalWeight = strategies.reduce((sum, s) => sum + (weights[s] ?? 1.0), 0);
    const normalizedBuy = totalWeight > 0 ? (buyVotes / totalWeight) * strategies.length : buyVotes;
    const normalizedSell = totalWeight > 0 ? (-sellVotes / totalWeight) * strategies.length : -sellVotes;

    const currentPrice = data[data.length - 1]!.close;
    const buyConsensus = strategies.length > 0 ? buyCount / strategies.length : 0;
    const sellConsensus = strategies.length > 0 ? sellCount / strategies.length : 0;

    // 매수 신호
    if (normalizedBuy >= buyThreshold) {
      const confidence = Math.min(0.95, 0.4 + buyConsensus * 0.35 + (normalizedBuy - buyThreshold) * 0.1);

      // StopLoss/TakeProfit: 서브 전략 중 가장 좋은 값 사용
      let stopLoss: number | undefined;
      let takeProfit: number | undefined;
      for (const { signal } of results) {
        if (signal?.action === 'buy') {
          if (signal.stopLoss && (!stopLoss || signal.stopLoss > stopLoss)) {
            stopLoss = signal.stopLoss; // 가장 타이트한 SL
          }
          if (signal.takeProfit && (!takeProfit || signal.takeProfit < takeProfit)) {
            takeProfit = signal.takeProfit; // 가장 보수적인 TP
          }
        }
      }

      // Fallback SL/TP
      if (!stopLoss) stopLoss = currentPrice * 0.97;
      if (!takeProfit) takeProfit = currentPrice * 1.06;

      return {
        action: 'buy',
        confidence,
        reason: `앙상블 매수 (${buyReasons.join(', ')}, 점수 ${normalizedBuy.toFixed(1)}, 합의 ${(buyConsensus * 100).toFixed(0)}%)`,
        price: currentPrice,
        stopLoss,
        takeProfit,
      };
    }

    // 매도 신호
    if (normalizedSell <= sellThreshold) {
      const hasPosition = (cfg['_hasPosition'] ?? 0) > 0;
      if (!hasPosition) return null;

      const confidence = Math.min(0.95, 0.4 + sellConsensus * 0.35 + (Math.abs(normalizedSell) - Math.abs(sellThreshold)) * 0.1);

      return {
        action: 'sell',
        confidence,
        reason: `앙상블 매도 (${sellReasons.join(', ')}, 점수 ${normalizedSell.toFixed(1)}, 합의 ${(sellConsensus * 100).toFixed(0)}%)`,
        price: currentPrice,
      };
    }

    return null;
  }

  /**
   * config에서 strategies 배열 파싱
   * DB에서는 JSON으로 저장되므로 여러 형태 대응
   */
  private parseStrategies(cfg: Record<string, number>): string[] {
    const raw = (cfg as unknown as Record<string, unknown>)['strategies'];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return [];
  }

  /**
   * config에서 weights 객체 파싱
   */
  private parseWeights(cfg: Record<string, number>): Record<string, number> {
    const raw = (cfg as unknown as Record<string, unknown>)['weights'];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, number>;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return {};
  }
}
