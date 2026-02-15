import { create } from "zustand";
import {
  BotStatus,
  StrategyType,
  TradingMode,
  Exchange,
} from "@cryptosentinel/shared";
import api, { endpoints } from "@/lib/api";

export interface Bot {
  id: string;
  name: string;
  symbol: string;
  exchange: Exchange;
  strategy: StrategyType;
  mode: TradingMode;
  status: BotStatus;
  config: Record<string, number | string | boolean>;
  pnl: number;
  pnlPercent: number;
  totalTrades: number;
  winRate: number;
  createdAt: string;
  updatedAt: string;
}

interface CreateBotPayload {
  name: string;
  symbol: string;
  exchange: Exchange;
  strategy: StrategyType;
  mode: TradingMode;
  config: Record<string, number | string | boolean>;
}

interface BotState {
  bots: Bot[];
  selectedBot: Bot | null;
  isLoading: boolean;
  error: string | null;
  fetchBots: () => Promise<void>;
  fetchBot: (id: string) => Promise<void>;
  createBot: (payload: CreateBotPayload) => Promise<Bot>;
  startBot: (id: string) => Promise<void>;
  stopBot: (id: string) => Promise<void>;
  deleteBot: (id: string) => Promise<void>;
  updateBotStatus: (botId: string, status: BotStatus) => void;
  setSelectedBot: (bot: Bot | null) => void;
  clearError: () => void;
}

function mapBot(raw: Record<string, unknown>): Bot {
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

export const useBotStore = create<BotState>((set, get) => ({
  bots: [],
  selectedBot: null,
  isLoading: false,
  error: null,

  fetchBots: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.bots.list);
      const raw = res.data.data ?? res.data;
      const botList = Array.isArray(raw) ? raw.map(mapBot) : [];
      set({ bots: botList, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 목록을 불러오지 못했습니다";
      set({ error: message, isLoading: false });
    }
  },

  fetchBot: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.bots.get(id));
      const raw = res.data.data ?? res.data;
      set({ selectedBot: mapBot(raw), isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 정보를 불러오지 못했습니다";
      set({ error: message, isLoading: false });
    }
  },

  createBot: async (payload: CreateBotPayload) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post(endpoints.bots.create, payload);
      const raw = res.data.data ?? res.data;
      const newBot = mapBot(raw);
      set((state) => ({
        bots: [...state.bots, newBot],
        isLoading: false,
      }));
      return newBot;
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 생성에 실패했습니다";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  startBot: async (id: string) => {
    try {
      await api.post(endpoints.bots.start(id));
      set((state) => ({
        bots: state.bots.map((b) =>
          b.id === id ? { ...b, status: BotStatus.RUNNING } : b
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 시작에 실패했습니다";
      set({ error: message });
    }
  },

  stopBot: async (id: string) => {
    try {
      await api.post(endpoints.bots.stop(id));
      set((state) => ({
        bots: state.bots.map((b) =>
          b.id === id ? { ...b, status: BotStatus.STOPPED } : b
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 중지에 실패했습니다";
      set({ error: message });
    }
  },

  deleteBot: async (id: string) => {
    try {
      await api.delete(endpoints.bots.delete(id));
      set((state) => ({
        bots: state.bots.filter((b) => b.id !== id),
        selectedBot: state.selectedBot?.id === id ? null : state.selectedBot,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "봇 삭제에 실패했습니다";
      set({ error: message });
    }
  },

  updateBotStatus: (botId: string, status: BotStatus) => {
    set((state) => ({
      bots: state.bots.map((b) =>
        b.id === botId ? { ...b, status } : b
      ),
    }));
  },

  setSelectedBot: (bot: Bot | null) => set({ selectedBot: bot }),

  clearError: () => set({ error: null }),
}));
