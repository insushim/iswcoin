"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { Exchange } from "@cryptosentinel/shared";
import api, { endpoints } from "@/lib/api";
import {
  Key,
  Bell,
  User,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  Shield,
  MessageCircle,
  Check,
} from "lucide-react";

interface ApiKeyEntry {
  id: string;
  exchange: Exchange;
  label: string;
  keyPreview: string;
  createdAt: string;
  isActive: boolean;
}

const DEMO_API_KEYS: ApiKeyEntry[] = [
  {
    id: "1",
    exchange: Exchange.BINANCE,
    label: "Main Trading",
    keyPreview: "sk-...x3f2",
    createdAt: "2025-01-10",
    isActive: true,
  },
  {
    id: "2",
    exchange: Exchange.BYBIT,
    label: "Backup",
    keyPreview: "by-...a9d1",
    createdAt: "2025-01-15",
    isActive: false,
  },
];

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Profile state
  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [profileEmail, setProfileEmail] = useState(user?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>(DEMO_API_KEYS);
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKeyExchange, setNewKeyExchange] = useState<Exchange>(Exchange.BINANCE);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiSecret, setNewApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // Notification state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [notifyTrades, setNotifyTrades] = useState(true);
  const [notifyAlerts, setNotifyAlerts] = useState(true);
  const [notifyDailyReport, setNotifyDailyReport] = useState(true);
  const [notifyRegimeChange, setNotifyRegimeChange] = useState(false);

  // Load API keys and settings from server
  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get(endpoints.settings.apiKeys);
      const data = res.data.data ?? res.data;
      if (Array.isArray(data) && data.length > 0) {
        setApiKeys(data.map((k: Record<string, unknown>) => ({
          id: (k.id as string) || "",
          exchange: (k.exchange as Exchange) || Exchange.BINANCE,
          label: (k.label as string) || "",
          keyPreview: (k.keyPreview as string) || (k.key_preview as string) || "",
          createdAt: (k.createdAt as string) || (k.created_at as string) || "",
          isActive: Boolean(k.isActive ?? k.is_active ?? true),
        })));
      }
    } catch {
      // Keep demo keys
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const showSaveMessage = (msg: string) => {
    setSaveStatus(msg);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleSaveProfile = async () => {
    try {
      await api.put(endpoints.settings.profile, { name: profileName, email: profileEmail });
      if (newPassword && newPassword === confirmPassword) {
        await api.put("/settings/password", { password: newPassword });
        setNewPassword("");
        setConfirmPassword("");
      }
      showSaveMessage("프로필이 저장되었습니다");
    } catch {
      showSaveMessage("프로필 저장에 실패했습니다");
    }
  };

  const handleSaveNotifications = async () => {
    try {
      await api.put(endpoints.settings.notifications, {
        telegramEnabled,
        telegramChatId,
        notifyTrades,
        notifyAlerts,
        notifyDailyReport,
        notifyRegimeChange,
      });
      showSaveMessage("알림 설정이 저장되었습니다");
    } catch {
      showSaveMessage("알림 설정 저장에 실패했습니다");
    }
  };

  const handleAddKey = async () => {
    if (!newKeyLabel || !newApiKey || !newApiSecret) return;

    const newEntry: ApiKeyEntry = {
      id: String(Date.now()),
      exchange: newKeyExchange,
      label: newKeyLabel,
      keyPreview: `${newApiKey.slice(0, 4)}...${newApiKey.slice(-4)}`,
      createdAt: new Date().toISOString().split("T")[0],
      isActive: true,
    };

    // Save to server
    try {
      await api.post(endpoints.settings.apiKeys, {
        exchange: newKeyExchange,
        label: newKeyLabel,
        apiKey: newApiKey,
        secretKey: newApiSecret,
      });
    } catch {
      // Continue with local state update
    }

    setApiKeys([...apiKeys, newEntry]);
    setNewKeyLabel("");
    setNewApiKey("");
    setNewApiSecret("");
    setShowAddKey(false);
  };

  const handleRemoveKey = async (id: string) => {
    try {
      await api.delete(`${endpoints.settings.apiKeys}/${id}`);
    } catch {
      // Continue with local state update
    }
    setApiKeys(apiKeys.filter((k) => k.id !== id));
  };

  const exchangeOptions = Object.values(Exchange).map((e) => ({
    label: e,
    value: e,
  }));

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Save status toast */}
      {saveStatus && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-slate-800 border border-slate-700 px-4 py-3 shadow-lg animate-fade-in">
          <Check className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-white">{saveStatus}</span>
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader
          action={
            <Button variant="primary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={handleSaveProfile}>
              저장
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-slate-400" />
            프로필
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="이름"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <Input
            label="이메일"
            type="email"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="새 비밀번호"
            type="password"
            placeholder="변경하지 않으려면 비워두세요"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            label="비밀번호 확인"
            type="password"
            placeholder="새 비밀번호를 다시 입력하세요"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAddKey(!showAddKey)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              키 추가
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-slate-400" />
            API 키
          </div>
        </CardHeader>

        {/* Existing keys */}
        <div className="space-y-3">
          {apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-800/20 px-4 py-3"
            >
              <div className="flex items-center gap-4">
                <div className="rounded-md bg-slate-700 px-2 py-1">
                  <span className="text-xs font-bold text-white">{key.exchange}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{key.label}</p>
                  <p className="text-xs text-slate-500">
                    {key.keyPreview} &middot; 추가일 {key.createdAt}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={key.isActive ? "running" : "stopped"} dot>
                  {key.isActive ? "활성" : "비활성"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-400 hover:text-red-300"
                  onClick={() => handleRemoveKey(key.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {apiKeys.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">
              API 키가 설정되지 않았습니다
            </p>
          )}
        </div>

        {/* Add key form */}
        {showAddKey && (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-4">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              새 API 키 추가
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="거래소"
                options={exchangeOptions}
                value={newKeyExchange}
                onChange={(e) => setNewKeyExchange(e.target.value as Exchange)}
              />
              <Input
                label="라벨"
                placeholder="예: 메인 트레이딩"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
              />
            </div>
            <Input
              label="API 키"
              placeholder="API 키를 입력하세요"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
            />
            <div className="relative">
              <Input
                label="API 시크릿"
                type={showSecret ? "text" : "password"}
                placeholder="API 시크릿을 입력하세요"
                value={newApiSecret}
                onChange={(e) => setNewApiSecret(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-8 text-slate-400 hover:text-white"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-amber-400">
              API 시크릿은 암호화되어 안전하게 저장됩니다. 절대 공유하지 마세요.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowAddKey(false)}>
                취소
              </Button>
              <Button variant="primary" size="sm" onClick={handleAddKey}>
                키 추가
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-slate-400" />
            알림 설정
          </div>
        </CardHeader>

        {/* Telegram */}
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-800/20 px-4 py-3">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-blue-400" />
              <div>
                <p className="text-sm font-medium text-white">텔레그램 알림</p>
                <p className="text-xs text-slate-500">텔레그램 봇으로 알림 수신</p>
              </div>
            </div>
            <button
              onClick={() => setTelegramEnabled(!telegramEnabled)}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
                telegramEnabled ? "bg-emerald-600" : "bg-slate-700"
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                  telegramEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {telegramEnabled && (
            <Input
              label="텔레그램 채팅 ID"
              placeholder="텔레그램 채팅 ID를 입력하세요"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              helperText="텔레그램에서 @userinfobot으로 채팅 ID를 확인하세요"
            />
          )}

          {/* Notification types */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-300">알림 유형</p>
            {[
              { label: "거래 체결", desc: "봇이 거래를 실행할 때", state: notifyTrades, setter: setNotifyTrades },
              { label: "위험 알림", desc: "하락 및 리스크 경고", state: notifyAlerts, setter: setNotifyAlerts },
              { label: "일일 리포트", desc: "일일 손익 요약", state: notifyDailyReport, setter: setNotifyDailyReport },
              { label: "국면 변화", desc: "시장 국면 전환", state: notifyRegimeChange, setter: setNotifyRegimeChange },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg px-4 py-2.5 hover:bg-slate-800/30 transition-colors"
              >
                <div>
                  <p className="text-sm text-white">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
                <button
                  onClick={() => item.setter(!item.state)}
                  className={cn(
                    "relative h-6 w-11 rounded-full transition-colors",
                    item.state ? "bg-emerald-600" : "bg-slate-700"
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                      item.state ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={handleSaveNotifications}>
            알림 설정 저장
          </Button>
        </div>
      </Card>
    </div>
  );
}
