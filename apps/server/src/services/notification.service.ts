import { prisma } from '../db.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/index.js';

export interface TelegramMessage {
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown';
}

export class NotificationService {
  private telegramBaseUrl: string;

  constructor() {
    const token = env.TELEGRAM_BOT_TOKEN ?? '';
    this.telegramBaseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendTelegram(message: string, chatId?: string): Promise<boolean> {
    const targetChatId = chatId ?? env.TELEGRAM_CHAT_ID;

    if (!env.TELEGRAM_BOT_TOKEN || !targetChatId) {
      logger.debug('Telegram not configured, skipping notification');
      return false;
    }

    try {
      const response = await fetch(`${this.telegramBaseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Telegram API error', { status: response.status, body: errorBody });
        return false;
      }

      logger.debug('Telegram message sent', { chatId: targetChatId });
      return true;
    } catch (err) {
      logger.error('Failed to send Telegram message', { error: String(err) });
      return false;
    }
  }

  async sendAlert(
    userId: string,
    type: 'PRICE' | 'TRADE' | 'RISK' | 'ANOMALY' | 'SYSTEM',
    message: string,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
  ): Promise<void> {
    try {
      await prisma.alert.create({
        data: {
          userId,
          type,
          message,
          severity,
        },
      });

      logger.info('Alert created', { userId, type, severity });

      if (severity === 'HIGH' || severity === 'CRITICAL') {
        const severityEmoji = severity === 'CRITICAL' ? '[CRITICAL]' : '[HIGH]';
        const telegramMsg = `${severityEmoji} ${type}\n\n${message}`;
        await this.sendTelegram(telegramMsg);
      }
    } catch (err) {
      logger.error('Failed to create alert', { userId, type, error: String(err) });
    }
  }

  async sendTradeNotification(
    userId: string,
    symbol: string,
    side: string,
    price: number,
    amount: number,
    pnl?: number
  ): Promise<void> {
    const pnlStr = pnl !== undefined ? `\nPnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT` : '';
    const message = `Trade Executed\nSymbol: ${symbol}\nSide: ${side.toUpperCase()}\nPrice: ${price.toFixed(2)}\nAmount: ${amount.toFixed(6)}${pnlStr}`;

    await this.sendAlert(userId, 'TRADE', message, 'LOW');
    await this.sendTelegram(message);
  }

  async sendRiskAlert(
    userId: string,
    reason: string,
    dailyLoss: number,
    weeklyLoss: number
  ): Promise<void> {
    const message = `Risk Alert\n${reason}\nDaily Loss: ${dailyLoss.toFixed(2)}%\nWeekly Loss: ${weeklyLoss.toFixed(2)}%`;
    await this.sendAlert(userId, 'RISK', message, 'HIGH');
  }

  async getUnreadAlerts(userId: string, limit: number = 50) {
    return prisma.alert.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markAlertsAsRead(alertIds: string[]): Promise<void> {
    await prisma.alert.updateMany({
      where: { id: { in: alertIds } },
      data: { isRead: true },
    });
  }
}

export const notificationService = new NotificationService();
