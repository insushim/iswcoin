"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type Socket } from "socket.io-client";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth.store";
import { useMarketStore } from "@/stores/market.store";
import { usePortfolioStore } from "@/stores/portfolio.store";
import { useBotStore } from "@/stores/bot.store";
import type {
  Ticker,
  PortfolioSummary,
  BotStatus,
  OrderSide,
  AlertType,
  RegimeState,
} from "@cryptosentinel/shared";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

export function useSocket() {
  return useContext(SocketContext);
}

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { token, isAuthenticated } = useAuthStore();
  const { updateTicker } = useMarketStore();
  const { updatePortfolio } = usePortfolioStore();
  const { updateBotStatus } = useBotStore();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectSocket();
      setIsConnected(false);
      return;
    }

    const socket = connectSocket(token);
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // Register event handlers
    socket.on("ticker:update", (data: Ticker) => {
      updateTicker(data);
    });

    socket.on("portfolio:update", (data: PortfolioSummary) => {
      updatePortfolio(data);
    });

    socket.on("bot:status", (data: { botId: string; status: BotStatus }) => {
      updateBotStatus(data.botId, data.status);
    });

    socket.on("trade:executed", (data: {
      botId: string;
      symbol: string;
      side: OrderSide;
      price: number;
      amount: number;
    }) => {
      // Could dispatch to a notification store or trades store
      console.log("Trade executed:", data);
    });

    socket.on("alert:new", (data: {
      type: AlertType;
      message: string;
      severity: "info" | "warning" | "critical";
    }) => {
      console.log("Alert:", data);
    });

    socket.on("regime:change", (data: RegimeState) => {
      console.log("Regime change:", data);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("ticker:update");
      socket.off("portfolio:update");
      socket.off("bot:status");
      socket.off("trade:executed");
      socket.off("alert:new");
      socket.off("regime:change");
      disconnectSocket();
    };
  }, [isAuthenticated, token, updateTicker, updatePortfolio, updateBotStatus]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
