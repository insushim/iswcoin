import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { botRoutes } from './routes/bots';
import { tradeRoutes } from './routes/trades';
import { marketRoutes } from './routes/market';
import { portfolioRoutes } from './routes/portfolio';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), runtime: 'cloudflare-workers' }));

app.route('/api/auth', authRoutes);
app.route('/api/bots', botRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/market', marketRoutes);
app.route('/api/portfolio', portfolioRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
