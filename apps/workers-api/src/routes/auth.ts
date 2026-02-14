import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId, hashPassword, verifyPassword, createJWT, parseJsonBody } from '../utils';

type AuthEnv = { Bindings: Env; Variables: AppVariables };

export const authRoutes = new Hono<AuthEnv>();

authRoutes.post('/register', async (c) => {
  const { email, password, name } = await parseJsonBody(c.req.raw) as { email: string; password: string; name?: string };
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

  // 입력 검증
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return c.json({ error: 'Invalid email format' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  if (!/[A-Z]/.test(password)) return c.json({ error: '대문자를 1개 이상 포함해야 합니다' }, 400);
  if (!/[a-z]/.test(password)) return c.json({ error: '소문자를 1개 이상 포함해야 합니다' }, 400);
  if (!/[0-9]/.test(password)) return c.json({ error: '숫자를 1개 이상 포함해야 합니다' }, 400);
  if (name && name.length > 50) return c.json({ error: 'Name must be 50 characters or less' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const id = generateId();
  const passwordHash = await hashPassword(password);

  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .bind(id, email, passwordHash, name || null).run();

  await c.env.DB.prepare('INSERT INTO portfolios (id, user_id, total_value, daily_pnl) VALUES (?, ?, 10000, 0)')
    .bind(generateId(), id).run();

  const token = await createJWT({ userId: id, email }, c.env.JWT_SECRET);
  return c.json({ data: { token, user: { id, email, name } } });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await parseJsonBody(c.req.raw) as { email: string; password: string };
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);
  if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'Invalid input type' }, 400);

  const user = await c.env.DB.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').bind(email).first<{ id: string; email: string; name: string; password_hash: string }>();
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  // 레거시 SHA-256 해시 자동 마이그레이션 → PBKDF2
  if (!user.password_hash.startsWith('pbkdf2:')) {
    const newHash = await hashPassword(password);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();
  }

  const token = await createJWT({ userId: user.id, email: user.email }, c.env.JWT_SECRET);
  return c.json({ data: { token, user: { id: user.id, email: user.email, name: user.name } } });
});

authRoutes.get('/me', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(userId).first();
  if (!user) return c.json({ error: 'User not found' }, 404);

  return c.json({ data: user });
});
