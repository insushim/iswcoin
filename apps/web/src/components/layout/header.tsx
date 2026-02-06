"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, User, LogOut, Settings, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";

const pageNames: Record<string, string> = {
  "/": "Dashboard",
  "/bots": "Trading Bots",
  "/trades": "Trade History",
  "/market": "Market Analysis",
  "/backtest": "Backtest",
  "/portfolio": "Portfolio",
  "/regime": "Market Regime",
  "/settings": "Settings",
};

export function Header() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const pageTitle = pageNames[pathname] || "CryptoSentinel";

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

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 backdrop-blur-md">
      {/* Page title */}
      <h1 className="text-xl font-semibold text-white">{pageTitle}</h1>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500" />
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-12 w-80 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl animate-slide-down">
              <div className="border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">Notifications</h3>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <div className="px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors">
                  <p className="text-sm text-white">Bot &quot;BTC Momentum&quot; executed BUY</p>
                  <p className="text-xs text-slate-500 mt-1">2 minutes ago</p>
                </div>
                <div className="px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors">
                  <p className="text-sm text-white">Market regime changed to Bull High Vol</p>
                  <p className="text-xs text-slate-500 mt-1">15 minutes ago</p>
                </div>
                <div className="px-4 py-3 hover:bg-slate-800/50 transition-colors">
                  <p className="text-sm text-white">Daily PnL report: +$342.50</p>
                  <p className="text-xs text-slate-500 mt-1">1 hour ago</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700">
              <User className="h-4 w-4" />
            </div>
            <span className="hidden text-sm font-medium md:block">
              {user?.name || "User"}
            </span>
            <ChevronDown className="h-4 w-4" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-12 w-48 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl animate-slide-down">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-sm font-medium text-white">{user?.name || "User"}</p>
                <p className="text-xs text-slate-500">{user?.email || "user@example.com"}</p>
              </div>
              <div className="p-1">
                <a
                  href="/settings"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </a>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
