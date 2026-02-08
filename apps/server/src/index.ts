import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'node:http';
import { env } from './config/index.js';
import { logger } from './utils/logger.js';
import { initializeWebSocket, getConnectedClientsCount } from './websocket/index.js';
import { startScheduler } from './jobs/scheduler.js';

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
app.use(helmet());

// GZIP 압축
app.use(compression());

// CORS
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 레이트 리미팅
const rateLimit = (windowMs: number, max: number) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = requests.get(ip);

    if (!record || now > record.resetTime) {
      requests.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= max) {
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
      return;
    }

    record.count++;
    next();
  };
};

app.use('/api/', rateLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    wsClients: getConnectedClientsCount(),
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

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
