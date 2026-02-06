import { BaseStrategy } from './base.strategy.js';
import { DCAStrategy } from './dca.strategy.js';
import { GridStrategy } from './grid.strategy.js';
import { MomentumStrategy } from './momentum.strategy.js';
import { MeanReversionStrategy } from './mean-reversion.strategy.js';
import { TrailingStrategy } from './trailing.strategy.js';
import { MartingaleStrategy } from './martingale.strategy.js';

export { BaseStrategy } from './base.strategy.js';
export type { TradeSignal, TradeAction } from './base.strategy.js';
export { DCAStrategy } from './dca.strategy.js';
export { GridStrategy } from './grid.strategy.js';
export { MomentumStrategy } from './momentum.strategy.js';
export { MeanReversionStrategy } from './mean-reversion.strategy.js';
export { TrailingStrategy } from './trailing.strategy.js';
export { MartingaleStrategy } from './martingale.strategy.js';

export type StrategyType =
  | 'DCA'
  | 'GRID'
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'TRAILING'
  | 'MARTINGALE'
  | 'RL_AGENT';

export function getStrategy(
  type: StrategyType,
  config?: Record<string, number>
): BaseStrategy {
  switch (type) {
    case 'DCA':
      return new DCAStrategy(config);
    case 'GRID':
      return new GridStrategy(config);
    case 'MOMENTUM':
      return new MomentumStrategy(config);
    case 'MEAN_REVERSION':
      return new MeanReversionStrategy(config);
    case 'TRAILING':
      return new TrailingStrategy(config);
    case 'MARTINGALE':
      return new MartingaleStrategy(config);
    case 'RL_AGENT':
      return new MomentumStrategy(config);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown strategy type: ${String(_exhaustive)}`);
    }
  }
}

export function getAvailableStrategies(): {
  type: StrategyType;
  name: string;
  defaultConfig: Record<string, number>;
}[] {
  const strategies: StrategyType[] = [
    'DCA',
    'GRID',
    'MOMENTUM',
    'MEAN_REVERSION',
    'TRAILING',
    'MARTINGALE',
  ];

  return strategies.map((type) => {
    const strategy = getStrategy(type);
    return {
      type,
      name: strategy.getName(),
      defaultConfig: strategy.getDefaultConfig(),
    };
  });
}
