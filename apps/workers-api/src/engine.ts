// Paper Trading Engine - Cron-based strategy execution
import type { Env } from './index';
import { generateId } from './utils';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Symbol to CoinGecko ID mapping
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin', XRPUSDT: 'ripple', ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin', AVAXUSDT: 'avalanche-2', DOTUSDT: 'polkadot',
  MATICUSDT: 'matic-network', LINKUSDT: 'chainlink', UNIUSDT: 'uniswap',
};

// Fallback prices in case CoinGecko rate-limits
const FALLBACK_PRICES: Record<string, number> = {
  BTCUSDT: 97500, ETHUSDT: 3250, SOLUSDT: 198, BNBUSDT: 625,
  XRPUSDT: 2.45, ADAUSDT: 0.89, DOGEUSDT: 0.32, AVAXUSDT: 38.5,
  DOTUSDT: 7.89, MATICUSDT: 0.42, LINKUSDT: 19.50, UNIUSDT: 12.30,
};

// ============ Price Fetching (CoinGecko) ============

async function getPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const unique = [...new Set(symbols)];

  // Collect CoinGecko IDs for requested symbols
  const coinIds: string[] = [];
  for (const sym of unique) {
    const id = SYMBOL_TO_COINGECKO[sym];
    if (id) coinIds.push(id);
  }

  if (coinIds.length === 0) {
    // Use fallback for unknown symbols
    for (const sym of unique) {
      if (FALLBACK_PRICES[sym]) prices[sym] = FALLBACK_PRICES[sym];
    }
    return prices;
  }

  try {
    const ids = coinIds.join(',');
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoSentinel/1.0' } }
    );
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data = await res.json() as Record<string, { usd: number; usd_24h_change?: number }>;

    // Map back to symbol format
    for (const sym of unique) {
      const coinId = SYMBOL_TO_COINGECKO[sym];
      if (coinId && data[coinId]?.usd) {
        prices[sym] = data[coinId].usd;
      } else if (FALLBACK_PRICES[sym]) {
        prices[sym] = FALLBACK_PRICES[sym];
      }
    }
  } catch {
    // Use fallback prices
    for (const sym of unique) {
      if (FALLBACK_PRICES[sym]) prices[sym] = FALLBACK_PRICES[sym];
    }
  }

  return prices;
}

// Get 24hr price change from CoinGecko
async function get24hChange(symbol: string): Promise<number> {
  const coinId = SYMBOL_TO_COINGECKO[symbol];
  if (!coinId) return 0;
  try {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoSentinel/1.0' } }
    );
    if (!res.ok) return 0;
    const data = await res.json() as Record<string, { usd_24h_change?: number }>;
    return data[coinId]?.usd_24h_change || 0;
  } catch {
    return 0;
  }
}

// ============ Portfolio Helpers ============

interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

async function getPortfolio(db: D1Database, userId: string): Promise<{ id: string; positions: Position[]; totalValue: number }> {
  const row = await db.prepare(
    'SELECT id, positions, total_value FROM portfolios WHERE user_id = ? LIMIT 1'
  ).bind(userId).first<{ id: string; positions: string; total_value: number }>();

  if (!row) {
    // Create default portfolio
    const id = generateId();
    const defaultPositions: Position[] = [{ symbol: 'USDT', amount: 10000, entryPrice: 1, currentPrice: 1, pnl: 0, pnlPercent: 0 }];
    await db.prepare(
      'INSERT INTO portfolios (id, user_id, total_value, daily_pnl, positions) VALUES (?, ?, 10000, 0, ?)'
    ).bind(id, userId, JSON.stringify(defaultPositions)).run();
    return { id, positions: defaultPositions, totalValue: 10000 };
  }

  let positions: Position[] = [];
  try { positions = JSON.parse(row.positions || '[]'); } catch { /* empty */ }
  if (positions.length === 0) {
    positions = [{ symbol: 'USDT', amount: row.total_value || 10000, entryPrice: 1, currentPrice: 1, pnl: 0, pnlPercent: 0 }];
  }
  return { id: row.id, positions, totalValue: row.total_value || 10000 };
}

function getCash(positions: Position[]): number {
  return positions.find(p => p.symbol === 'USDT')?.amount || 0;
}

