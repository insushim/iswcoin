import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://cryptosentinel-api.simssijjang.workers.dev";

const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("auth_token");
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; message?: string }>) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
      }
    }

    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      "An unexpected error occurred";

    return Promise.reject(new Error(message));
  }
);

export default api;

export const endpoints = {
  auth: {
    login: "/auth/login",
    register: "/auth/register",
    me: "/auth/me",
    refresh: "/auth/refresh",
  },
  bots: {
    list: "/bots",
    create: "/bots",
    get: (id: string) => `/bots/${id}`,
    update: (id: string) => `/bots/${id}`,
    delete: (id: string) => `/bots/${id}`,
    start: (id: string) => `/bots/${id}/start`,
    stop: (id: string) => `/bots/${id}/stop`,
  },
  trades: {
    list: "/trades",
    get: (id: string) => `/trades/${id}`,
    stats: "/trades/stats",
  },
  market: {
    tickers: "/market/tickers",
    ohlcv: (symbol: string) => `/market/ohlcv/${symbol}`,
    indicators: (symbol: string) => `/market/indicators/${symbol}`,
    sentiment: "/market/sentiment",
    orderbook: (symbol: string) => `/market/orderbook/${symbol}`,
  },
  portfolio: {
    summary: "/portfolio/summary",
    history: "/portfolio/history",
    positions: "/portfolio/positions",
  },
  backtest: {
    run: "/backtest/run",
    results: "/backtest/results",
  },
  regime: {
    current: "/regime/current",
    history: "/regime/history",
  },
  settings: {
    apiKeys: "/settings/api-keys",
    notifications: "/settings/notifications",
    profile: "/settings/profile",
  },
} as const;
