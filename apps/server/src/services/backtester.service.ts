import { logger } from '../utils/logger.js';
import { type OHLCVData } from './indicators.service.js';
import type { TradeSignal } from '../strategies/base.strategy.js';
import { slippageService } from './slippage.service.js';

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
  // 멀티포지션 + 숏 + 동적슬리피지 옵션
  positionMode?: 'single' | 'accumulate';   // single: 1포지션, accumulate: DCA 적립
  shortEnabled?: boolean;                    // 숏(공매도) 허용
  maxPositionEntries?: number;               // 적립 최대 횟수 (기본 10)
  allocationPct?: number;                    // 회당 자본 배분% (기본: single=100, accumulate=20)
  dynamicSlippage?: boolean;                 // ATR+거래량 기반 동적 슬리피지
}

// 포지션 엔트리
interface PositionEntry {
  price: number;
  amount: number;
  timestamp: number;
}

// 멀티엔트리 포지션 추적
interface ActivePosition {
  side: 'long' | 'short';
  entries: PositionEntry[];
  totalAmount: number;
  avgEntryPrice: number;
  totalCost: number;
  firstEntryTime: number;
  firstEntryCandle: number; // 최초 진입 캔들 인덱스
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

// [FIX-3] 팩토리 함수로 변경 → Walk-forward 시 전략 상태 격리
type AnalyzeFnFactory = () => AnalyzeFunction;

export interface MonteCarloResult {
  simulations: number;
  confidenceLevel: number;
  medianReturn: number;
  meanReturn: number;
  worstReturn: number;
  bestReturn: number;
  returnAtConfidence: number;
  medianMaxDrawdown: number;
  worstMaxDrawdown: number;
  medianSharpe: number;
  profitProbability: number;
  distribution: { returnPct: number; frequency: number }[];
}

// [FIX-4] 타임프레임별 연간 캔들 수 (크립토 = 365일 24시간)
function getPeriodsPerYear(timeframe: string): number {
  const tf = timeframe.toLowerCase();
  if (tf === '1m') return 525_600;
  if (tf === '3m') return 175_200;
  if (tf === '5m') return 105_120;
  if (tf === '15m') return 35_040;
  if (tf === '30m') return 17_520;
  if (tf === '1h') return 8_760;
  if (tf === '2h') return 4_380;
  if (tf === '4h') return 2_190;
  if (tf === '6h') return 1_460;
  if (tf === '8h') return 1_095;
  if (tf === '12h') return 730;
  if (tf === '1d') return 365;
  if (tf === '3d') return 122;
  if (tf === '1w') return 52;
  if (tf.endsWith('m')) return 12;
  return 365;
}

export class BacktesterService {
  private readonly DEFAULT_SLIPPAGE = 0.0005;
  private readonly DEFAULT_FEE = 0.001;

