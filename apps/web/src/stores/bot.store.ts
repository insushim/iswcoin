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

export const useBotStore = create<BotState>((set, get) => ({
  bots: [],
  selectedBot: null,
  isLoading: false,
  error: null,

  fetchBots: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.bots.list);
      set({ bots: res.data.data, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch bots";
      set({ error: message, isLoading: false });
    }
  },

  fetchBot: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.bots.get(id));
      set({ selectedBot: res.data.data, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch bot";
      set({ error: message, isLoading: false });
    }
  },

  createBot: async (payload: CreateBotPayload) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post(endpoints.bots.create, payload);
      const newBot = res.data.data as Bot;
      set((state) => ({
        bots: [...state.bots, newBot],
        isLoading: false,
      }));
      return newBot;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create bot";
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
      const message = err instanceof Error ? err.message : "Failed to start bot";
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
      const message = err instanceof Error ? err.message : "Failed to stop bot";
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
      const message = err instanceof Error ? err.message : "Failed to delete bot";
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
