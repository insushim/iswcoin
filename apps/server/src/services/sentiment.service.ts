import { logger } from '../utils/logger.js';

export interface FearGreedData {
  value: number;
  valueClassification: string;
  timestamp: number;
}

export interface SentimentResult {
  fearGreed: FearGreedData | null;
  whaleActivity: WhaleActivityData | null;
  overallScore: number;
  interpretation: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
}

export interface WhaleActivityData {
  largeTxCount24h: number;
  netFlow: number;
  dominantDirection: 'inflow' | 'outflow' | 'neutral';
  lastUpdated: number;
}

export class SentimentService {
  private fearGreedCache: { data: FearGreedData | null; expiry: number } = {
    data: null,
    expiry: 0,
  };

  private readonly CACHE_DURATION = 10 * 60 * 1000;

  async getFearGreedIndex(): Promise<FearGreedData | null> {
    if (this.fearGreedCache.data && Date.now() < this.fearGreedCache.expiry) {
      return this.fearGreedCache.data;
    }

    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=1&format=json');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as {
        data: Array<{
          value: string;
          value_classification: string;
          timestamp: string;
        }>;
      };

      if (!json.data || json.data.length === 0) {
        logger.warn('Fear & Greed API returned empty data');
        return null;
      }

      const entry = json.data[0]!;
      const result: FearGreedData = {
        value: parseInt(entry.value, 10),
        valueClassification: entry.value_classification,
        timestamp: parseInt(entry.timestamp, 10) * 1000,
      };

      this.fearGreedCache = {
        data: result,
        expiry: Date.now() + this.CACHE_DURATION,
      };

      logger.info('Fear & Greed Index fetched', {
        value: result.value,
        classification: result.valueClassification,
      });

      return result;
    } catch (err) {
      logger.error('Failed to fetch Fear & Greed Index', { error: String(err) });
      return this.fearGreedCache.data;
    }
  }

  async getWhaleActivity(): Promise<WhaleActivityData> {
    const simulatedData: WhaleActivityData = {
      largeTxCount24h: Math.floor(Math.random() * 50) + 10,
      netFlow: (Math.random() - 0.5) * 10000,
      dominantDirection: 'neutral',
      lastUpdated: Date.now(),
    };

    if (simulatedData.netFlow > 2000) {
      simulatedData.dominantDirection = 'inflow';
    } else if (simulatedData.netFlow < -2000) {
      simulatedData.dominantDirection = 'outflow';
    }

    logger.debug('Whale activity data generated', simulatedData);
    return simulatedData;
  }

  async aggregateSentiment(): Promise<SentimentResult> {
    const [fearGreed, whaleActivity] = await Promise.all([
      this.getFearGreedIndex(),
      this.getWhaleActivity(),
    ]);

    let overallScore = 50;

    if (fearGreed) {
      overallScore = fearGreed.value * 0.7;
    }

    if (whaleActivity) {
      const whaleScore = whaleActivity.dominantDirection === 'inflow'
        ? 60
        : whaleActivity.dominantDirection === 'outflow'
          ? 40
          : 50;
      overallScore += whaleScore * 0.3;
    }

    overallScore = Math.round(Math.max(0, Math.min(100, overallScore)));

    let interpretation: SentimentResult['interpretation'];
    if (overallScore <= 20) {
      interpretation = 'extreme_fear';
    } else if (overallScore <= 40) {
      interpretation = 'fear';
    } else if (overallScore <= 60) {
      interpretation = 'neutral';
    } else if (overallScore <= 80) {
      interpretation = 'greed';
    } else {
      interpretation = 'extreme_greed';
    }

    return {
      fearGreed,
      whaleActivity,
      overallScore,
      interpretation,
    };
  }
}

export const sentimentService = new SentimentService();
