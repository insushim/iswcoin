-- CryptoSentinel Pro - D1 Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  telegram_chat_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  api_key TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  passphrase TEXT,
  label TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'DCA',
  status TEXT NOT NULL DEFAULT 'STOPPED',
  exchange TEXT NOT NULL DEFAULT 'binance',
  symbol TEXT NOT NULL DEFAULT 'BTC/USDT',
  timeframe TEXT DEFAULT '1h',
  config TEXT DEFAULT '{}',
  risk_config TEXT DEFAULT '{}',
  total_profit REAL DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  max_drawdown REAL DEFAULT 0,
  sharpe_ratio REAL,
  started_at TEXT,
  stopped_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'MARKET',
  status TEXT NOT NULL DEFAULT 'OPEN',
  entry_price REAL NOT NULL,
  exit_price REAL,
  quantity REAL NOT NULL,
  pnl REAL,
  pnl_percent REAL,
  fee REAL DEFAULT 0,
  stop_loss REAL,
  take_profit REAL,
  exit_reason TEXT,
  metadata TEXT DEFAULT '{}',
  timestamp TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_value REAL DEFAULT 10000,
  daily_pnl REAL DEFAULT 0,
  positions TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  severity TEXT NOT NULL DEFAULT 'LOW',
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backtest_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT DEFAULT '1h',
  config TEXT DEFAULT '{}',
  result TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, is_read);
