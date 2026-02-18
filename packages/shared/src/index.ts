// ===== Enums =====
export enum TradingMode {
  PAPER = "PAPER",
  REAL = "REAL",
}

export enum BotStatus {
  IDLE = "IDLE",
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  ERROR = "ERROR",
}

export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

export enum OrderType {
  MARKET = "MARKET",
  LIMIT = "LIMIT",
  STOP_LOSS = "STOP_LOSS",
  TAKE_PROFIT = "TAKE_PROFIT",
}

export enum StrategyType {
  DCA = "DCA",
  GRID = "GRID",
  MARTINGALE = "MARTINGALE",
  TRAILING = "TRAILING",
  MOMENTUM = "MOMENTUM",
  MEAN_REVERSION = "MEAN_REVERSION",
  RL_AGENT = "RL_AGENT",
  STAT_ARB = "STAT_ARB",
  SCALPING = "SCALPING",
  FUNDING_ARB = "FUNDING_ARB",
  ENSEMBLE = "ENSEMBLE",
}

export enum MarketRegime {
  BULL_HIGH_VOL = "BULL_HIGH_VOL",
  BULL_LOW_VOL = "BULL_LOW_VOL",
  BEAR_HIGH_VOL = "BEAR_HIGH_VOL",
  BEAR_LOW_VOL = "BEAR_LOW_VOL",
}

/** 기술적 분석 기반 상세 마켓 레짐 (서버 regime.service 전용) */
export enum DetailedMarketRegime {
  TRENDING_UP = "TRENDING_UP",
  TRENDING_DOWN = "TRENDING_DOWN",
  RANGING = "RANGING",
  VOLATILE = "VOLATILE",
  QUIET = "QUIET",
}

export enum AlertType {
  PRICE = "PRICE",
  TRADE = "TRADE",
  RISK = "RISK",
  ANOMALY = "ANOMALY",
  SYSTEM = "SYSTEM",
}

export enum Exchange {
  BINANCE = "BINANCE",
  UPBIT = "UPBIT",
  BYBIT = "BYBIT",
  BITHUMB = "BITHUMB",
}

export enum Timeframe {
  M1 = "1m",
  M5 = "5m",
  M15 = "15m",
  H1 = "1h",
  H4 = "4h",
  D1 = "1d",
  W1 = "1w",
}

// ===== Interfaces =====
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
}

export interface TradeSignal {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: number;
  amount: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence: number;
  strategy: StrategyType;
  reason: string;
}

export interface PortfolioSummary {
  totalValue: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  totalPnL: number;
  totalPnLPercent: number;
  positions: PositionInfo[];
}

export interface PositionInfo {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  dailyVaR: number;
  consecutiveLosses: number;
}

export interface BacktestConfig {
  symbol: string;
  strategy: StrategyType;
  startDate: string;
  endDate: string;
  initialCapital: number;
  params: Record<string, number>;
}

export interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  equityCurve: { date: string; value: number }[];
  trades: { date: string; side: string; price: number; quantity?: number; pnl: number; reason?: string }[];
  dataSource?: string;
  priceRange?: { start: number; end: number; high: number; low: number };
}

export interface SentimentData {
  fearGreedIndex: number;
  fearGreedLabel: string;
  socialScore: number;
  newsScore: number;
  whaleActivity: string;
  timestamp: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  imbalance: number;
  spreadBps: number;
  timestamp: number;
}

export interface RegimeState {
  current: MarketRegime;
  probability: number;
  history: { date: string; regime: MarketRegime }[];
}

// ===== WebSocket Events =====
export interface WSEvents {
  "ticker:update": Ticker;
  "bot:status": { botId: string; status: BotStatus };
  "trade:executed": { botId: string; symbol: string; side: OrderSide; price: number; amount: number };
  "alert:new": { type: AlertType; message: string; severity: "info" | "warning" | "critical" };
  "portfolio:update": PortfolioSummary;
  "regime:change": RegimeState;
}

// ===== Paper Trading =====
export interface PaperTradeSummary {
  balance: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPct: number;
  netPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  equityCurve: { date: string; value: number }[];
  dailyPnl: { date: string; pnl: number }[];
}

export interface PaperTradeLogEntry {
  botId: string;
  timestamp: number;
  signal: {
    action: string;
    confidence: number;
    reason: string;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  execution: {
    fillPrice: number;
    amount: number;
    side: 'buy' | 'sell';
    fee: number;
  } | null;
  position: {
    isOpen: boolean;
    side: 'long' | 'short' | null;
    entryPrice: number;
    amount: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  } | null;
  paperBalance: number;
}

// ===== API Response =====
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
