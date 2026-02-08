import { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db.js';
import type { JWTPayload } from '../middleware/auth.js';

let io: Server | null = null;

export interface TickerUpdate {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  timestamp: number;
}

export interface BotStatusUpdate {
  botId: string;
  status: string;
  lastSignal: string | null;
  timestamp: number;
}

export interface TradeExecutedEvent {
  botId: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  pnl: number | null;
  timestamp: number;
}

export interface AlertEvent {
  id: string;
  type: string;
  message: string;
  severity: string;
  timestamp: number;
}

export function initializeWebSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined
      ?? socket.handshake.query['token'] as string | undefined;

    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

      if (!decoded.userId || !decoded.email) {
        next(new Error('Invalid token payload'));
        return;
      }

      (socket as Socket & { user: JWTPayload }).user = decoded;
      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        next(new Error('Token expired'));
        return;
      }
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { user: JWTPayload }).user;

    if (!user) {
      socket.disconnect();
      return;
    }

    logger.info('WebSocket client connected', {
      userId: user.userId,
      socketId: socket.id,
    });

    socket.join(`user:${user.userId}`);

    socket.on('subscribe:bot', async (botId: string) => {
      if (typeof botId !== 'string' || botId.length === 0) return;

      try {
        const bot = await prisma.bot.findUnique({
          where: { id: botId },
          select: { userId: true },
        });

        if (!bot || bot.userId !== user.userId) {
          socket.emit('error', { message: '봇에 대한 접근 권한이 없습니다' });
          logger.warn('Unauthorized bot subscription attempt', { userId: user.userId, botId });
          return;
        }

        socket.join(`bot:${botId}`);
        logger.debug('Client subscribed to bot', { userId: user.userId, botId });
      } catch (err) {
        logger.error('Bot subscription check failed', { botId, error: String(err) });
      }
    });

    socket.on('unsubscribe:bot', (botId: string) => {
      if (typeof botId === 'string' && botId.length > 0) {
        socket.leave(`bot:${botId}`);
        logger.debug('Client unsubscribed from bot', { userId: user.userId, botId });
      }
    });

    socket.on('subscribe:ticker', (symbol: string) => {
      if (typeof symbol === 'string' && symbol.length > 0) {
        socket.join(`ticker:${symbol}`);
        logger.debug('Client subscribed to ticker', { userId: user.userId, symbol });
      }
    });

    socket.on('unsubscribe:ticker', (symbol: string) => {
      if (typeof symbol === 'string' && symbol.length > 0) {
        socket.leave(`ticker:${symbol}`);
        logger.debug('Client unsubscribed from ticker', { userId: user.userId, symbol });
      }
    });

    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    socket.on('disconnect', (reason: string) => {
      logger.info('WebSocket client disconnected', {
        userId: user.userId,
        socketId: socket.id,
        reason,
      });
    });

    socket.on('error', (err: Error) => {
      logger.error('WebSocket error', {
        userId: user.userId,
        socketId: socket.id,
        error: err.message,
      });
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function emitTickerUpdate(symbol: string, data: TickerUpdate): void {
  if (io) {
    io.to(`ticker:${symbol}`).emit('ticker:update', data);
  }
}

export function emitBotStatus(botId: string, data: BotStatusUpdate): void {
  if (io) {
    io.to(`bot:${botId}`).emit('bot:status', data);
  }
}

export function emitTradeExecuted(botId: string, userId: string, data: TradeExecutedEvent): void {
  if (io) {
    io.to(`bot:${botId}`).emit('trade:executed', data);
    io.to(`user:${userId}`).emit('trade:executed', data);
  }
}

export function emitAlert(userId: string, data: AlertEvent): void {
  if (io) {
    io.to(`user:${userId}`).emit('alert', data);
  }
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

export function getIO(): Server | null {
  return io;
}

export function getConnectedClientsCount(): number {
  if (!io) return 0;
  return io.engine.clientsCount;
}
