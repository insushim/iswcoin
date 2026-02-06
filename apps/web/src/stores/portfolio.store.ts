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
      set({ summary: res.data.data, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch portfolio";
      set({ error: message, isLoading: false });
    }
  },

  fetchHistory: async (days: number = 30) => {
    try {
      const res = await api.get(endpoints.portfolio.history, { params: { days } });
      set({ history: res.data.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch history";
      set({ error: message });
    }
  },

  fetchPositions: async () => {
    try {
      const res = await api.get(endpoints.portfolio.positions);
      set({ positions: res.data.data });
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
