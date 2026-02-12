import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'node:http';
import { env } from './config/index.js';
import { logger } from './utils/logger.js';
import { initializeWebSocket, getConnectedClientsCount } from './websocket/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { botRunnerService } from './services/bot-runner.service.js';

import authRoutes from './routes/auth.routes.js';
import botsRoutes from './routes/bots.routes.js';
import tradesRoutes from './routes/trades.routes.js';
import marketRoutes from './routes/market.routes.js';
import backtestRoutes from './routes/backtest.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import regimeRoutes from './routes/regime.routes.js';
import orderbookRoutes from './routes/orderbook.routes.js';
import onchainRoutes from './routes/onchain.routes.js';

const app = express();
const httpServer = createServer(app);

// 보안 헤더
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", env.CORS_ORIGIN],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// GZIP 압축
app.use(compression());

// CORS
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 레이트 리미팅 (메모리 누수 방지: 주기적 정리)
const rateLimit = (windowMs: number, max: number) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  // 만료된 엔트리 주기적 정리 (5분마다)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests) {
      if (now > record.resetTime) {
        requests.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = requests.get(ip);

    if (!record || now > record.resetTime) {
      requests.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= max) {
      res.set('Retry-After', String(Math.ceil((record.resetTime - now) / 1000)));
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
      return;
    }

    record.count++;
    next();
  };
};

// Auth 엔드포인트에 더 엄격한 레이트 리미팅
const authRateLimit = rateLimit(15 * 60 * 1000, 20); // 15분에 20회
app.use('/api/auth', authRateLimit);
app.use('/api/', rateLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX));

// 요청 본문 크기 제한 (보안)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  const start = Date.now();
  const originalEnd = _res.end;

  _res.end = function (this: typeof _res, ...args: Parameters<typeof originalEnd>) {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.originalUrl} ${_res.statusCode} ${duration}ms`);
    return originalEnd.apply(this, args);
  } as typeof originalEnd;

  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/regime', regimeRoutes);
app.use('/api/orderbook', orderbookRoutes);
app.use('/api/onchain', onchainRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

initializeWebSocket(httpServer);

startScheduler();

// 서버 재시작 시 RUNNING 상태로 남은 봇 복구
botRunnerService.recoverStuckBots();

const PORT = env.SERVER_PORT;

httpServer.listen(PORT, () => {
  logger.info(`CryptoSentinel Pro server started`, {
    port: PORT,
    environment: env.NODE_ENV,
    cors: env.CORS_ORIGIN,
  });
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API base URL: http://localhost:${PORT}/api`);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  httpServer.close(async () => {
    try {
      botRunnerService.stopAllBots();
      const { prisma } = await import('./db.js');
      await prisma.$disconnect();
      logger.info('Database disconnected');
    } catch {
      // 이미 종료 중이므로 무시
    }
    logger.info('Server closed');
    process.exit(0);
  });
  // 10초 후 강제 종료
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