function updatePositions(
  positions: Position[],
  side: 'BUY' | 'SELL',
  baseSymbol: string,
  quantity: number,
  price: number,
  costOrRevenue: number
): Position[] {
  const updated = [...positions];

  // Update USDT (cash)
  const usdtIdx = updated.findIndex(p => p.symbol === 'USDT');
  if (usdtIdx >= 0) {
    if (side === 'BUY') {
      updated[usdtIdx] = { ...updated[usdtIdx], amount: updated[usdtIdx].amount - costOrRevenue };
    } else {
      updated[usdtIdx] = { ...updated[usdtIdx], amount: updated[usdtIdx].amount + costOrRevenue };
    }
  }

  // Update asset position
  const assetIdx = updated.findIndex(p => p.symbol === baseSymbol);
  if (side === 'BUY') {
    if (assetIdx >= 0) {
      const existing = updated[assetIdx];
      const totalAmount = existing.amount + quantity;
      const avgEntry = (existing.entryPrice * existing.amount + price * quantity) / totalAmount;
      updated[assetIdx] = {
        symbol: baseSymbol,
        amount: totalAmount,
        entryPrice: parseFloat(avgEntry.toFixed(2)),
        currentPrice: price,
        pnl: parseFloat(((price - avgEntry) * totalAmount).toFixed(2)),
        pnlPercent: parseFloat((((price - avgEntry) / avgEntry) * 100).toFixed(2)),
      };
    } else {
      updated.push({
        symbol: baseSymbol,
        amount: quantity,
        entryPrice: price,
        currentPrice: price,
        pnl: 0,
        pnlPercent: 0,
      });
    }
  } else {
    // SELL
    if (assetIdx >= 0) {
      const existing = updated[assetIdx];
      const newAmount = existing.amount - quantity;
      if (newAmount <= 0.00000001) {
        updated.splice(assetIdx, 1);
      } else {
        updated[assetIdx] = {
          ...existing,
          amount: newAmount,
          currentPrice: price,
          pnl: parseFloat(((price - existing.entryPrice) * newAmount).toFixed(2)),
          pnlPercent: parseFloat((((price - existing.entryPrice) / existing.entryPrice) * 100).toFixed(2)),
        };
      }
    }
  }

  return updated;
}

