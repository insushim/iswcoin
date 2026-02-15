import { create } from "zustand";
import api, { endpoints } from "@/lib/api";

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
  fetchMe: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post(endpoints.auth.login, { email, password });
      const data = res.data.data ?? res.data;
      const { token, user } = data;
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      set({ user, token, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "로그인에 실패했습니다";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  register: async (name: string, email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post(endpoints.auth.register, { name, email, password });
      const data = res.data.data ?? res.data;
      const { token, user } = data;
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      set({ user, token, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "회원가입에 실패했습니다";
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("auth_token");
    const userStr = localStorage.getItem("auth_user");
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        set({ user, token, isAuthenticated: true });
      } catch {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      }
    }
  },

  fetchMe: async () => {
    try {
      const res = await api.get(endpoints.auth.me);
      const data = res.data.data ?? res.data;
      set({ user: data.user ?? data });
    } catch (err: unknown) {
      // 네트워크 오류(응답 없음)는 현재 상태 유지 - 일시적 연결 문제
      const axiosErr = err as { response?: { status?: number } };
      if (!axiosErr.response) {
        return;
      }
      // 401/403은 api.ts 인터셉터가 처리하므로 여기서는 로그아웃하지 않음
      if (axiosErr.response.status === 401 || axiosErr.response.status === 403) {
        return;
      }
      // 기타 서버 오류도 현재 상태 유지
    }
  },

  clearError: () => set({ error: null }),
}));
