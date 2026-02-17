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
    // 네트워크 에러 (서버 응답 없음)
    if (!error.response) {
      const isTimeout = error.code === "ECONNABORTED";
      const message = isTimeout
        ? "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
        : "네트워크 연결을 확인해주세요. 서버에 연결할 수 없습니다.";
      return Promise.reject(new Error(message));
    }

    const status = error.response.status;

    // 401 Unauthorized
    if (status === 401) {
      const url = error.config?.url || "";
      const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/register");
      if (!isAuthEndpoint && typeof window !== "undefined") {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
        return Promise.reject(new Error("인증이 만료되었습니다. 다시 로그인해주세요."));
      }
      // 로그인/회원가입 401 → 서버 에러 메시지 그대로 전달
    }

    // 403 Forbidden
    if (status === 403) {
      return Promise.reject(new Error("접근 권한이 없습니다."));
    }

    // 500+ Server errors
    if (status >= 500) {
      return Promise.reject(new Error("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."));
    }

    // 4xx Client errors - 서버 에러 메시지 사용
    const message =
      error.response.data?.error ||
      error.response.data?.message ||
      "요청을 처리할 수 없습니다.";

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
    performance: (id: string) => `/bots/${id}/performance`,
    trades: (id: string, page = 1, limit = 20) => `/bots/${id}/trades?page=${page}&limit=${limit}`,
    paperSummary: (id: string) => `/bots/${id}/paper/summary`,
    paperLogs: (id: string, limit = 50, offset = 0) => `/bots/${id}/paper/logs?limit=${limit}&offset=${offset}`,
    paperStats: (id: string) => `/bots/${id}/paper/stats`,
  },
  trades: {
    list: "/trades",
    get: (id: string) => `/trades/${id}`,
    stats: "/trades/summary",
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
    getNotifications: () => api.get("/settings/notifications"),
    profile: "/settings/profile",
  },
} as const;
