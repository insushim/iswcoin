import { io, Socket } from "socket.io-client";
import type {
  Ticker,
  BotStatus,
  OrderSide,
  AlertType,
  PortfolioSummary,
  RegimeState,
} from "@cryptosentinel/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4000";

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

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io(WS_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      transports: ["websocket", "polling"],
    }) as TypedSocket;
  }
  return socket;
}

export function connectSocket(token?: string): TypedSocket {
  const s = getSocket();

  if (token) {
    s.auth = { token };
  }

  if (!s.connected) {
    s.connect();
  }

  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function subscribeTicker(symbol: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit("subscribe:ticker", symbol);
  }
}

export function unsubscribeTicker(symbol: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit("unsubscribe:ticker", symbol);
  }
}

export function subscribeBot(botId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit("subscribe:bot", botId);
  }
}

export function unsubscribeBot(botId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit("unsubscribe:bot", botId);
  }
}
