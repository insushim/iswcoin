import { logger } from '../utils/logger.js';
import { indicatorsService, type OHLCVData } from './indicators.service.js';
import type { TradeSignal } from '../strategies/base.strategy.js';

export interface BacktestConfig {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  strategy: string;
  strategyConfig: Record<string, number>;
  slippagePct: number;
  feePct: number;
  walkForwardSplit: number;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  fee: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPct: number;
  annualizedReturn: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  avgHoldTime: number;
  expectancy: number;
  calmarRatio: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { timestamp: number; equity: number }[];
  drawdownCurve: { timestamp: number; drawdown: number }[];
  inSampleMetrics: BacktestMetrics | null;
  outOfSampleMetrics: BacktestMetrics | null;
}

type AnalyzeFunction = (data: OHLCVData[], config: Record<string, number>) => TradeSignal | null;

export class BacktesterService {
  private readonly DEFAULT_SLIPPAGE = 0.0005;
  private readonly DEFAULT_FEE = 0.001;

  async runBacktest(
    config: BacktestConfig,
    ohlcvData: OHLCVData[],
    analyzeFn: AnalyzeFunction
  ): Promise<BacktestResult> {
    logger.info('Starting backtest', {
      symbol: config.symbol,
      strategy: config.strategy,
      dataPoints: ohlcvData.length,
    });

    const slippage = config.slippagePct || this.DEFAULT_SLIPPAGE;
    const fee = config.feePct || this.DEFAULT_FEE;

    const splitIndex = Math.floor(ohlcvData.length * (config.walkForwardSplit || 0.7));
    const inSampleData = ohlcvData.slice(0, splitIndex);
    const outOfSampleData = ohlcvData.slice(splitIndex);

    const fullResult = this.executeBacktest(ohlcvData, config, analyzeFn, slippage, fee);

    let inSampleMetrics: BacktestMetrics | null = null;
    let outOfSampleMetrics: BacktestMetrics | null = null;

    if (inSampleData.length > 50 && outOfSampleData.length > 20) {
      const inSampleResult = this.executeBacktest(inSampleData, config, analyzeFn, slippage, fee);
      const outOfSampleResult = this.executeBacktest(outOfSampleData, config, analyzeFn, slippage, fee);
      inSampleMetrics = inSampleResult.metrics;
      outOfSampleMetrics = outOfSampleResult.metrics;
    }

    logger.info('Backtest completed', {
      totalReturn: fullResult.metrics.totalReturnPct.toFixed(2) + '%',
      trades: fullResult.metrics.totalTrades,
      winRate: fullResult.metrics.winRate.toFixed(2) + '%',
      sharpe: fullResult.metrics.sharpeRatio.toFixed(2),
    });

    return {
      config,
      metrics: fullResult.metrics,
      trades: fullResult.trades,
      equityCurve: fullResult.equityCurve,
      drawdownCurve: fullResult.drawdownCurve,
      inSampleMetrics,
      outOfSampleMetrics,
    };
  }

