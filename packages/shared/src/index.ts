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
}

export enum MarketRegime {
  BULL_HIGH_VOL = "BULL_HIGH_VOL",
  BULL_LOW_VOL = "BULL_LOW_VOL",
  BEAR_HIGH_VOL = "BEAR_HIGH_VOL",
  BEAR_LOW_VOL = "BEAR_LOW_VOL",
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
  trades: { date: string; side: string; price: number; pnl: number }[];
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

// ===== API Response =====
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
