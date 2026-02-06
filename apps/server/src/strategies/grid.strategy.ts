import { BaseStrategy, type TradeSignal } from './base.strategy.js';
import type { OHLCVData } from '../services/indicators.service.js';

interface GridLevel {
  price: number;
  type: 'buy' | 'sell';
  filled: boolean;
}

export class GridStrategy extends BaseStrategy {
  private gridLevels: GridLevel[] = [];
  private lastGridSetup: number = 0;

  constructor(config?: Record<string, number>) {
    super('GRID', config);
  }

  getDefaultConfig(): Record<string, number> {
    return {
      gridCount: 10,
      rangeTopPct: 10,
      rangeBottomPct: 10,
      gridSpacingPct: 2,
      positionSizePct: 10,
      rebalanceIntervalCandles: 100,
    };
  }

  analyze(data: OHLCVData[], config?: Record<string, number>): TradeSignal | null {
    const cfg = config ?? this.config;
    const gridCount = cfg['gridCount'] ?? 10;
    const rangeTopPct = cfg['rangeTopPct'] ?? 10;
    const rangeBottomPct = cfg['rangeBottomPct'] ?? 10;
    const rebalanceInterval = cfg['rebalanceIntervalCandles'] ?? 100;

    if (data.length < 20) {
      return null;
    }

    const currentCandle = data[data.length - 1]!;
    const currentPrice = currentCandle.close;

    const shouldSetupGrid =
      this.gridLevels.length === 0 ||
      data.length - this.lastGridSetup >= rebalanceInterval;

    if (shouldSetupGrid) {
      this.setupGrid(currentPrice, gridCount, rangeTopPct, rangeBottomPct);
      this.lastGridSetup = data.length;
    }

    let bestBuyLevel: GridLevel | null = null;
    let bestSellLevel: GridLevel | null = null;

    for (const level of this.gridLevels) {
      if (level.filled) continue;

      if (level.type === 'buy' && currentPrice <= level.price) {
        if (!bestBuyLevel || level.price > bestBuyLevel.price) {
          bestBuyLevel = level;
        }
      }

      if (level.type === 'sell' && currentPrice >= level.price) {
        if (!bestSellLevel || level.price < bestSellLevel.price) {
          bestSellLevel = level;
        }
      }
    }

    if (bestBuyLevel) {
      bestBuyLevel.filled = true;
      this.resetAdjacentSellLevel(bestBuyLevel.price);

      return {
        action: 'buy',
        confidence: 0.65,
        reason: `Grid buy at level ${bestBuyLevel.price.toFixed(2)}`,
        price: currentPrice,
        stopLoss: this.getLowestGridPrice() * 0.95,
        takeProfit: bestBuyLevel.price * (1 + (rangeTopPct / gridCount / 100)),
        metadata: {
          gridLevel: bestBuyLevel.price,
          gridType: 'buy',
          activeLevels: this.gridLevels.filter((l) => !l.filled).length,
        },
      };
    }

    if (bestSellLevel) {
      bestSellLevel.filled = true;
      this.resetAdjacentBuyLevel(bestSellLevel.price);

      return {
        action: 'sell',
        confidence: 0.65,
        reason: `Grid sell at level ${bestSellLevel.price.toFixed(2)}`,
        price: currentPrice,
        metadata: {
          gridLevel: bestSellLevel.price,
          gridType: 'sell',
          activeLevels: this.gridLevels.filter((l) => !l.filled).length,
        },
      };
    }

    return null;
  }

  private setupGrid(
    centerPrice: number,
    gridCount: number,
    rangeTopPct: number,
    rangeBottomPct: number
  ): void {
    this.gridLevels = [];

    const topPrice = centerPrice * (1 + rangeTopPct / 100);
    const bottomPrice = centerPrice * (1 - rangeBottomPct / 100);
    const step = (topPrice - bottomPrice) / gridCount;

    for (let i = 0; i <= gridCount; i++) {
      const price = bottomPrice + step * i;
      const type = price < centerPrice ? 'buy' : 'sell';

      this.gridLevels.push({
        price: Math.round(price * 100) / 100,
        type,
        filled: false,
      });
    }
  }

  private getLowestGridPrice(): number {
    if (this.gridLevels.length === 0) return 0;
    return Math.min(...this.gridLevels.map((l) => l.price));
  }

  private resetAdjacentSellLevel(buyPrice: number): void {
    const sortedLevels = [...this.gridLevels].sort((a, b) => a.price - b.price);
    const buyIndex = sortedLevels.findIndex((l) => l.price === buyPrice);

    if (buyIndex >= 0 && buyIndex < sortedLevels.length - 1) {
      const nextLevel = sortedLevels[buyIndex + 1];
      if (nextLevel && nextLevel.type === 'sell') {
        nextLevel.filled = false;
      }
    }
  }

  private resetAdjacentBuyLevel(sellPrice: number): void {
    const sortedLevels = [...this.gridLevels].sort((a, b) => a.price - b.price);
    const sellIndex = sortedLevels.findIndex((l) => l.price === sellPrice);

    if (sellIndex > 0) {
      const prevLevel = sortedLevels[sellIndex - 1];
      if (prevLevel && prevLevel.type === 'buy') {
        prevLevel.filled = false;
      }
    }
  }
}
