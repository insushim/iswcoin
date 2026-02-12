// REST 폴링 기반으로 전환됨 (Workers는 WebSocket 미지원)
// 이 파일은 호환성을 위해 유지하되, socket.io-client 의존성은 불필요

import type {
  Ticker,
  BotStatus,
  OrderSide,
  AlertType,
  PortfolioSummary,
  RegimeState,
} from "@cryptosentinel/shared";

interface ServerToClientEvents {
  "ticker:update": (data: Ticker) => void;
  "bot:status": (data: { botId: string; status: BotStatus }) => void;
  "trade:executed": (data: {
    botId: string;
    symbol: string;
    side: OrderSide;
    price: number;
    amount: number;
  }) => void;
  "alert:new": (data: {
    type: AlertType;
    message: string;
    severity: "info" | "warning" | "critical";
  }) => void;
  "portfolio:update": (data: PortfolioSummary) => void;
  "regime:change": (data: RegimeState) => void;
}

interface ClientToServerEvents {
  "subscribe:ticker": (symbol: string) => void;
  "unsubscribe:ticker": (symbol: string) => void;
  "subscribe:bot": (botId: string) => void;
  "unsubscribe:bot": (botId: string) => void;
}

// 타입 export (다른 곳에서 사용 가능)
export type { ServerToClientEvents, ClientToServerEvents };

// noop 함수들 (REST 폴링으로 대체됨)
export function getSocket() { return null; }
export function connectSocket() { return null; }
export function disconnectSocket() { /* noop */ }
export function subscribeTicker(_symbol: string) { /* noop */ }
export function unsubscribeTicker(_symbol: string) { /* noop */ }
export function subscribeBot(_botId: string) { /* noop */ }
export function unsubscribeBot(_botId: string) { /* noop */ }
