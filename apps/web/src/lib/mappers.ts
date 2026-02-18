import {
  BotStatus,
  StrategyType,
  TradingMode,
  Exchange,
  OrderSide,
} from "@cryptosentinel/shared";
import type { Bot } from "@/stores/bot.store";

// ---------------------------------------------------------------------------
// Bot Detail 인터페이스 (bot-detail-client.tsx에서 사용)
// ---------------------------------------------------------------------------
export interface BotDetail {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  strategy: string;
  mode: string;
  status: string;
  config: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// BotPerformance 인터페이스 (bot-detail-client.tsx에서 사용)
// ---------------------------------------------------------------------------
export interface BotPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  totalFees: number;
  winRate: number;
  maxDrawdown: number;
  netPnl: number;
}

// ---------------------------------------------------------------------------
// Trade 인터페이스 (bot-detail-client.tsx에서 사용)
// ---------------------------------------------------------------------------
export interface Trade {
  id: string;
  side: string;
  price: number;
  amount: number;
  pnl: number | null;
  fee: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// TradeRow 인터페이스 (trades/page.tsx에서 사용)
// ---------------------------------------------------------------------------
export interface TradeRow {
  id: string;
  symbol: string;
  side: OrderSide;
  type: string;
  price: number;
  amount: number;
  total: number;
  fee: number;
  pnl: number;
  botName: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// mapBot - API 응답을 Bot 스토어 타입으로 변환
// ---------------------------------------------------------------------------
export function mapBot(raw: Record<string, unknown>): Bot {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || "",
    symbol: ((raw.symbol as string) || "BTC/USDT").replace("/", ""),
    exchange: ((raw.exchange as string) || "BINANCE").toUpperCase() as Exchange,
    strategy: (raw.strategy as StrategyType) || StrategyType.DCA,
    mode: (raw.mode as TradingMode) || (raw.trading_mode as TradingMode) || TradingMode.PAPER,
    status: (raw.status as BotStatus) || BotStatus.STOPPED,
    config: typeof raw.config === "string" ? (() => { try { return JSON.parse(raw.config as string || "{}"); } catch { return {}; } })() : (raw.config as Record<string, number | string | boolean>) || {},
    pnl: Number(raw.pnl ?? raw.total_profit ?? 0),
    pnlPercent: Number(raw.pnlPercent ?? raw.pnl_percent ?? 0),
    totalTrades: Number(raw.totalTrades ?? raw.total_trades ?? 0),
    winRate: Number(raw.winRate ?? raw.win_rate ?? 0),
    createdAt: (raw.createdAt as string) || (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) || (raw.updated_at as string) || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// mapBotDetail - API 응답을 BotDetail 타입으로 변환
// ---------------------------------------------------------------------------
export function mapBotDetail(raw: Record<string, unknown>): BotDetail {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || "",
    symbol: ((raw.symbol as string) || "").replace("/", ""),
    exchange: ((raw.exchange as string) || "").toUpperCase(),
    strategy: (raw.strategy as string) || "",
    mode: (raw.mode as string) || (raw.trading_mode as string) || "PAPER",
    status: (raw.status as string) || "STOPPED",
    config:
      typeof raw.config === "string"
        ? (() => {
            try {
              return JSON.parse(raw.config as string);
            } catch {
              return {};
            }
          })()
        : (raw.config as Record<string, unknown>) || {},
    createdAt:
      (raw.createdAt as string) ||
      (raw.created_at as string) ||
      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// mapPerformance - API 응답을 BotPerformance 타입으로 변환
// ---------------------------------------------------------------------------
export function mapPerformance(raw: Record<string, unknown>): BotPerformance {
  return {
    totalTrades: Number(raw.totalTrades ?? raw.total_trades ?? 0),
    wins: Number(raw.wins ?? 0),
    losses: Number(raw.losses ?? 0),
    totalPnl: Number(raw.totalPnl ?? raw.total_pnl ?? 0),
    totalFees: Number(raw.totalFees ?? raw.total_fees ?? 0),
    winRate: Number(raw.winRate ?? raw.win_rate ?? 0),
    maxDrawdown: Number(raw.maxDrawdown ?? raw.max_drawdown ?? 0),
    netPnl: Number(raw.netPnl ?? raw.net_pnl ?? 0),
  };
}

// ---------------------------------------------------------------------------
// mapTrade - API 응답을 Trade 타입으로 변환 (봇 상세 페이지용)
// ---------------------------------------------------------------------------
export function mapTrade(raw: Record<string, unknown>): Trade {
  return {
    id: (raw.id as string) || "",
    side: (raw.side as string) || "BUY",
    price: Number(raw.entry_price ?? raw.entryPrice ?? raw.price ?? 0),
    amount: Number(raw.quantity ?? raw.amount ?? 0),
    pnl: raw.pnl != null ? Number(raw.pnl) : null,
    fee: raw.fee != null ? Number(raw.fee) : null,
    createdAt:
      (raw.createdAt as string) ||
      (raw.created_at as string) ||
      (raw.timestamp as string) ||
      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// mapTradeRow - API 응답을 TradeRow 타입으로 변환 (거래 내역 페이지용)
// ---------------------------------------------------------------------------
export function mapTradeRow(raw: Record<string, unknown>): TradeRow {
  const price = Number(raw.entry_price ?? raw.entryPrice ?? raw.price ?? 0);
  const amount = Number(raw.quantity ?? raw.amount ?? 0);
  return {
    id: (raw.id as string) || "",
    symbol: ((raw.symbol as string) || "").replace("/", ""),
    side: (raw.side as OrderSide) || OrderSide.BUY,
    type: (raw.order_type as string) || (raw.type as string) || "MARKET",
    price,
    amount,
    total: price * amount,
    fee: Number(raw.fee ?? 0),
    pnl: Number(raw.pnl ?? 0),
    botName: (raw.botName as string) || (raw.bot_name as string) || "",
    timestamp: (raw.timestamp as string) || (raw.created_at as string) || new Date().toISOString(),
  };
}
