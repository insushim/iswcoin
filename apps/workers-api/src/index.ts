import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { botRoutes } from './routes/bots';
import { tradeRoutes } from './routes/trades';
import { marketRoutes } from './routes/market';
import { portfolioRoutes } from './routes/portfolio';
import { backtestRoutes } from './routes/backtest';
import { regimeRoutes } from './routes/regime';
import { settingsRoutes } from './routes/settings';
import { verifyJWT } from './utils';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
};

export type AppVariables = {
  userId: string;
};

type AppEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<AppEnv>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));

// JWT auth middleware for all routes except /api/auth/* and /api/health
app.use('/api/*', async (c, next) => {
  const path = c.req.path;

  // Skip auth for health and auth endpoints
  if (path === '/api/health' || path.startsWith('/api/auth')) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload || !payload.userId) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
  }

  c.set('userId', payload.userId as string);
  return next();
});

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), runtime: 'cloudflare-workers' }));

app.route('/api/auth', authRoutes);
app.route('/api/bots', botRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/market', marketRoutes);
app.route('/api/portfolio', portfolioRoutes);
app.route('/api/backtest', backtestRoutes);
app.route('/api/regime', regimeRoutes);
app.route('/api/settings', settingsRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