  async runBacktest(
    config: BacktestConfig,
    ohlcvData: OHLCVData[],
    createAnalyzeFn: AnalyzeFnFactory
  ): Promise<BacktestResult> {
    logger.info('Starting backtest', {
      symbol: config.symbol,
      strategy: config.strategy,
      dataPoints: ohlcvData.length,
    });

    const slippage = config.slippagePct || this.DEFAULT_SLIPPAGE;
    const fee = config.feePct || this.DEFAULT_FEE;
    const periodsPerYear = getPeriodsPerYear(config.timeframe);

    const splitIndex = Math.floor(ohlcvData.length * (config.walkForwardSplit || 0.7));
    const inSampleData = ohlcvData.slice(0, splitIndex);
    const outOfSampleData = ohlcvData.slice(splitIndex);

    // [FIX-3] 각 실행마다 새로운 전략 인스턴스 생성 → 상태 격리
    const fullResult = this.executeBacktest(ohlcvData, config, createAnalyzeFn(), slippage, fee, periodsPerYear);

    let inSampleMetrics: BacktestMetrics | null = null;
    let outOfSampleMetrics: BacktestMetrics | null = null;

    if (inSampleData.length > 50 && outOfSampleData.length > 20) {
      const inSampleResult = this.executeBacktest(inSampleData, config, createAnalyzeFn(), slippage, fee, periodsPerYear);
      const outOfSampleResult = this.executeBacktest(outOfSampleData, config, createAnalyzeFn(), slippage, fee, periodsPerYear);
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
    baseSlippage: number,
    fee: number,
    periodsPerYear: number
  ): {
    metrics: BacktestMetrics;
    trades: BacktestTrade[];
    equityCurve: { timestamp: number; equity: number }[];
    drawdownCurve: { timestamp: number; drawdown: number }[];
  } {
    let capital = config.initialCapital;
    let position: ActivePosition | null = null;
    const trades: BacktestTrade[] = [];
    const equityCurve: { timestamp: number; equity: number }[] = [];
    const drawdownCurve: { timestamp: number; drawdown: number }[] = [];
    let peakEquity = capital;

    const lookback = 100;
    const positionMode = config.positionMode ?? 'single';
    const shortEnabled = config.shortEnabled ?? false;
    const maxEntries = config.maxPositionEntries ?? 10;
    const allocationPct = config.allocationPct ?? (positionMode === 'accumulate' ? 20 : 100);
    const useDynamicSlippage = config.dynamicSlippage ?? false;

    let pendingSignal: TradeSignal | null = null;

    for (let i = lookback; i < data.length; i++) {
      const currentCandle = data[i]!;

      // ===== 1단계: 이전 캔들 신호 → 현재 캔들 시가로 체결 =====
      if (pendingSignal) {
        const openPrice = currentCandle.open;

        // 동적 슬리피지 계산
        let slippage = baseSlippage;
        if (useDynamicSlippage) {
          const windowForSlippage = data.slice(Math.max(0, i - 30), i + 1);
          const { currentATR, avgVolume } = slippageService.extractSlippageInputs(windowForSlippage);
          const orderSize = capital * (allocationPct / 100);
          slippage = slippageService.calculateDynamicSlippage(
            baseSlippage, currentATR, openPrice, currentCandle.volume, avgVolume, orderSize
          );
        }

        if (pendingSignal.action === 'buy') {
          if (position?.side === 'short') {
            // 숏 포지션 청산 (buy to cover)
            capital = this.closePosition(position, openPrice, slippage, fee, trades, currentCandle.timestamp);
            position = null;
          }

          if (!position) {
            // 신규 롱 진입
            const allocCapital = capital * (allocationPct / 100);
            if (allocCapital > 0) {
              const fillPrice = openPrice * (1 + slippage);
              const tradeFee = allocCapital * fee;
              const amount = (allocCapital - tradeFee) / fillPrice;

              position = {
                side: 'long',
                entries: [{ price: fillPrice, amount, timestamp: currentCandle.timestamp }],
                totalAmount: amount,
                avgEntryPrice: fillPrice,
                totalCost: allocCapital,
                firstEntryTime: currentCandle.timestamp,
                firstEntryCandle: i,
              };
              capital -= allocCapital;
            }
          } else if (position.side === 'long' && positionMode === 'accumulate' && position.entries.length < maxEntries) {
            // DCA 적립: 기존 롱에 추가 진입
            const allocCapital = capital * (allocationPct / 100);
            if (allocCapital > 0) {
              const fillPrice = openPrice * (1 + slippage);
              const tradeFee = allocCapital * fee;
              const amount = (allocCapital - tradeFee) / fillPrice;

              position.entries.push({ price: fillPrice, amount, timestamp: currentCandle.timestamp });
              position.totalAmount += amount;
              position.totalCost += allocCapital;
              position.avgEntryPrice = position.totalCost / position.totalAmount;
              capital -= allocCapital;
            }
          }
        } else if (pendingSignal.action === 'sell') {
          if (position?.side === 'long') {
            // 롱 포지션 전체 청산
            capital = this.closePosition(position, openPrice, slippage, fee, trades, currentCandle.timestamp);
            position = null;
          } else if (!position && shortEnabled) {
            // 신규 숏 진입
            const allocCapital = capital * (allocationPct / 100);
            if (allocCapital > 0) {
              const fillPrice = openPrice * (1 - slippage);
              const tradeFee = allocCapital * fee;
              const amount = (allocCapital - tradeFee) / fillPrice;

              position = {
                side: 'short',
                entries: [{ price: fillPrice, amount, timestamp: currentCandle.timestamp }],
                totalAmount: amount,
                avgEntryPrice: fillPrice,
                totalCost: allocCapital,
                firstEntryTime: currentCandle.timestamp,
                firstEntryCandle: i,
              };
              capital -= allocCapital;
            }
          }
        }

        pendingSignal = null;
      }

      // ===== 2단계: equity 추적 (미실현 수수료 반영) =====
      let currentEquity = capital;
      if (position) {
        if (position.side === 'long') {
          currentEquity += position.totalAmount * currentCandle.close * (1 - fee);
        } else {
          // 숏: 진입가 - 현재가 차이가 수익
          const shortPnl = (position.avgEntryPrice - currentCandle.close) * position.totalAmount;
          const closeCost = position.totalAmount * currentCandle.close * fee;
          currentEquity += position.totalCost + shortPnl - closeCost;
        }
      }

      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;

      equityCurve.push({ timestamp: currentCandle.timestamp, equity: currentEquity });
      drawdownCurve.push({ timestamp: currentCandle.timestamp, drawdown });

      // ===== 3단계: 전략에 포지션 컨텍스트 전달 + 신호 생성 =====
      const windowData = data.slice(Math.max(0, i - lookback), i + 1);

      // 전략에 현재 포지션 정보를 enriched config로 전달
      const enrichedConfig: Record<string, number> = { ...config.strategyConfig };
      if (position) {
        enrichedConfig['_hasPosition'] = 1;
        enrichedConfig['_positionSide'] = position.side === 'long' ? 1 : -1;
        enrichedConfig['_avgEntryPrice'] = position.avgEntryPrice;
        enrichedConfig['_positionCount'] = position.entries.length;
        enrichedConfig['_holdingCandles'] = i - position.firstEntryCandle;

        const currentPrice = currentCandle.close;
        if (position.side === 'long') {
          enrichedConfig['_unrealizedPnlPct'] = ((currentPrice - position.avgEntryPrice) / position.avgEntryPrice) * 100;
        } else {
          enrichedConfig['_unrealizedPnlPct'] = ((position.avgEntryPrice - currentPrice) / position.avgEntryPrice) * 100;
        }
      } else {
        enrichedConfig['_hasPosition'] = 0;
        enrichedConfig['_positionSide'] = 0;
        enrichedConfig['_avgEntryPrice'] = 0;
        enrichedConfig['_positionCount'] = 0;
        enrichedConfig['_holdingCandles'] = 0;
        enrichedConfig['_unrealizedPnlPct'] = 0;
      }

      pendingSignal = analyzeFn(windowData, enrichedConfig);
    }

    // ===== 강제청산 =====
    if (position && data.length > 0) {
      const lastCandle = data[data.length - 1]!;
      capital = this.closePosition(position, lastCandle.close, baseSlippage, fee, trades, lastCandle.timestamp);
      position = null;
    }

    const metrics = this.calculateMetrics(trades, config.initialCapital, capital, equityCurve, periodsPerYear);
    return { metrics, trades, equityCurve, drawdownCurve };
  }

  /**
   * 포지션 청산: 롱/숏 모두 지원, trades 배열에 기록, 회수 자본 반환
   */
  private closePosition(
    position: ActivePosition,
    marketPrice: number,
    slippage: number,
    fee: number,
    trades: BacktestTrade[],
    exitTimestamp: number
  ): number {
    if (position.side === 'long') {
      const fillPrice = marketPrice * (1 - slippage);
      const proceeds = position.totalAmount * fillPrice;
      const tradeFee = proceeds * fee;
      const entryCost = position.totalAmount * position.avgEntryPrice;
      const pnl = proceeds - tradeFee - entryCost;
      const pnlPercent = entryCost > 0 ? (pnl / entryCost) * 100 : 0;

      trades.push({
        entryTime: position.firstEntryTime,
        exitTime: exitTimestamp,
        side: 'buy',
        entryPrice: position.avgEntryPrice,
        exitPrice: fillPrice,
        amount: position.totalAmount,
        pnl,
        pnlPercent,
        fee: tradeFee + entryCost * fee,
      });

      return proceeds - tradeFee;
    } else {
      // 숏 청산: buy to cover
      const fillPrice = marketPrice * (1 + slippage);
      const coverCost = position.totalAmount * fillPrice;
      const tradeFee = coverCost * fee;
      const entryProceeds = position.totalAmount * position.avgEntryPrice;
      const pnl = entryProceeds - coverCost - tradeFee;
      const pnlPercent = entryProceeds > 0 ? (pnl / entryProceeds) * 100 : 0;

      trades.push({
        entryTime: position.firstEntryTime,
        exitTime: exitTimestamp,
        side: 'sell',
        entryPrice: position.avgEntryPrice,
        exitPrice: fillPrice,
        amount: position.totalAmount,
        pnl,
        pnlPercent,
        fee: tradeFee + entryProceeds * fee,
      });

      return position.totalCost + pnl;
    }
  }

  private calculateMetrics(
    trades: BacktestTrade[],
    initialCapital: number,
    finalCapital: number,
    equityCurve: { timestamp: number; equity: number }[],
    periodsPerYear: number
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

    // [FIX-4] 타임프레임 인식 Sharpe/Sortino 연환산
    const annualizationFactor = Math.sqrt(periodsPerYear);
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * annualizationFactor : 0;

    const negativeReturns = returns.filter((r) => r < 0);
    const downstdReturn = negativeReturns.length > 1
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + r ** 2, 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downstdReturn > 0 ? (avgReturn / downstdReturn) * annualizationFactor : 0;

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

  /**
   * Monte Carlo 시뮬레이션
   * 거래 결과를 무작위 리샘플링하여 전략 안정성 평가
   */
  runMonteCarlo(
    trades: BacktestTrade[],
    initialCapital: number,
    simulations: number = 1000,
    confidenceLevel: number = 0.95
  ): MonteCarloResult {
    if (trades.length < 5) {
      return {
        simulations: 0,
        confidenceLevel,
        medianReturn: 0,
        meanReturn: 0,
        worstReturn: 0,
        bestReturn: 0,
        returnAtConfidence: 0,
        medianMaxDrawdown: 0,
        worstMaxDrawdown: 0,
        medianSharpe: 0,
        profitProbability: 0,
        distribution: [],
      };
    }

    logger.info('Running Monte Carlo simulation', {
      trades: trades.length,
      simulations,
      confidenceLevel,
    });

    const simReturns: number[] = [];
    const simDrawdowns: number[] = [];
    const simSharpes: number[] = [];

    for (let sim = 0; sim < simulations; sim++) {
      const sampledTrades = this.resampleTrades(trades);

      let capital = initialCapital;
      let peak = initialCapital;
      let maxDrawdown = 0;
      const returns: number[] = [];

      for (const trade of sampledTrades) {
        const pnlRatio = trade.pnlPercent / 100;
        const prevCapital = capital;
        capital *= (1 + pnlRatio);

        if (capital > peak) peak = capital;
        const dd = peak > 0 ? (peak - capital) / peak : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;

        returns.push(prevCapital > 0 ? (capital - prevCapital) / prevCapital : 0);
      }

      const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
      simReturns.push(totalReturn);
      simDrawdowns.push(maxDrawdown * 100);

      const avgReturn = returns.length > 0
        ? returns.reduce((a, b) => a + b, 0) / returns.length
        : 0;
      const stdReturn = returns.length > 1
        ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
        : 0;
      simSharpes.push(stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(trades.length) : 0);
    }

    simReturns.sort((a, b) => a - b);
    simDrawdowns.sort((a, b) => a - b);
    simSharpes.sort((a, b) => a - b);

    const lowerIdx = Math.floor((1 - confidenceLevel) * simulations);
    const medianIdx = Math.floor(simulations / 2);

    const minReturn = simReturns[0]!;
    const maxReturn = simReturns[simReturns.length - 1]!;
    const binSize = (maxReturn - minReturn) / 20 || 1;
    const distribution: { returnPct: number; frequency: number }[] = [];

    for (let i = 0; i < 20; i++) {
      const binStart = minReturn + i * binSize;
      const binEnd = binStart + binSize;
      const count = simReturns.filter((r) => r >= binStart && r < binEnd).length;
      distribution.push({
        returnPct: Math.round((binStart + binEnd) / 2 * 100) / 100,
        frequency: count / simulations,
      });
    }

    const profitCount = simReturns.filter((r) => r > 0).length;

    const result: MonteCarloResult = {
      simulations,
      confidenceLevel,
      medianReturn: Math.round(simReturns[medianIdx]! * 100) / 100,
      meanReturn: Math.round(
        (simReturns.reduce((a, b) => a + b, 0) / simulations) * 100
      ) / 100,
      worstReturn: Math.round(simReturns[0]! * 100) / 100,
      bestReturn: Math.round(simReturns[simReturns.length - 1]! * 100) / 100,
      returnAtConfidence: Math.round(simReturns[lowerIdx]! * 100) / 100,
      medianMaxDrawdown: Math.round(simDrawdowns[medianIdx]! * 100) / 100,
      worstMaxDrawdown: Math.round(simDrawdowns[simDrawdowns.length - 1]! * 100) / 100,
      medianSharpe: Math.round(simSharpes[medianIdx]! * 100) / 100,
      profitProbability: Math.round((profitCount / simulations) * 10000) / 100,
      distribution,
    };

    logger.info('Monte Carlo completed', {
      medianReturn: result.medianReturn,
      returnAt95: result.returnAtConfidence,
      profitProb: result.profitProbability,
    });

    return result;
  }

  private resampleTrades(trades: BacktestTrade[]): BacktestTrade[] {
    const n = trades.length;
    const sampled: BacktestTrade[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      sampled.push(trades[idx]!);
    }
    return sampled;
  }
}

export const backtesterService = new BacktesterService();
