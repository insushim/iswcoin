"use client";

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuthStore } from "@/stores/auth.store";
import { useMarketStore } from "@/stores/market.store";

interface SocketContextValue {
  socket: null;
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

// REST polling provider (replaces Socket.IO since Workers doesn't support WebSockets)
export function SocketProvider({ children }: SocketProviderProps) {
  const { isAuthenticated } = useAuthStore();
  const { fetchTickers } = useMarketStore();
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsConnected(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchTickers().then(() => setIsConnected(true)).catch(() => {});

    // Poll market tickers every 30 seconds
    intervalRef.current = setInterval(() => {
      fetchTickers().catch(() => {});
    }, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isAuthenticated, fetchTickers]);

  return (
    <SocketContext.Provider value={{ socket: null, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
