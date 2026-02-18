"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, User, LogOut, Settings, ChevronDown, Check } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import api, { endpoints } from "@/lib/api";

interface AlertItem {
  id: string;
  type: "PRICE" | "TRADE" | "RISK" | "ANOMALY" | "SYSTEM";
  message: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isRead: boolean;
  createdAt: string;
}

const pageNames: Record<string, string> = {
  "/": "대시보드",
  "/bots": "트레이딩 봇",
  "/trades": "거래 내역",
  "/market": "시장 분석",
  "/backtest": "백테스트",
  "/portfolio": "포트폴리오",
  "/regime": "시장 국면",
  "/settings": "설정",
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

function getAlertIcon(type: AlertItem["type"]): string {
  switch (type) {
    case "TRADE": return "💹";
    case "RISK": return "⚠️";
    case "PRICE": return "📊";
    case "ANOMALY": return "🔍";
    case "SYSTEM": return "⚙️";
    default: return "🔔";
  }
}

function getSeverityColor(severity: AlertItem["severity"]): string {
  switch (severity) {
    case "CRITICAL": return "text-red-400";
    case "HIGH": return "text-orange-400";
    case "MEDIUM": return "text-yellow-400";
    case "LOW": return "text-slate-400";
    default: return "text-slate-400";
  }
}

export function Header() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const pageTitle = pageNames[pathname] || "CryptoSentinel";

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await api.get(endpoints.settings.alerts, { params: { limit: 30 } });
      setAlerts(res.data.data ?? []);
      setUnreadCount(res.data.unreadCount ?? 0);
    } catch {
      // 알림 조회 실패 시 무시 (인증 만료 등)
    }
  }, []);

  // 알림 주기적 조회 (30초마다)
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // 알림 패널 열 때 새로 조회
  useEffect(() => {
    if (showNotifications) {
      fetchAlerts();
    }
  }, [showNotifications, fetchAlerts]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setLoading(true);
    try {
      await api.post(endpoints.settings.alertsRead);
      setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <header role="banner" className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 backdrop-blur-md">
      {/* Page title */}
      <h1 className="text-xl font-semibold text-white">{pageTitle}</h1>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="알림"
            aria-expanded={showNotifications}
            className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-12 w-96 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl animate-slide-down">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">
                  알림 {unreadCount > 0 && <span className="ml-1 text-emerald-400">({unreadCount})</span>}
                </h3>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={loading}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    모두 읽음
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    알림이 없습니다
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors ${
                        !alert.isRead ? "bg-slate-800/20" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5">{getAlertIcon(alert.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!alert.isRead ? "text-white font-medium" : "text-slate-300"}`}>
                            {alert.message.split("\n")[0]}
                          </p>
                          {alert.message.split("\n").length > 1 && (
                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                              {alert.message.split("\n").slice(1).join(" | ")}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] ${getSeverityColor(alert.severity)}`}>
                              {alert.severity}
                            </span>
                            <span className="text-xs text-slate-600">
                              {formatRelativeTime(alert.createdAt)}
                            </span>
                          </div>
                        </div>
                        {!alert.isRead && (
                          <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            aria-label="사용자 메뉴"
            aria-expanded={showDropdown}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700">
              <User className="h-4 w-4" />
            </div>
            <span className="hidden text-sm font-medium md:block">
              {user?.name || "사용자"}
            </span>
            <ChevronDown className="h-4 w-4" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-12 w-48 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl animate-slide-down">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-sm font-medium text-white">{user?.name || "사용자"}</p>
                <p className="text-xs text-slate-500">{user?.email || "user@example.com"}</p>
              </div>
              <div className="p-1">
                <Link
                  href="/settings"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  설정
                </Link>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