async function savePortfolio(db: D1Database, portfolioId: string, positions: Position[], prices: Record<string, number>) {
  // Update current prices for all positions
  for (const pos of positions) {
    if (pos.symbol === 'USDT') continue;
    const priceKey = pos.symbol + 'USDT';
    if (prices[priceKey]) {
      pos.currentPrice = prices[priceKey];
      pos.pnl = parseFloat(((pos.currentPrice - pos.entryPrice) * pos.amount).toFixed(2));
      pos.pnlPercent = pos.entryPrice > 0 ? parseFloat((((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)) : 0;
    }
  }

  // Calculate total value
  let totalValue = 0;
  for (const pos of positions) {
    if (pos.symbol === 'USDT') {
      totalValue += pos.amount;
    } else {
      totalValue += pos.amount * pos.currentPrice;
    }
  }

  const dailyPnl = totalValue - 10000; // Simple: vs initial capital

  await db.prepare(
    'UPDATE portfolios SET total_value = ?, daily_pnl = ?, positions = ?, updated_at = ? WHERE id = ?'
  ).bind(
    parseFloat(totalValue.toFixed(2)),
    parseFloat(dailyPnl.toFixed(2)),
    JSON.stringify(positions),
    new Date().toISOString(),
    portfolioId
  ).run();
}

// ============ Trade Recording ============

async function recordTrade(
  db: D1Database,
  userId: string,
  botId: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  price: number,
  quantity: number,
  pnl: number
) {
  const id = generateId();
  const exchange = 'BINANCE';
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO trades (id, user_id, bot_id, exchange, symbol, side, order_type, status, entry_price, quantity, pnl, pnl_percent, fee, timestamp, closed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'MARKET', 'CLOSED', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, botId, exchange, symbol.replace('/', ''),
    side, price, quantity,
    parseFloat(pnl.toFixed(2)),
    price > 0 ? parseFloat(((pnl / (price * quantity)) * 100).toFixed(2)) : 0,
    parseFloat((price * quantity * 0.001).toFixed(4)), // 0.1% fee
    now, now, now
  ).run();
}

async function updateBotStats(db: D1Database, botId: string) {
  const { results: trades } = await db.prepare(
    "SELECT pnl FROM trades WHERE bot_id = ? AND status = 'CLOSED'"
  ).bind(botId).all();

  const all = (trades || []) as Array<{ pnl: number }>;
  const totalProfit = all.reduce((s, t) => s + (t.pnl || 0), 0);
  const winning = all.filter(t => (t.pnl || 0) > 0);
  const winRate = all.length > 0 ? (winning.length / all.length) * 100 : 0;

  await db.prepare(
    'UPDATE bots SET total_profit = ?, total_trades = ?, win_rate = ?, updated_at = ? WHERE id = ?'
  ).bind(
    parseFloat(totalProfit.toFixed(2)),
    all.length,
    parseFloat(winRate.toFixed(1)),
    new Date().toISOString(),
    botId
  ).run();
}

// ============ Strategy Execution ============

interface BotRow {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  symbol: string;
  config: string;
  status: string;
}

async function getLastTradeTime(db: D1Database, botId: string): Promise<number> {
  const last = await db.prepare(
    'SELECT timestamp FROM trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(botId).first<{ timestamp: string }>();
  return last ? new Date(last.timestamp).getTime() : 0;
}

// DCA: Buy fixed amount at regular intervals
async function executeDCA(
  db: D1Database, bot: BotRow, price: number, positions: Position[]
): Promise<{ side: 'BUY' | 'SELL'; quantity: number; cost: number } | null> {
  const config = JSON.parse(bot.config || '{}');
  const investmentAmount = config.investmentAmount || 100;
  // interval in hours (default: 1hr for paper trading)
  const intervalHours = config.interval || 1;

  const lastTime = await getLastTradeTime(db, bot.id);
  const elapsed = Date.now() - lastTime;
  // Minimum 5 minutes between DCA trades (cron interval)
  const minIntervalMs = Math.max(intervalHours * 3600000, 300000);
  if (lastTime > 0 && elapsed < minIntervalMs) {
    return null; // Not time yet
  }

  const cash = getCash(positions);
  if (cash < investmentAmount) return null; // Not enough cash

  const quantity = investmentAmount / price;
  return { side: 'BUY', quantity, cost: investmentAmount };
}

// GRID: Buy/sell at grid levels
async function executeGrid(
  db: D1Database, bot: BotRow, price: number, positions: Position[]
): Promise<{ side: 'BUY' | 'SELL'; quantity: number; cost: number } | null> {
  const config = JSON.parse(bot.config || '{}');
  const upperPrice = config.upperPrice || price * 1.1;
  const lowerPrice = config.lowerPrice || price * 0.9;
  const gridLevels = config.gridLevels || 10;
  const investPerGrid = config.investPerGrid || 100;

  if (price > upperPrice || price < lowerPrice) return null;

  const step = (upperPrice - lowerPrice) / gridLevels;
  const gridLevel = Math.floor((price - lowerPrice) / step);

  const lastTime = await getLastTradeTime(db, bot.id);
  if (Date.now() - lastTime < 300000) return null; // Min 5min between trades

  // Check last trade side - alternate between buy and sell
  const lastTrade = await db.prepare(
    'SELECT side, entry_price FROM trades WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 1'
  ).bind(bot.id).first<{ side: string; entry_price: number }>();

  const baseSymbol = bot.symbol.replace('/', '').replace('USDT', '');
  const position = positions.find(p => p.symbol === baseSymbol);
  const cash = getCash(positions);

  if (!lastTrade || lastTrade.side === 'SELL') {
    // Buy
    if (cash < investPerGrid) return null;
    return { side: 'BUY', quantity: investPerGrid / price, cost: investPerGrid };
  } else {
    // Sell if price moved up at least 1 grid step
    if (!position || position.amount <= 0) return null;
    if (price < (lastTrade.entry_price || 0) + step) return null;
    const sellQty = Math.min(position.amount, investPerGrid / price);
    return { side: 'SELL', quantity: sellQty, cost: sellQty * price };
  }
}

// MOMENTUM: Buy on dips, sell on spikes (simplified)
async function executeMomentum(
  db: D1Database, bot: BotRow, price: number, positions: Position[]
): Promise<{ side: 'BUY' | 'SELL'; quantity: number; cost: number } | null> {
  const config = JSON.parse(bot.config || '{}');
  const investmentAmount = config.investmentAmount || 200;

  const lastTime = await getLastTradeTime(db, bot.id);
  if (Date.now() - lastTime < 3600000) return null; // Min 1hr between trades

  // Fetch 24hr change from CoinGecko
  const cleanSymbol = bot.symbol.replace('/', '');
  const change24h = await get24hChange(cleanSymbol);

  const baseSymbol = cleanSymbol.replace('USDT', '');
  const position = positions.find(p => p.symbol === baseSymbol);
  const cash = getCash(positions);

  const buyThreshold = config.rsiBuyThreshold || -3; // Buy when down 3%+
  const sellThreshold = config.rsiSellThreshold || 5; // Sell when up 5%+

  if (change24h <= buyThreshold && cash >= investmentAmount) {
    return { side: 'BUY', quantity: investmentAmount / price, cost: investmentAmount };
  }

  if (change24h >= sellThreshold && position && position.amount > 0) {
    const sellQty = position.amount * 0.5; // Sell half
    return { side: 'SELL', quantity: sellQty, cost: sellQty * price };
  }

  return null;
}

// TRAILING: Trail price and sell when it drops by X%
async function executeTrailing(
  db: D1Database, bot: BotRow, price: number, positions: Position[]
): Promise<{ side: 'BUY' | 'SELL'; quantity: number; cost: number } | null> {
  const config = JSON.parse(bot.config || '{}');
  const investmentAmount = config.investmentAmount || 200;
  const trailingPercent = config.trailingPercent || 3;

  const baseSymbol = bot.symbol.replace('/', '').replace('USDT', '');
  const position = positions.find(p => p.symbol === baseSymbol);
  const cash = getCash(positions);

  const lastTime = await getLastTradeTime(db, bot.id);
  if (Date.now() - lastTime < 1800000) return null; // Min 30min

  // If no position, buy
  if (!position || position.amount <= 0) {
    if (cash < investmentAmount) return null;
    return { side: 'BUY', quantity: investmentAmount / price, cost: investmentAmount };
  }

  // If position exists, check if price dropped from peak
  const highSinceEntry = Math.max(position.currentPrice, price);
  const dropFromHigh = ((highSinceEntry - price) / highSinceEntry) * 100;

  if (dropFromHigh >= trailingPercent && position.pnlPercent > 0) {
    // Sell to lock in profit
    return { side: 'SELL', quantity: position.amount, cost: position.amount * price };
  }

  return null;
}

// MEAN_REVERSION: Buy below average, sell above average
async function executeMeanReversion(
  db: D1Database, bot: BotRow, price: number, positions: Position[]
): Promise<{ side: 'BUY' | 'SELL'; quantity: number; cost: number } | null> {
  const config = JSON.parse(bot.config || '{}');
  const investmentAmount = config.investmentAmount || 200;

  const lastTime = await getLastTradeTime(db, bot.id);
  if (Date.now() - lastTime < 3600000) return null;

  // Calculate mean reference from CoinGecko
  const cleanSymbol = bot.symbol.replace('/', '');
  const coinId = SYMBOL_TO_COINGECKO[cleanSymbol];
  if (!coinId) return null;

  let avgPrice = price;
  try {
    const res = await fetch(
      `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=7&interval=daily`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoSentinel/1.0' } }
    );
    if (res.ok) {
      const data = await res.json() as { prices?: number[][] };
      const pricePoints = (data.prices || []).map(p => p[1]);
      if (pricePoints.length > 0) {
        avgPrice = pricePoints.reduce((a, b) => a + b, 0) / pricePoints.length;
      }
    }
  } catch { /* use current price as fallback avg */ }
  const deviation = ((price - avgPrice) / avgPrice) * 100;

  const baseSymbol = cleanSymbol.replace('USDT', '');
  const position = positions.find(p => p.symbol === baseSymbol);
  const cash = getCash(positions);

  const bollingerStdDev = config.bollingerStdDev || 2;

  if (deviation < -bollingerStdDev && cash >= investmentAmount) {
    // Price below average -> buy
    return { side: 'BUY', quantity: investmentAmount / price, cost: investmentAmount };
  }

  if (deviation > bollingerStdDev && position && position.amount > 0) {
    // Price above average -> sell
    const sellQty = position.amount * 0.5;
    return { side: 'SELL', quantity: sellQty, cost: sellQty * price };
  }

  return null;
}

// ============ Main Engine ============

export async function runPaperTrading(env: Env): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(msg); };
  const db = env.DB;

  // Get all RUNNING bots
  const { results } = await db.prepare(
    "SELECT id, user_id, name, strategy, symbol, config, status FROM bots WHERE status = 'RUNNING'"
  ).all();

  const bots = (results || []) as unknown as BotRow[];
  if (bots.length === 0) { log('No RUNNING bots found'); return logs; }
  log(`Found ${bots.length} running bot(s)`);

  // Get unique symbols to fetch prices
  const symbols = [...new Set(bots.map(b => b.symbol.replace('/', '')))];
  log(`Fetching prices for: ${symbols.join(', ')}`);
  let prices: Record<string, number>;
  try {
    prices = await getPrices(symbols);
    log(`Prices: ${JSON.stringify(prices)}`);
  } catch (e) {
    log(`Failed to fetch prices: ${e}`);
    return logs;
  }

  // Group bots by user
  const userBots = new Map<string, BotRow[]>();
  for (const bot of bots) {
    const existing = userBots.get(bot.user_id) || [];
    existing.push(bot);
    userBots.set(bot.user_id, existing);
  }

  // Process each user's bots
  for (const [userId, userBotList] of userBots) {
    const portfolio = await getPortfolio(db, userId);
    log(`Portfolio for ${userId}: cash=${getCash(portfolio.positions)}, positions=${portfolio.positions.length}`);

    for (const bot of userBotList) {
      try {
        const cleanSymbol = bot.symbol.replace('/', '');
        const price = prices[cleanSymbol];
        if (!price) { log(`No price for ${cleanSymbol}`); continue; }
        log(`Processing ${bot.name} (${bot.strategy}) - ${cleanSymbol} @ $${price}`);

        let result: { side: 'BUY' | 'SELL'; quantity: number; cost: number } | null = null;

        switch (bot.strategy) {
          case 'DCA':
            result = await executeDCA(db, bot, price, portfolio.positions);
            break;
          case 'GRID':
            result = await executeGrid(db, bot, price, portfolio.positions);
            break;
          case 'MOMENTUM':
            result = await executeMomentum(db, bot, price, portfolio.positions);
            break;
          case 'TRAILING':
            result = await executeTrailing(db, bot, price, portfolio.positions);
            break;
          case 'MEAN_REVERSION':
            result = await executeMeanReversion(db, bot, price, portfolio.positions);
            break;
          default:
            // For other strategies (MARTINGALE, RL_AGENT, STAT_ARB, SCALPING, FUNDING_ARB)
            // Use DCA-like behavior as fallback
            result = await executeDCA(db, bot, price, portfolio.positions);
            break;
        }

        log(`Strategy result: ${result ? JSON.stringify(result) : 'null (no trade signal)'}`);

        if (result) {
          const baseSymbol = cleanSymbol.replace('USDT', '');

          // Calculate PnL for sells
          let pnl = 0;
          if (result.side === 'SELL') {
            const pos = portfolio.positions.find(p => p.symbol === baseSymbol);
            if (pos) {
              pnl = (price - pos.entryPrice) * result.quantity;
            }
          }

          // Record trade
          await recordTrade(db, userId, bot.id, bot.symbol, result.side, price, result.quantity, pnl);

          // Update positions
          portfolio.positions = updatePositions(
            portfolio.positions,
            result.side,
            baseSymbol,
            result.quantity,
            price,
            result.cost
          );

          // Update bot stats
          await updateBotStats(db, bot.id);

          log(`[${bot.name}] ${result.side} ${result.quantity.toFixed(6)} ${baseSymbol} @ $${price.toFixed(2)}`);
        }
      } catch (err) {
        log(`Error processing bot ${bot.id}: ${err}`);
      }
    }

    // Save portfolio with updated prices
    await savePortfolio(db, portfolio.id, portfolio.positions, prices);
    log(`Portfolio saved for ${userId}`);
  }

  return logs;
}
