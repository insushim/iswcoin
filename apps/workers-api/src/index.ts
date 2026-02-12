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
import { runPaperTrading } from './engine';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  ENGINE_SECRET?: string;
  ENCRYPTION_SECRET?: string;
};

export type AppVariables = {
  userId: string;
};

type AppEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<AppEnv>();

// 인메모리 레이트 리미터 (IP 기반, 인증 엔드포인트용)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// CORS: 허용 오리진 제한
app.use('*', cors({
  origin: (origin) => {
    const allowed = ['https://cryptosentinel.pages.dev', 'http://localhost:3000', 'http://localhost:3001'];
    return allowed.includes(origin) ? origin : 'https://cryptosentinel.pages.dev';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Engine-Secret'],
  maxAge: 86400,
}));

// 보안 헤더
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// 인증 엔드포인트 레이트 리미팅 (IP당 1분 10회)
app.use('/api/auth/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  if (!checkRateLimit(ip, 10, 60000)) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  return next();
});

// JWT auth middleware for all routes except /api/auth/* and /api/health
app.use('/api/*', async (c, next) => {
  const path = c.req.path;

  // Skip auth for health and auth endpoints
  if (path === '/api/health' || path.startsWith('/api/auth') || path === '/api/engine/run') {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload || !payload.userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', payload.userId as string);
  return next();
});

app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-cache');
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), runtime: 'cloudflare-workers' });
});

// Manual trigger for paper trading engine (보호됨)
app.post('/api/engine/run', async (c) => {
  const secret = c.req.header('X-Engine-Secret');
  const authHeader = c.req.header('Authorization');
  const engineSecret = c.env.ENGINE_SECRET;

  let authorized = false;

  // 1) ENGINE_SECRET 헤더 확인
  if (engineSecret && secret === engineSecret) {
    authorized = true;
  }

  // 2) JWT 토큰 확인
  if (!authorized && authHeader?.startsWith('Bearer ')) {
    const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET);
    if (payload?.userId) authorized = true;
  }

  if (!authorized) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const logs = await runPaperTrading(c.env);
    return c.json({ data: { success: true, message: '모의투자 엔진 실행 완료', timestamp: new Date().toISOString(), logs } });
  } catch (err) {
    console.error('Engine error:', err);
    return c.json({ error: '엔진 실행 중 오류 발생' }, 500);
  }
});

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

// Export with scheduled handler for cron-based paper trading
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runPaperTrading(env));
  },
};
