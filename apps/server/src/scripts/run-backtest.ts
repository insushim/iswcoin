/**
 * BTC/USDT 백테스트 실행 스크립트
 * Usage: npx tsx apps/server/src/scripts/run-backtest.ts
 */
import ccxt from 'ccxt';
import { BacktesterService, type BacktestConfig } from '../services/backtester.service.js';
import { indicatorsService } from '../services/indicators.service.js';
import { getStrategy, type StrategyType } from '../strategies/index.js';

const STRATEGIES: StrategyType[] = ['MOMENTUM', 'DCA', 'MEAN_REVERSION', 'SCALPING'];

async function main() {
  const symbol = 'BTC/USDT';
  const timeframe = '1h';
  const initialCapital = 10000;

  console.log('='.repeat(70));
  console.log(`  BTC/USDT 백테스트 실행`);
  console.log(`  타임프레임: ${timeframe} | 초기 자본: $${initialCapital.toLocaleString()}`);
  console.log('='.repeat(70));

  // 1. 바이낸스에서 OHLCV 데이터 가져오기
  console.log('\n[1/3] 바이낸스에서 BTC/USDT 데이터 가져오는 중...');
  const exchange = new ccxt.binance({ enableRateLimit: true });

  let allCandles: number[][] = [];
  let since: number | undefined = undefined;
  const batchSize = 1000;
  const maxCandles = 3000; // 3000 캔들 (~125일)

  // 페이지네이션으로 대량 데이터 조회
  while (allCandles.length < maxCandles) {
    const batch = await exchange.fetchOHLCV(symbol, timeframe, since, batchSize);
    if (batch.length === 0) break;

    const mapped = batch.map(c => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0]);
    allCandles.push(...mapped);

    const lastTs = batch[batch.length - 1]![0]!;
    since = lastTs + 1;

    if (batch.length < batchSize) break;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  -> ${allCandles.length}개 캔들 로드 완료`);

  const startDate = new Date(allCandles[0]![0]!).toISOString();
  const endDate = new Date(allCandles[allCandles.length - 1]![0]!).toISOString();
  console.log(`  -> 기간: ${startDate.split('T')[0]} ~ ${endDate.split('T')[0]}`);

  const ohlcvData = indicatorsService.parseOHLCV(allCandles);

  const startPrice = ohlcvData[0]!.close;
  const endPrice = ohlcvData[ohlcvData.length - 1]!.close;
  const buyAndHold = ((endPrice - startPrice) / startPrice) * 100;
  console.log(`  -> BTC 가격: $${startPrice.toLocaleString()} → $${endPrice.toLocaleString()} (Buy&Hold: ${buyAndHold >= 0 ? '+' : ''}${buyAndHold.toFixed(2)}%)`);

  // 2. 각 전략별 백테스트 실행
  const backtester = new BacktesterService();
  const results: { strategy: string; metrics: Record<string, unknown> }[] = [];

  console.log('\n[2/3] 전략별 백테스트 실행 중...\n');

  for (const strategyType of STRATEGIES) {
    try {
      const strategy = getStrategy(strategyType);
      const config: BacktestConfig = {
        symbol,
        timeframe,
        startDate,
        endDate,
        initialCapital,
        strategy: strategyType,
        strategyConfig: strategy.getDefaultConfig(),
        slippagePct: 0.0005,
        feePct: 0.001,
        walkForwardSplit: 0.7,
        positionMode: strategyType === 'DCA' ? 'accumulate' : 'single',
        shortEnabled: strategyType === 'MEAN_REVERSION',
        maxPositionEntries: strategyType === 'DCA' ? 20 : 1,
        dynamicSlippage: true,
      };

      const result = await backtester.runBacktest(
        config,
        ohlcvData,
        () => {
          const s = getStrategy(strategyType, config.strategyConfig);
          return (data, cfg) => s.analyze(data, cfg);
        }
      );

      results.push({ strategy: strategyType, metrics: result.metrics as unknown as Record<string, unknown> });

      const m = result.metrics;
      console.log(`  [${strategyType}]`);
      console.log(`    총 수익: ${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}% ($${m.totalReturn.toFixed(2)})`);
      console.log(`    연간 수익률: ${m.annualizedReturn >= 0 ? '+' : ''}${m.annualizedReturn.toFixed(2)}%`);
      console.log(`    최대 낙폭: -${m.maxDrawdownPct.toFixed(2)}%`);
      console.log(`    샤프 비율: ${m.sharpeRatio.toFixed(3)}`);
      console.log(`    소르티노 비율: ${m.sortinoRatio.toFixed(3)}`);
      console.log(`    칼마 비율: ${m.calmarRatio.toFixed(3)}`);
      console.log(`    승률: ${m.winRate.toFixed(1)}% (${m.winningTrades}/${m.totalTrades})`);
      console.log(`    수익 팩터: ${m.profitFactor.toFixed(3)}`);
      console.log(`    기대값: $${m.expectancy.toFixed(2)}`);
      console.log(`    평균 승: $${m.avgWin.toFixed(2)} | 평균 패: $${m.avgLoss.toFixed(2)}`);
      console.log(`    평균 보유 시간: ${(m.avgHoldTime / 3600000).toFixed(1)}시간`);

      if (result.inSampleMetrics && result.outOfSampleMetrics) {
        console.log(`    [Walk-Forward] IS: ${result.inSampleMetrics.totalReturnPct.toFixed(2)}% → OOS: ${result.outOfSampleMetrics.totalReturnPct.toFixed(2)}%`);
      }
      console.log('');
    } catch (err) {
      console.log(`  [${strategyType}] 오류: ${(err as Error).message}\n`);
    }
  }

  // 3. 요약 비교표
  console.log('[3/3] 전략 비교 요약\n');
  console.log('-'.repeat(70));
  console.log(
    '전략'.padEnd(16) +
    '수익률'.padStart(10) +
    'MDD'.padStart(10) +
    '샤프'.padStart(8) +
    '승률'.padStart(8) +
    '거래수'.padStart(8) +
    '수익팩터'.padStart(10)
  );
  console.log('-'.repeat(70));

  // Buy & Hold 기준선
  console.log(
    'BUY&HOLD'.padEnd(16) +
    `${buyAndHold >= 0 ? '+' : ''}${buyAndHold.toFixed(2)}%`.padStart(10) +
    'N/A'.padStart(10) +
    'N/A'.padStart(8) +
    'N/A'.padStart(8) +
    '1'.padStart(8) +
    'N/A'.padStart(10)
  );

  for (const r of results) {
    const m = r.metrics as Record<string, number>;
    console.log(
      r.strategy.padEnd(16) +
      `${m['totalReturnPct']! >= 0 ? '+' : ''}${m['totalReturnPct']!.toFixed(2)}%`.padStart(10) +
      `-${m['maxDrawdownPct']!.toFixed(2)}%`.padStart(10) +
      m['sharpeRatio']!.toFixed(3).padStart(8) +
      `${m['winRate']!.toFixed(1)}%`.padStart(8) +
      String(m['totalTrades']).padStart(8) +
      m['profitFactor']!.toFixed(3).padStart(10)
    );
  }
  console.log('-'.repeat(70));
  console.log('\n* 동적 슬리피지 적용, Walk-Forward 검증 포함');
  console.log('* 과거 성과는 미래 수익을 보장하지 않습니다.');
}

main().catch(err => {
  console.error('백테스트 실패:', err);
  process.exit(1);
});
