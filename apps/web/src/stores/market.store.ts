import { create } from "zustand";
import type { Ticker, MarketRegime, SentimentData } from "@cryptosentinel/shared";
import api, { endpoints } from "@/lib/api";

interface Indicators {
  rsi: number;
  macd: { line: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number };
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  volume24h: number;
  volumeChange: number;
}

interface MarketState {
  tickers: Map<string, Ticker>;
  indicators: Indicators | null;
  regime: MarketRegime | null;
  regimeProbability: number;
  sentiment: SentimentData | null;
  selectedSymbol: string;
  isLoading: boolean;
  error: string | null;
  updateTicker: (ticker: Ticker) => void;
  setSelectedSymbol: (symbol: string) => void;
  fetchIndicators: (symbol: string) => Promise<void>;
  fetchSentiment: () => Promise<void>;
  fetchTickers: () => Promise<void>;
  clearError: () => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  tickers: new Map(),
  indicators: null,
  regime: null,
  regimeProbability: 0,
  sentiment: null,
  selectedSymbol: "BTCUSDT",
  isLoading: false,
  error: null,

  updateTicker: (ticker: Ticker) => {
    set((state) => {
      const newTickers = new Map(state.tickers);
      newTickers.set(ticker.symbol, ticker);
      return { tickers: newTickers };
    });
  },

  setSelectedSymbol: (symbol: string) => {
    set({ selectedSymbol: symbol });
  },

  fetchTickers: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(endpoints.market.tickers);
      const tickerList = res.data.data as Ticker[];
      const tickerMap = new Map<string, Ticker>();
      tickerList.forEach((t) => tickerMap.set(t.symbol, t));
      set({ tickers: tickerMap, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch tickers";
      set({ error: message, isLoading: false });
    }
  },

  fetchIndicators: async (symbol: string) => {
    try {
      const res = await api.get(endpoints.market.indicators(symbol));
      set({ indicators: res.data.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch indicators";
      set({ error: message });
    }
  },

  fetchSentiment: async () => {
    try {
      const res = await api.get(endpoints.market.sentiment);
      set({ sentiment: res.data.data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch sentiment";
      set({ error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