  private executeBacktest(
    data: OHLCVData[],
    config: BacktestConfig,
    analyzeFn: AnalyzeFunction,
    slippage: number,
    fee: number
  ): {
    metrics: BacktestMetrics;
    trades: BacktestTrade[];
    equityCurve: { timestamp: number; equity: number }[];
    drawdownCurve: { timestamp: number; drawdown: number }[];
  } {
    let capital = config.initialCapital;
    let position: { side: 'buy'; entryPrice: number; amount: number; entryTime: number } | null = null;
    const trades: BacktestTrade[] = [];
    const equityCurve: { timestamp: number; equity: number }[] = [];
    const drawdownCurve: { timestamp: number; drawdown: number }[] = [];
    let peakEquity = capital;

    const lookback = 100;

    for (let i = lookback; i < data.length; i++) {
      const windowData = data.slice(Math.max(0, i - lookback), i + 1);
      const currentCandle = data[i]!;
      const currentPrice = currentCandle.close;

      const signal = analyzeFn(windowData, config.strategyConfig);

      if (signal && signal.action === 'buy' && !position) {
        const fillPrice = currentPrice * (1 + slippage);
        const tradeFee = capital * fee;
        const availableCapital = capital - tradeFee;
        const amount = availableCapital / fillPrice;

        position = {
          side: 'buy',
          entryPrice: fillPrice,
          amount,
          entryTime: currentCandle.timestamp,
        };

        capital = 0;
      } else if (signal && signal.action === 'sell' && position) {
        const fillPrice = currentPrice * (1 - slippage);
        const proceeds = position.amount * fillPrice;
        const tradeFee = proceeds * fee;
        const pnl = proceeds - tradeFee - position.amount * position.entryPrice;
        const pnlPercent = (pnl / (position.amount * position.entryPrice)) * 100;

        trades.push({
          entryTime: position.entryTime,
          exitTime: currentCandle.timestamp,
          side: 'buy',
          entryPrice: position.entryPrice,
          exitPrice: fillPrice,
          amount: position.amount,
          pnl,
          pnlPercent,
          fee: tradeFee + position.amount * position.entryPrice * fee,
        });

        capital = proceeds - tradeFee;
        position = null;
      }

      const currentEquity = position
        ? position.amount * currentPrice
        : capital;

      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }

      const drawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;

      equityCurve.push({ timestamp: currentCandle.timestamp, equity: currentEquity });
      drawdownCurve.push({ timestamp: currentCandle.timestamp, drawdown });
    }

    if (position && data.length > 0) {
      const lastPrice = data[data.length - 1]!.close;
      capital = position.amount * lastPrice * (1 - fee);
      position = null;
    }

    const metrics = this.calculateMetrics(trades, config.initialCapital, capital, equityCurve);

    return { metrics, trades, equityCurve, drawdownCurve };
  }

  private calculateMetrics(
    trades: BacktestTrade[],
    initialCapital: number,
    finalCapital: number,
    equityCurve: { timestamp: number; equity: number }[]
  ): BacktestMetrics {
    const totalReturn = finalCapital - initialCapital;
    const totalReturnPct = (totalReturn / initialCapital) * 100;

    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl <= 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
      : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgHoldTime = trades.length > 0
      ? trades.reduce((sum, t) => sum + (t.exitTime - t.entryTime), 0) / trades.length
      : 0;

    const returns = equityCurve.map((point, i) => {
      if (i === 0) return 0;
      const prev = equityCurve[i - 1]!;
      return prev.equity > 0 ? (point.equity - prev.equity) / prev.equity : 0;
    }).slice(1);

    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 0;

    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    const negativeReturns = returns.filter((r) => r < 0);
    const downstdReturn = negativeReturns.length > 1
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + r ** 2, 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downstdReturn > 0 ? (avgReturn / downstdReturn) * Math.sqrt(252) : 0;

    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let peak = initialCapital;

    for (const point of equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = peak - point.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    const durationDays = equityCurve.length > 1
      ? (equityCurve[equityCurve.length - 1]!.timestamp - equityCurve[0]!.timestamp) / (1000 * 60 * 60 * 24)
      : 1;
    const annualizedReturn = durationDays > 0
      ? (Math.pow(finalCapital / initialCapital, 365 / durationDays) - 1) * 100
      : 0;

    const expectancy = trades.length > 0
      ? (winRate / 100) * avgWin + ((100 - winRate) / 100) * avgLoss
      : 0;

    const calmarRatio = maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : 0;

    return {
      totalReturn,
      totalReturnPct,
      annualizedReturn,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      sortinoRatio,
      winRate,
      profitFactor,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgWin,
      avgLoss,
      avgHoldTime,
      expectancy,
      calmarRatio,
    };
  }
}

export const backtesterService = new BacktesterService();
