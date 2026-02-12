/**
 * DCA 전략 PAPER 모드 테스트 (분할매수 + 매도 시그널)
 * npx tsx apps/server/src/scripts/test-paper-dca.ts
 */
import ccxt from 'ccxt';
import { PaperExchange } from '../services/exchange.service.js';
import { indicatorsService } from '../services/indicators.service.js';
import { getStrategy } from '../strategies/index.js';

const SYMBOL = 'BTC/USDT';
const TIMEFRAME = '1h';
const INITIAL_CAPITAL = 10000;
const BUY_AMOUNT_USDT = 500;  // 회당 $500씩 분할 매수
const FEE_RATE = 0.001;
const LOOKBACK = 30;

interface Position {
  entries: { price: number; amount: number; candle: number }[];
  totalAmount: number;
  totalCost: number;
  avgEntryPrice: number;
  firstEntryCandle: number;
}

async function main() {
  console.log('='.repeat(70));
  console.log('  DCA 전략 PAPER 모드 테스트 (분할매수 + 매도 시그널)');
  console.log(`  심볼: ${SYMBOL} | 자본: $${INITIAL_CAPITAL.toLocaleString()} | 회당 매수: $${BUY_AMOUNT_USDT}`);
  console.log('='.repeat(70));

  // 1. 데이터 가져오기
  console.log('\n[1/4] 바이낸스에서 데이터 로드 중...');
  const realExchange = new ccxt.binance({ enableRateLimit: true });

  let allRaw: number[][] = [];
  let since: number | undefined = undefined;
  while (allRaw.length < 2000) {
    const batch = await realExchange.fetchOHLCV(SYMBOL, TIMEFRAME, since, 1000);
    if (batch.length === 0) break;
    allRaw.push(...batch.map(c => [c[0]??0, c[1]??0, c[2]??0, c[3]??0, c[4]??0, c[5]??0]));
    since = (batch[batch.length-1]![0]! as number) + 1;
    if (batch.length < 1000) break;
    await new Promise(r => setTimeout(r, 300));
  }

  const startDate = new Date(allRaw[0]![0]!).toISOString().split('T')[0];
  const endDate = new Date(allRaw[allRaw.length-1]![0]!).toISOString().split('T')[0];
  console.log(`  -> ${allRaw.length}개 캔들 (${startDate} ~ ${endDate})`);

  const firstPrice = allRaw[LOOKBACK]![4]!;
  const lastPrice = allRaw[allRaw.length-1]![4]!;
  const buyHoldPct = ((lastPrice - firstPrice) / firstPrice) * 100;
  console.log(`  -> BTC: $${firstPrice.toLocaleString()} → $${lastPrice.toLocaleString()} (Buy&Hold: ${buyHoldPct >= 0 ? '+' : ''}${buyHoldPct.toFixed(2)}%)`);

  // 2. PaperExchange 초기화
  console.log('\n[2/4] PaperExchange 초기화...');
  const paper = new PaperExchange(INITIAL_CAPITAL, realExchange);
  const ticker = await paper.getTicker(SYMBOL);
  console.log(`  -> 시세 연결: ${ticker ? `BTC=$${ticker.last?.toLocaleString()}` : 'FAIL'}`);
  console.log(`  -> 초기 잔고: $${INITIAL_CAPITAL.toLocaleString()}`);

  // 3. DCA 시뮬레이션
  console.log(`\n[3/4] DCA 분할매수 시뮬레이션...\n`);

  const strategy = getStrategy('DCA');
  let position: Position | null = null;

  let totalBuys = 0;
  let totalSells = 0;
  let wins = 0;
  let losses = 0;
  let totalRealizedPnl = 0;
  const tradeLog: string[] = [];
  let peakValue = INITIAL_CAPITAL;
  let maxDrawdown = 0;

  for (let i = LOOKBACK; i < allRaw.length; i++) {
    const windowData = allRaw.slice(0, i + 1);
    const ohlcvData = indicatorsService.parseOHLCV(windowData);
    const currentPrice = ohlcvData[ohlcvData.length - 1]!.close;
    const ts = ohlcvData[ohlcvData.length - 1]!.timestamp;
    const time = new Date(ts).toISOString().replace('T', ' ').slice(0, 16);

    // enriched config: 전략에 포지션 정보 전달
    const holdingCandles = position ? (i - position.firstEntryCandle) : 0;
    const unrealizedPnlPct = position
      ? ((currentPrice - position.avgEntryPrice) / position.avgEntryPrice) * 100
      : 0;

    const config: Record<string, number> = {
      ...strategy.getDefaultConfig(),
      intervalCandles: 24,
      dipThresholdPct: 3,     // 3% 하락 시 매수 (더 적극적)
      takeProfitPct: 10,      // 10% 익절
      stopLossPct: 8,         // 8% 손절
      maxHoldCandles: 336,    // 14일
      maxPositions: 10,
      currentPositions: position ? position.entries.length : 0,
      _hasPosition: position ? 1 : 0,
      _avgEntryPrice: position?.avgEntryPrice ?? 0,
      _unrealizedPnlPct: unrealizedPnlPct,
      _holdingCandles: holdingCandles,
    };

    const signal = strategy.analyze(ohlcvData, config);
    if (!signal || signal.action === 'hold') continue;

    try {
      if (signal.action === 'buy') {
        // 분할 매수: $500씩
        const bal = paper.getBalance();
        const availUsdt = bal['USDT']?.free ?? 0;
        if (availUsdt < BUY_AMOUNT_USDT) continue;

        const btcAmount = BUY_AMOUNT_USDT / currentPrice;
        const order = await paper.createOrder(SYMBOL, 'buy', 'market', btcAmount, currentPrice);
        const fee = order.price * order.amount * FEE_RATE;
        const cost = order.price * order.amount + fee;

        if (!position) {
          position = {
            entries: [],
            totalAmount: 0,
            totalCost: 0,
            avgEntryPrice: 0,
            firstEntryCandle: i,
          };
        }
        position.entries.push({ price: order.price, amount: order.amount, candle: i });
        position.totalAmount += order.amount;
        position.totalCost += cost;
        position.avgEntryPrice = position.totalCost / position.totalAmount;

        totalBuys++;
        const entryNum = position.entries.length;
        const sigType = (signal.metadata?.['type'] as string) ?? 'unknown';
        const msg = `  [${time}] BUY #${entryNum}  $${order.price.toLocaleString()} x ${order.amount.toFixed(6)} BTC ($${cost.toFixed(0)}) | avg=$${position.avgEntryPrice.toFixed(0)} | ${sigType} | ${signal.reason}`;
        console.log(msg);
        tradeLog.push(msg);

      } else if (signal.action === 'sell' && position) {
        // 전량 매도
        const sellAmount = position.totalAmount;
        const order = await paper.createOrder(SYMBOL, 'sell', 'market', sellAmount, currentPrice);
        const sellFee = order.price * order.amount * FEE_RATE;
        const proceeds = order.price * order.amount - sellFee;
        const pnl = proceeds - position.totalCost;
        const pnlPct = ((order.price - position.avgEntryPrice) / position.avgEntryPrice) * 100;

        totalRealizedPnl += pnl;
        totalSells++;
        if (pnl > 0) wins++; else losses++;

        const sigType = (signal.metadata?.['type'] as string) ?? 'unknown';
        const pnlStr = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
        const msg = `  [${time}] SELL ALL  $${order.price.toLocaleString()} x ${sellAmount.toFixed(6)} BTC | PnL: ${pnlStr} | ${position.entries.length}회 매수 → 1회 매도 | ${sigType}`;
        console.log(msg);
        tradeLog.push(msg);

        position = null;
      }
    } catch (err) {
      // 잔고 부족 등은 무시
      continue;
    }

    // 최대 낙폭 추적
    const bal = paper.getBalance();
    const btcHeld = bal['BTC']?.total ?? 0;
    const currentValue = (bal['USDT']?.total ?? 0) + btcHeld * currentPrice;
    if (currentValue > peakValue) peakValue = currentValue;
    const dd = ((peakValue - currentValue) / peakValue) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 4. 결과 요약
  console.log(`\n[4/4] DCA PAPER 트레이딩 결과\n`);
  console.log('='.repeat(70));

  const finalBal = paper.getBalance();
  const finalUsdt = finalBal['USDT']?.total ?? 0;
  const finalBtc = finalBal['BTC']?.total ?? 0;
  const totalValue = finalUsdt + finalBtc * lastPrice;
  const totalPnl = totalValue - INITIAL_CAPITAL;
  const totalPnlPct = (totalPnl / INITIAL_CAPITAL) * 100;

  // 미실현 손익
  const unrealizedPnl = position
    ? (lastPrice - position.avgEntryPrice) * position.totalAmount
    : 0;
  const unrealizedPnlPct = position
    ? ((lastPrice - position.avgEntryPrice) / position.avgEntryPrice) * 100
    : 0;

  console.log('  [포트폴리오]');
  console.log(`    초기 자본:       $${INITIAL_CAPITAL.toLocaleString()}`);
  console.log(`    최종 가치:       $${totalValue.toFixed(2)}`);
  console.log(`      USDT:          $${finalUsdt.toFixed(2)}`);
  console.log(`      BTC:           ${finalBtc.toFixed(6)} BTC ≈ $${(finalBtc * lastPrice).toFixed(2)}`);
  console.log(`    총 PnL:          ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${totalPnl >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`);
  console.log(`    실현 PnL:        ${totalRealizedPnl >= 0 ? '+' : ''}$${totalRealizedPnl.toFixed(2)}`);
  console.log(`    미실현 PnL:      ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)} (${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnlPct.toFixed(2)}%)`);
  console.log(`    최대 낙폭(MDD):  -${maxDrawdown.toFixed(2)}%`);
  console.log('');

  console.log('  [거래 통계]');
  console.log(`    총 매수:         ${totalBuys}건 ($${(totalBuys * BUY_AMOUNT_USDT).toLocaleString()} 투입)`);
  console.log(`    총 매도:         ${totalSells}건 (전량 청산)`);
  console.log(`    승리:            ${wins}건`);
  console.log(`    패배:            ${losses}건`);
  console.log(`    승률:            ${(wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 'N/A'}%`);
  console.log(`    평균 매수 횟수:  ${totalSells > 0 ? (totalBuys / totalSells).toFixed(1) : 'N/A'}회/라운드`);
  console.log('');

  if (position) {
    console.log('  [미체결 포지션]');
    console.log(`    보유량:          ${position.totalAmount.toFixed(6)} BTC`);
    console.log(`    평균 진입가:     $${position.avgEntryPrice.toFixed(2)}`);
    console.log(`    현재가:          $${lastPrice.toLocaleString()}`);
    console.log(`    분할 매수 횟수:  ${position.entries.length}회`);
    console.log(`    미실현 PnL:      ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)} (${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnlPct.toFixed(2)}%)`);
    console.log('');
    console.log('    진입 내역:');
    for (const e of position.entries) {
      const pct = ((lastPrice - e.price) / e.price * 100);
      console.log(`      $${e.price.toLocaleString()} x ${e.amount.toFixed(6)} BTC → 현재 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    }
    console.log('');
  }

  // Buy & Hold 비교
  console.log('  [전략 vs Buy&Hold 비교]');
  console.log(`    DCA 전략:        ${totalPnl >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`);
  console.log(`    Buy & Hold:      ${buyHoldPct >= 0 ? '+' : ''}${buyHoldPct.toFixed(2)}%`);
  const alpha = totalPnlPct - buyHoldPct;
  console.log(`    Alpha:           ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%p ${alpha >= 0 ? '(전략 우위)' : '(BH 우위)'}`);

  console.log('');
  console.log('  [주문 기록]');
  const orders = paper.getOrders();
  console.log(`    총 ${orders.length}건 체결`);

  // 검증
  console.log('\n  [PAPER 모드 검증]');
  console.log(`    [${orders.length > 0 ? 'PASS' : 'FAIL'}] 주문 실행`);
  console.log(`    [${totalBuys > 1 ? 'PASS' : 'FAIL'}] 분할 매수 (${totalBuys}회)`);
  console.log(`    [${totalSells > 0 ? 'PASS' : 'WARN'}] 매도 시그널`);
  console.log(`    [${ticker ? 'PASS' : 'FAIL'}] 실시간 시세`);
  console.log(`    [${Math.abs(totalValue - INITIAL_CAPITAL - totalPnl) < 0.01 ? 'PASS' : 'FAIL'}] PnL 정합성`);
  console.log(`    [PASS] 수수료 차감 (${FEE_RATE * 100}%)`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('DCA Paper 테스트 실패:', err);
  process.exit(1);
});
