import { logger } from '../utils/logger.js';

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface ImbalanceResult {
  bidVolume: number;
  askVolume: number;
  imbalanceRatio: number;
  direction: 'buy_pressure' | 'sell_pressure' | 'balanced';
  topBidWall: OrderBookLevel | null;
  topAskWall: OrderBookLevel | null;
}

export interface WallDetection {
  price: number;
  amount: number;
  side: 'bid' | 'ask';
  relativeSize: number;
}

export interface VPINResult {
  vpin: number;
  bucketSize: number;
  totalBuckets: number;
  toxicityLevel: 'low' | 'medium' | 'high';
}

export interface TradeRecord {
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export class OrderBookAnalysisService {
  calculateImbalance(
    bids: [number, number][],
    asks: [number, number][]
  ): ImbalanceResult {
    if (bids.length === 0 && asks.length === 0) {
      return {
        bidVolume: 0,
        askVolume: 0,
        imbalanceRatio: 0,
        direction: 'balanced',
        topBidWall: null,
        topAskWall: null,
      };
    }

    const bidVolume = bids.reduce((sum, [, amount]) => sum + amount, 0);
    const askVolume = asks.reduce((sum, [, amount]) => sum + amount, 0);
    const totalVolume = bidVolume + askVolume;

    const imbalanceRatio = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

    let direction: ImbalanceResult['direction'] = 'balanced';
    if (imbalanceRatio > 0.2) {
      direction = 'buy_pressure';
    } else if (imbalanceRatio < -0.2) {
      direction = 'sell_pressure';
    }

    let topBidWall: OrderBookLevel | null = null;
    let maxBidAmount = 0;
    for (const [price, amount] of bids) {
      if (amount > maxBidAmount) {
        maxBidAmount = amount;
        topBidWall = { price, amount };
      }
    }

    let topAskWall: OrderBookLevel | null = null;
    let maxAskAmount = 0;
    for (const [price, amount] of asks) {
      if (amount > maxAskAmount) {
        maxAskAmount = amount;
        topAskWall = { price, amount };
      }
    }

    logger.debug('Order book imbalance calculated', {
      bidVolume: bidVolume.toFixed(4),
      askVolume: askVolume.toFixed(4),
      imbalanceRatio: imbalanceRatio.toFixed(4),
      direction,
    });

    return {
      bidVolume,
      askVolume,
      imbalanceRatio,
      direction,
      topBidWall,
      topAskWall,
    };
  }

  detectWalls(
    bids: [number, number][],
    asks: [number, number][],
    threshold: number = 3
  ): WallDetection[] {
    const walls: WallDetection[] = [];

    const bidAmounts = bids.map(([, a]) => a);
    const askAmounts = asks.map(([, a]) => a);

    const avgBidSize = bidAmounts.length > 0
      ? bidAmounts.reduce((a, b) => a + b, 0) / bidAmounts.length
      : 0;
    const avgAskSize = askAmounts.length > 0
      ? askAmounts.reduce((a, b) => a + b, 0) / askAmounts.length
      : 0;

    for (const [price, amount] of bids) {
      if (avgBidSize > 0 && amount >= avgBidSize * threshold) {
        walls.push({
          price,
          amount,
          side: 'bid',
          relativeSize: amount / avgBidSize,
        });
      }
    }

    for (const [price, amount] of asks) {
      if (avgAskSize > 0 && amount >= avgAskSize * threshold) {
        walls.push({
          price,
          amount,
          side: 'ask',
          relativeSize: amount / avgAskSize,
        });
      }
    }

    walls.sort((a, b) => b.relativeSize - a.relativeSize);

    logger.debug('Walls detected', { count: walls.length, threshold });

    return walls;
  }

  calculateVPIN(trades: TradeRecord[], bucketVolume: number = 1000): VPINResult {
    if (trades.length === 0) {
      return { vpin: 0, bucketSize: bucketVolume, totalBuckets: 0, toxicityLevel: 'low' };
    }

    const buckets: { buyVolume: number; sellVolume: number }[] = [];
    let currentBucket = { buyVolume: 0, sellVolume: 0 };
    let currentBucketVolume = 0;

    for (const trade of trades) {
      const remaining = trade.amount;

      if (trade.side === 'buy') {
        currentBucket.buyVolume += remaining;
      } else {
        currentBucket.sellVolume += remaining;
      }

      currentBucketVolume += remaining;

      if (currentBucketVolume >= bucketVolume) {
        buckets.push({ ...currentBucket });
        currentBucket = { buyVolume: 0, sellVolume: 0 };
        currentBucketVolume = 0;
      }
    }

    if (currentBucketVolume > 0) {
      buckets.push({ ...currentBucket });
    }

    if (buckets.length === 0) {
      return { vpin: 0, bucketSize: bucketVolume, totalBuckets: 0, toxicityLevel: 'low' };
    }

    const n = Math.min(50, buckets.length);
    const recentBuckets = buckets.slice(-n);

    const totalOrderImbalance = recentBuckets.reduce(
      (sum, b) => sum + Math.abs(b.buyVolume - b.sellVolume),
      0
    );
    const totalVolume = recentBuckets.reduce(
      (sum, b) => sum + b.buyVolume + b.sellVolume,
      0
    );

    const vpin = totalVolume > 0 ? totalOrderImbalance / totalVolume : 0;

    let toxicityLevel: VPINResult['toxicityLevel'] = 'low';
    if (vpin > 0.7) {
      toxicityLevel = 'high';
    } else if (vpin > 0.4) {
      toxicityLevel = 'medium';
    }

    return {
      vpin,
      bucketSize: bucketVolume,
      totalBuckets: buckets.length,
      toxicityLevel,
    };
  }

  getCVD(trades: TradeRecord[]): { timestamp: number; cvd: number }[] {
    if (trades.length === 0) {
      return [];
    }

    let cumulativeDelta = 0;
    const result: { timestamp: number; cvd: number }[] = [];

    for (const trade of trades) {
      const signedVolume = trade.side === 'buy'
        ? trade.amount * trade.price
        : -(trade.amount * trade.price);

      cumulativeDelta += signedVolume;
      result.push({
        timestamp: trade.timestamp,
        cvd: cumulativeDelta,
      });
    }

    return result;
  }
}

export const orderBookAnalysisService = new OrderBookAnalysisService();
