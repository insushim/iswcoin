import { logger } from '../utils/logger.js';

export interface ExchangeFlowData {
  netFlow: number;
  inflow: number;
  outflow: number;
  exchange: string;
  timestamp: number;
}

export interface MVRVData {
  mvrv: number;
  marketCap: number;
  realizedCap: number;
  zone: 'undervalued' | 'fair' | 'overvalued' | 'extreme';
  timestamp: number;
}

export interface FundingRateData {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  predictedRate: number;
  annualizedRate: number;
}

export interface TVLData {
  totalTVL: number;
  change24h: number;
  topProtocols: { name: string; tvl: number; change24h: number }[];
  timestamp: number;
}

export class OnchainAnalyticsService {
  async getExchangeFlow(): Promise<ExchangeFlowData[]> {
    logger.debug('Fetching exchange flow data (placeholder)');

    const exchanges = ['binance', 'coinbase', 'kraken', 'bybit'];
    const timestamp = Date.now();

    return exchanges.map((exchange) => {
      const inflow = Math.random() * 5000 + 500;
      const outflow = Math.random() * 5000 + 500;
      return {
        exchange,
        inflow,
        outflow,
        netFlow: inflow - outflow,
        timestamp,
      };
    });
  }

  async getMVRV(): Promise<MVRVData> {
    logger.debug('Fetching MVRV data (placeholder)');

    const mvrv = 1.5 + Math.random() * 2;
    const marketCap = 1_000_000_000_000 + Math.random() * 500_000_000_000;
    const realizedCap = marketCap / mvrv;

    let zone: MVRVData['zone'] = 'fair';
    if (mvrv < 1) {
      zone = 'undervalued';
    } else if (mvrv > 3.5) {
      zone = 'extreme';
    } else if (mvrv > 2.5) {
      zone = 'overvalued';
    }

    return {
      mvrv,
      marketCap,
      realizedCap,
      zone,
      timestamp: Date.now(),
    };
  }

  async getFundingRate(symbol: string): Promise<FundingRateData> {
    logger.debug('Fetching funding rate', { symbol });

    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.replace('/', '')}&limit=1`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as Array<{
        symbol: string;
        fundingRate: string;
        fundingTime: number;
      }>;

      if (data.length === 0) {
        return this.getDefaultFundingRate(symbol);
      }

      const entry = data[0]!;
      const rate = parseFloat(entry.fundingRate);

      return {
        symbol,
        fundingRate: rate,
        nextFundingTime: entry.fundingTime,
        predictedRate: rate * (1 + (Math.random() - 0.5) * 0.2),
        annualizedRate: rate * 3 * 365 * 100,
      };
    } catch (err) {
      logger.warn('Failed to fetch funding rate from Binance', { symbol, error: String(err) });
      return this.getDefaultFundingRate(symbol);
    }
  }

  private getDefaultFundingRate(symbol: string): FundingRateData {
    const rate = (Math.random() - 0.3) * 0.002;
    return {
      symbol,
      fundingRate: rate,
      nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
      predictedRate: rate * (1 + (Math.random() - 0.5) * 0.1),
      annualizedRate: rate * 3 * 365 * 100,
    };
  }

  async getTVL(): Promise<TVLData> {
    logger.debug('Fetching TVL data (placeholder)');

    const protocols = [
      { name: 'Lido', tvl: 28_000_000_000, change24h: 1.2 },
      { name: 'Aave', tvl: 12_000_000_000, change24h: -0.5 },
      { name: 'MakerDAO', tvl: 8_000_000_000, change24h: 0.8 },
      { name: 'Uniswap', tvl: 5_000_000_000, change24h: 2.1 },
      { name: 'Curve', tvl: 4_500_000_000, change24h: -1.3 },
    ];

    const totalTVL = protocols.reduce((sum, p) => sum + p.tvl, 0);
    const weightedChange = protocols.reduce(
      (sum, p) => sum + p.tvl * p.change24h,
      0
    ) / totalTVL;

    return {
      totalTVL,
      change24h: weightedChange,
      topProtocols: protocols,
      timestamp: Date.now(),
    };
  }

  async getGasPrice(): Promise<{ slow: number; standard: number; fast: number }> {
    try {
      const response = await fetch('https://api.etherscan.io/api?module=gastracker&action=gasoracle', {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        result: {
          SafeGasPrice: string;
          ProposeGasPrice: string;
          FastGasPrice: string;
        };
      };

      return {
        slow: parseInt(data.result.SafeGasPrice, 10),
        standard: parseInt(data.result.ProposeGasPrice, 10),
        fast: parseInt(data.result.FastGasPrice, 10),
      };
    } catch (err) {
      logger.warn('Failed to fetch gas price', { error: String(err) });
      return { slow: 20, standard: 30, fast: 50 };
    }
  }
}

export const onchainAnalyticsService = new OnchainAnalyticsService();
