import type { OHLCVData } from '../services/indicators.service.js';

export type TradeAction = 'buy' | 'sell' | 'hold';

export interface TradeSignal {
  action: TradeAction;
  confidence: number;
  reason: string;
  price: number;
  stopLoss?: number;
  takeProfit?: number;
  metadata?: Record<string, number | string>;
}

export abstract class BaseStrategy {
  protected name: string;
  protected config: Record<string, number>;

  constructor(name: string, config?: Record<string, number>) {
    this.name = name;
    this.config = config ?? this.getDefaultConfig();
  }

  abstract analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null;

  abstract getDefaultConfig(): Record<string, number>;

  getName(): string {
    return this.name;
  }

  getConfig(): Record<string, number> {
    return { ...this.config };
  }

  updateConfig(updates: Record<string, number>): void {
    this.config = { ...this.config, ...updates };
  }

  protected getLastN<T>(arr: T[], n: number): T[] {
    return arr.slice(Math.max(0, arr.length - n));
  }

  protected crossedAbove(current: number, previous: number, level: number): boolean {
    return previous <= level && current > level;
  }

  protected crossedBelow(current: number, previous: number, level: number): boolean {
    return previous >= level && current < level;
  }
}
