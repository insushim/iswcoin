// ===== Bot Runner 공유 타입 정의 =====

export interface TrackedPosition {
  isOpen: boolean;
  side: "long" | "short";
  entryPrice: number;
  amount: number;
  totalCost: number;
  timestamp: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface PaperTradeLog {
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
    side: "buy" | "sell";
    fee: number;
  } | null;
  position: {
    isOpen: boolean;
    side: "long" | "short" | null;
    entryPrice: number;
    amount: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  } | null;
  paperBalance: number;
}

export interface ActiveBotState {
  running: boolean;
  stopped: boolean;
  timerId?: ReturnType<typeof setTimeout>;
  loopCount: number;
  peakEquity: number;
}

/**
 * BotRunnerState: 모든 하위 모듈이 공유하는 상태 참조
 * 같은 Map 인스턴스를 공유하여 일관성 보장
 */
export interface BotRunnerState {
  positions: Map<string, TrackedPosition>;
  paperBalances: Map<string, Record<string, number>>;
  paperTradeLogs: Map<string, PaperTradeLog[]>;
  paperPositions: Map<string, Map<string, TrackedPosition>>;
  activeBots: Map<string, ActiveBotState>;
}

export interface TradeSignalInput {
  action: string;
  confidence: number;
  reason: string;
  price: number;
  stopLoss?: number;
  takeProfit?: number;
  metadata?: Record<string, number | string>;
}

// 매직 넘버 상수화
export const MAX_PAPER_LOGS = 1000;
export const MIN_CONFIDENCE_THRESHOLD = 0.15;
export const MIN_ORDER_VALUE_USDT = 10;
export const PAPER_SAVE_INTERVAL = 10; // 매 N회 루프마다 Paper 상태 저장
export const RECONCILE_INTERVAL = 10; // 매 N회 루프마다 포지션 대사 (REAL만)
