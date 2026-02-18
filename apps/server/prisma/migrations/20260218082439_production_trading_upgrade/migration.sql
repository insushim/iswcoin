-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('BINANCE', 'UPBIT', 'BYBIT', 'BITHUMB');

-- CreateEnum
CREATE TYPE "Strategy" AS ENUM ('DCA', 'GRID', 'MARTINGALE', 'TRAILING', 'MOMENTUM', 'MEAN_REVERSION', 'RL_AGENT', 'STAT_ARB', 'SCALPING', 'FUNDING_ARB', 'ENSEMBLE');

-- CreateEnum
CREATE TYPE "BotMode" AS ENUM ('PAPER', 'REAL');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('IDLE', 'RUNNING', 'STOPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('PRICE', 'TRADE', 'RISK', 'ANOMALY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "strategy" "Strategy" NOT NULL,
    "mode" "BotMode" NOT NULL DEFAULT 'PAPER',
    "status" "BotStatus" NOT NULL DEFAULT 'IDLE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "riskConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pnl" DOUBLE PRECISION,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "dailyPnL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positions" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_results" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "config" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_logs" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_records" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "requestedAmount" DOUBLE PRECISION NOT NULL,
    "filledAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFillPrice" DOUBLE PRECISION,
    "exchangeOrderId" TEXT,
    "idempotencyKey" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" TEXT,
    "telegramBotToken" TEXT,
    "notifyOnTrade" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnStop" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnError" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDaily" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "api_keys_userId_exchange_isActive_idx" ON "api_keys"("userId", "exchange", "isActive");

-- CreateIndex
CREATE INDEX "trades_botId_timestamp_idx" ON "trades"("botId", "timestamp");

-- CreateIndex
CREATE INDEX "trades_botId_side_timestamp_idx" ON "trades"("botId", "side", "timestamp");

-- CreateIndex
CREATE INDEX "trades_symbol_timestamp_idx" ON "trades"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "portfolios_userId_updatedAt_idx" ON "portfolios"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "alerts_userId_isRead_idx" ON "alerts"("userId", "isRead");

-- CreateIndex
CREATE INDEX "alerts_userId_createdAt_idx" ON "alerts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "market_data_symbol_timeframe_idx" ON "market_data"("symbol", "timeframe");

-- CreateIndex
CREATE INDEX "market_data_symbol_timeframe_createdAt_idx" ON "market_data"("symbol", "timeframe", "createdAt");

-- CreateIndex
CREATE INDEX "backtest_results_userId_createdAt_idx" ON "backtest_results"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bot_logs_botId_createdAt_idx" ON "bot_logs"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "order_records_botId_createdAt_idx" ON "order_records"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "order_records_idempotencyKey_idx" ON "order_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "order_records_exchangeOrderId_idx" ON "order_records"("exchangeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_logs" ADD CONSTRAINT "bot_logs_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_records" ADD CONSTRAINT "order_records_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
