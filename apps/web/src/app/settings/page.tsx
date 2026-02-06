"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { Exchange } from "@cryptosentinel/shared";
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

  // Profile state
  const [profileName, setProfileName] = useState(user?.name ?? "Trader");
  const [profileEmail, setProfileEmail] = useState(user?.email ?? "trader@example.com");

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

  const handleAddKey = () => {
    if (!newKeyLabel || !newApiKey || !newApiSecret) return;

    const newEntry: ApiKeyEntry = {
      id: String(Date.now()),
      exchange: newKeyExchange,
      label: newKeyLabel,
      keyPreview: `${newApiKey.slice(0, 4)}...${newApiKey.slice(-4)}`,
      createdAt: new Date().toISOString().split("T")[0],
      isActive: true,
    };

    setApiKeys([...apiKeys, newEntry]);
    setNewKeyLabel("");
    setNewApiKey("");
    setNewApiSecret("");
    setShowAddKey(false);
  };

  const handleRemoveKey = (id: string) => {
    setApiKeys(apiKeys.filter((k) => k.id !== id));
  };

  const exchangeOptions = Object.values(Exchange).map((e) => ({
    label: e,
    value: e,
  }));

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Profile */}
      <Card>
        <CardHeader
          action={
            <Button variant="primary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />}>
              Save
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-slate-400" />
            Profile
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="New Password"
            type="password"
            placeholder="Leave blank to keep current"
          />
          <Input
            label="Confirm Password"
            type="password"
            placeholder="Confirm new password"
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
              Add Key
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-slate-400" />
            API Keys
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
                    {key.keyPreview} &middot; Added {key.createdAt}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={key.isActive ? "running" : "stopped"} dot>
                  {key.isActive ? "Active" : "Inactive"}
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
              No API keys configured
            </p>
          )}
        </div>

        {/* Add key form */}
        {showAddKey && (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-4">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              Add New API Key
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Exchange"
                options={exchangeOptions}
                value={newKeyExchange}
                onChange={(e) => setNewKeyExchange(e.target.value as Exchange)}
              />
              <Input
                label="Label"
                placeholder="e.g., Main Trading"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
              />
            </div>
            <Input
              label="API Key"
              placeholder="Enter your API key"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
            />
            <div className="relative">
              <Input
                label="API Secret"
                type={showSecret ? "text" : "password"}
                placeholder="Enter your API secret"
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
              API secrets are encrypted and stored securely. Never share your API secret.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowAddKey(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleAddKey}>
                Add Key
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
            Notifications
          </div>
        </CardHeader>

        {/* Telegram */}
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-800/50 bg-slate-800/20 px-4 py-3">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-blue-400" />
              <div>
                <p className="text-sm font-medium text-white">Telegram Notifications</p>
                <p className="text-xs text-slate-500">Receive alerts via Telegram bot</p>
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
              label="Telegram Chat ID"
              placeholder="Enter your Telegram chat ID"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              helperText="Get your chat ID from @userinfobot on Telegram"
            />
          )}

          {/* Notification types */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-300">Notification Types</p>
            {[
              { label: "Trade Executions", desc: "When bots execute trades", state: notifyTrades, setter: setNotifyTrades },
              { label: "Risk Alerts", desc: "Drawdown and risk warnings", state: notifyAlerts, setter: setNotifyAlerts },
              { label: "Daily Reports", desc: "Daily PnL summary", state: notifyDailyReport, setter: setNotifyDailyReport },
              { label: "Regime Changes", desc: "Market regime transitions", state: notifyRegimeChange, setter: setNotifyRegimeChange },
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
          <Button variant="primary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />}>
            Save Notification Settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
