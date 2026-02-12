import { Hono } from 'hono';
import type { Env, AppVariables } from '../index';
import { generateId, hashPassword, verifyPassword, parseJsonBody, encryptApiKey } from '../utils';

type SettingsEnv = { Bindings: Env; Variables: AppVariables };

export const settingsRoutes = new Hono<SettingsEnv>();

// ==================== API Keys ====================

// GET /api-keys - List user's API keys (masked secret)
settingsRoutes.get('/api-keys', async (c) => {
  const userId = c.get('userId');

  const { results } = await c.env.DB.prepare(
    'SELECT id, exchange, api_key, label, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  const keys = (results || []).map((row) => {
    const r = row as Record<string, unknown>;
    const apiKey = r.api_key as string;
    return {
      id: r.id as string,
      exchange: r.exchange as string,
      label: r.label as string || '',
      keyPreview: apiKey.length > 8
        ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
        : '****',
      isActive: !!(r.is_active as number),
      createdAt: r.created_at as string,
    };
  });

  return c.json({ data: keys });
});

// POST /api-keys - Add new API key
settingsRoutes.post('/api-keys', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);

  const exchange = body.exchange as string;
  const apiKey = body.apiKey as string;
  const secretKey = body.secretKey as string;
  const passphrase = body.passphrase as string | undefined;
  const label = body.label as string | undefined;

  if (!exchange || !apiKey || !secretKey) {
    return c.json({ error: 'Exchange, API key, and secret key are required' }, 400);
  }

  const id = generateId();
  const encryptionSecret = c.env.ENCRYPTION_SECRET || 'default-encryption-key';
  const encryptedApiKey = await encryptApiKey(apiKey, encryptionSecret);
  const encryptedSecretKey = await encryptApiKey(secretKey, encryptionSecret);

  await c.env.DB.prepare(
    'INSERT INTO api_keys (id, user_id, exchange, api_key, secret_key, passphrase, label) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId, exchange, encryptedApiKey, encryptedSecretKey,
    passphrase || null, label || null
  ).run();

  return c.json({
    data: {
      id,
      exchange,
      label: label || '',
      keyPreview: apiKey.length > 8
        ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
        : '****',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  });
});

// DELETE /api-keys/:id - Remove API key
settingsRoutes.delete('/api-keys/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!existing) return c.json({ error: 'API key not found' }, 404);

  await c.env.DB.prepare(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();

  return c.json({ data: { success: true } });
});

// ==================== Notifications ====================

// GET /notifications - Get notification settings
settingsRoutes.get('/notifications', async (c) => {
  const userId = c.get('userId');

  const settings = await c.env.DB.prepare(
    'SELECT * FROM notification_settings WHERE user_id = ?'
  ).bind(userId).first();

  if (!settings) {
    // Return defaults
    return c.json({
      data: {
        telegramEnabled: false,
        telegramChatId: '',
        notifyTrades: true,
        notifyAlerts: true,
        notifyDailyReport: true,
        notifyRegimeChange: false,
      },
    });
  }

  const s = settings as Record<string, unknown>;
  return c.json({
    data: {
      telegramEnabled: !!(s.telegram_enabled as number),
      telegramChatId: (s.telegram_chat_id as string) || '',
      notifyTrades: !!(s.notify_trades as number),
      notifyAlerts: !!(s.notify_alerts as number),
      notifyDailyReport: !!(s.notify_daily_report as number),
      notifyRegimeChange: !!(s.notify_regime_change as number),
    },
  });
});

// PUT /notifications - Update notification settings
settingsRoutes.put('/notifications', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);

  const {
    telegramEnabled = false,
    telegramChatId = '',
    notifyTrades = true,
    notifyAlerts = true,
    notifyDailyReport = true,
    notifyRegimeChange = false,
  } = body;

  // Upsert notification settings
  const existing = await c.env.DB.prepare(
    'SELECT id FROM notification_settings WHERE user_id = ?'
  ).bind(userId).first();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE notification_settings SET telegram_enabled = ?, telegram_chat_id = ?, notify_trades = ?, notify_alerts = ?, notify_daily_report = ?, notify_regime_change = ?, updated_at = ? WHERE user_id = ?'
    ).bind(
      telegramEnabled ? 1 : 0,
      telegramChatId,
      notifyTrades ? 1 : 0,
      notifyAlerts ? 1 : 0,
      notifyDailyReport ? 1 : 0,
      notifyRegimeChange ? 1 : 0,
      new Date().toISOString(),
      userId
    ).run();
  } else {
    const id = generateId();
    await c.env.DB.prepare(
      'INSERT INTO notification_settings (id, user_id, telegram_enabled, telegram_chat_id, notify_trades, notify_alerts, notify_daily_report, notify_regime_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, userId,
      telegramEnabled ? 1 : 0,
      telegramChatId,
      notifyTrades ? 1 : 0,
      notifyAlerts ? 1 : 0,
      notifyDailyReport ? 1 : 0,
      notifyRegimeChange ? 1 : 0
    ).run();
  }

  return c.json({
    data: {
      telegramEnabled,
      telegramChatId,
      notifyTrades,
      notifyAlerts,
      notifyDailyReport,
      notifyRegimeChange,
    },
  });
});

// ==================== Profile ====================

// PUT /profile - Update user profile
settingsRoutes.put('/profile', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length > 50) return c.json({ error: 'Name must be 50 characters or less' }, 400);
    updates.push('name = ?');
    values.push(name);
  }
  if (body.email !== undefined) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(body.email))) return c.json({ error: 'Invalid email format' }, 400);
    // Check if email is already taken
    const existingEmail = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND id != ?'
    ).bind(body.email, userId).first();
    if (existingEmail) return c.json({ error: 'Email already in use' }, 409);
    updates.push('email = ?');
    values.push(body.email);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(userId);

  await c.env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, created_at FROM users WHERE id = ?'
  ).bind(userId).first();

  return c.json({ data: user });
});

// PUT /password - Change password
settingsRoutes.put('/password', async (c) => {
  const userId = c.get('userId');
  const body = await parseJsonBody(c.req.raw);

  const currentPassword = body.currentPassword as string;
  const newPassword = body.newPassword as string;
  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Current password and new password are required' }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  // Verify current password
  const user = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?'
  ).bind(userId).first<{ password_hash: string }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401);

  // Hash and update new password
  const newHash = await hashPassword(newPassword);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'
  ).bind(newHash, new Date().toISOString(), userId).run();

  return c.json({ data: { success: true, message: 'Password updated successfully' } });
});
