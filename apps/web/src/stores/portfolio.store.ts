import { create } from "zustand";
import type { PortfolioSummary, PositionInfo } from "@cryptosentinel/shared";
import api, { endpoints } from "@/lib/api";

interface PortfolioHistoryEntry {
  date: string;
  value: number;
  pnl: number;
}

interface PortfolioState {
  summary: PortfolioSummary | null;
  history: PortfolioHistoryEntry[];
  positions: PositionInfo[];
  isLoading: boolean;
  error: string | null;
  fetchPortfolio: () => Promise<void>;
  fetchHistory: (days?: number) => Promise<void>;
  fetchPositions: () => Promise<void>;
  updatePortfolio: (summary: PortfolioSummary) => void;
  clearError: () => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  summary: null,
  history: [],
  positions: [],
  isLoading: false,
  error: null,

  fetchPortfolio: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.portfolio.summary);
      const raw = res.data.data ?? res.data;
      set({
        summary: {
          ...raw,
          totalValue: Number(raw.totalValue ?? raw.portfolioValue ?? raw.total_value ?? 10000),
          totalPnL: Number(raw.totalPnl ?? raw.totalPnL ?? raw.totalProfit ?? raw.total_pnl ?? 0),
          dailyPnL: Number(raw.dailyPnl ?? raw.dailyPnL ?? raw.daily_pnl ?? 0),
          dailyPnLPercent: Number(raw.dailyPnLPercent ?? raw.daily_pnl_percent ?? 0),
          activeBots: Number(raw.activeBots ?? raw.active_bots ?? 0),
          winRate: Number(raw.winRate ?? raw.win_rate ?? 0),
          totalTrades: Number(raw.totalTrades ?? raw.total_trades ?? 0),
        },
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch portfolio";
      set({ error: message, isLoading: false });
    }
  },

  fetchHistory: async (days: number = 30) => {
    try {
      const res = await api.get(endpoints.portfolio.history, { params: { days } });
      const data = res.data.data ?? res.data;
      set({ history: Array.isArray(data) ? data : [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch history";
      set({ error: message });
    }
  },

  fetchPositions: async () => {
    try {
      const res = await api.get(endpoints.portfolio.positions);
      const data = res.data.data ?? res.data;
      set({ positions: Array.isArray(data) ? data : [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch positions";
      set({ error: message });
    }
  },

  updatePortfolio: (summary: PortfolioSummary) => {
    set({ summary, positions: summary.positions });
  },

  clearError: () => set({ error: null }),
}));
