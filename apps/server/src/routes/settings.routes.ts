import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';
import { notificationService } from '../services/notification.service.js';

const router = Router();
router.use(authMiddleware);

// ─── API Keys ───────────────────────────────────────────

const addKeySchema = z.object({
  exchange: z.enum(['BINANCE', 'UPBIT', 'BYBIT', 'BITHUMB']),
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(256),
});

// GET /api-keys - 사용자의 API 키 목록
router.get('/api-keys', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        exchange: true,
        label: true,
        apiKey: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = keys.map((k) => ({
      id: k.id,
      exchange: k.exchange,
      label: k.label,
      keyPreview: '••••••••',  // 암호화된 키 노출 방지
      isActive: k.isActive,
      createdAt: k.createdAt.toISOString().split('T')[0],
    }));

    res.json({ data: result });
  } catch (err) {
    logger.error('Failed to fetch API keys', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// POST /api-keys - API 키 추가
router.post('/api-keys', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validation = addKeySchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const userId = req.user!.userId;
    const { exchange, label, apiKey, secretKey } = validation.data;

    const encryptedKey = encrypt(apiKey);
    const encryptedSecret = encrypt(secretKey);

    const created = await prisma.apiKey.create({
      data: {
        userId,
        exchange,
        label,
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
      },
      select: { id: true, exchange: true, label: true, createdAt: true },
    });

    logger.info('API key added', { userId, exchange, label });
    res.status(201).json({ data: created });
  } catch (err) {
    logger.error('Failed to add API key', { error: String(err) });
    res.status(500).json({ error: 'Failed to add API key' });
  }
});

// DELETE /api-keys/:id - API 키 삭제
router.delete('/api-keys/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const keyId = req.params['id'];

    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await prisma.apiKey.delete({ where: { id: keyId } });

    logger.info('API key deleted', { userId, keyId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete API key', { error: String(err) });
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// ─── Profile ────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

// PUT /profile - 프로필 업데이트
router.put('/profile', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validation = profileSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const userId = req.user!.userId;
    const { name, email } = validation.data;

    if (email) {
      const existing = await prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
      });
      if (existing) {
        res.status(409).json({ error: '이미 사용 중인 이메일입니다' });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
      },
      select: { id: true, email: true, name: true },
    });

    res.json({ data: updated });
  } catch (err) {
    logger.error('Failed to update profile', { error: String(err) });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /password - 비밀번호 변경
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
    .max(128)
    .regex(/[A-Z]/, '대문자를 1개 이상 포함해야 합니다')
    .regex(/[a-z]/, '소문자를 1개 이상 포함해야 합니다')
    .regex(/[0-9]/, '숫자를 1개 이상 포함해야 합니다'),
});

router.put('/password', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validation = passwordSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const userId = req.user!.userId;
    const { currentPassword, newPassword } = validation.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다' });
      return;
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    logger.info('Password changed', { userId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to change password', { error: String(err) });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── Notifications ──────────────────────────────────────

const notificationsSchema = z.object({
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z.string().max(100).optional(),
  notifyTrades: z.boolean().optional(),
  notifyAlerts: z.boolean().optional(),
  notifyDailyReport: z.boolean().optional(),
  notifyRegimeChange: z.boolean().optional(),
});

// GET /notifications - 알림 설정 조회
router.get('/notifications', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      // 설정이 없으면 기본값 반환
      res.json({
        data: {
          telegramEnabled: false,
          telegramChatId: null,
          notifyOnTrade: true,
          notifyOnStop: true,
          notifyOnError: true,
          notifyOnDaily: false,
        },
      });
      return;
    }

    res.json({
      data: {
        telegramEnabled: settings.telegramEnabled,
        telegramChatId: settings.telegramChatId,
        notifyOnTrade: settings.notifyOnTrade,
        notifyOnStop: settings.notifyOnStop,
        notifyOnError: settings.notifyOnError,
        notifyOnDaily: settings.notifyOnDaily,
      },
    });
  } catch (err) {
    logger.error('Failed to fetch notification settings', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch notification settings' });
  }
});

// PUT /notifications - 알림 설정 저장
router.put('/notifications', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validation = notificationsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const userId = req.user!.userId;
    const data = validation.data;

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: {
        ...(data.telegramEnabled !== undefined ? { telegramEnabled: data.telegramEnabled } : {}),
        ...(data.telegramChatId !== undefined ? { telegramChatId: data.telegramChatId } : {}),
        ...(data.notifyTrades !== undefined ? { notifyOnTrade: data.notifyTrades } : {}),
        ...(data.notifyAlerts !== undefined ? { notifyOnStop: data.notifyAlerts } : {}),
        ...(data.notifyDailyReport !== undefined ? { notifyOnDaily: data.notifyDailyReport } : {}),
        ...(data.notifyRegimeChange !== undefined ? { notifyOnError: data.notifyRegimeChange } : {}),
      },
      create: {
        userId,
        telegramEnabled: data.telegramEnabled ?? false,
        telegramChatId: data.telegramChatId ?? null,
        notifyOnTrade: data.notifyTrades ?? true,
        notifyOnStop: data.notifyAlerts ?? true,
        notifyOnError: data.notifyRegimeChange ?? true,
        notifyOnDaily: data.notifyDailyReport ?? false,
      },
    });

    logger.info('Notification settings updated', { userId, settings: data });
    res.json({
      success: true,
      data: {
        telegramEnabled: settings.telegramEnabled,
        telegramChatId: settings.telegramChatId,
        notifyOnTrade: settings.notifyOnTrade,
        notifyOnStop: settings.notifyOnStop,
        notifyOnError: settings.notifyOnError,
        notifyOnDaily: settings.notifyOnDaily,
      },
    });
  } catch (err) {
    logger.error('Failed to update notifications', { error: String(err) });
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// ─── Alerts ─────────────────────────────────────────────

// GET /alerts - 읽지 않은 알림 목록 조회
router.get('/alerts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(Number(req.query['limit']) || 50, 100);

    const alerts = await notificationService.getUnreadAlerts(userId, limit);

    // 읽은 알림도 포함하여 최근 알림 조회 (전체 목록)
    const allAlerts = await prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        message: true,
        severity: true,
        isRead: true,
        createdAt: true,
      },
    });

    const unreadCount = alerts.length;

    res.json({
      data: allAlerts,
      unreadCount,
    });
  } catch (err) {
    logger.error('Failed to fetch alerts', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// POST /alerts/read - 알림 읽음 처리
router.post('/alerts/read', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { alertIds } = req.body as { alertIds?: string[] };

    if (alertIds && Array.isArray(alertIds) && alertIds.length > 0) {
      // 특정 알림만 읽음 처리 (소유권 확인)
      await prisma.alert.updateMany({
        where: { id: { in: alertIds }, userId },
        data: { isRead: true },
      });
    } else {
      // 전체 읽음 처리
      await prisma.alert.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to mark alerts as read', { error: String(err) });
    res.status(500).json({ error: 'Failed to mark alerts as read' });
  }
});

export default router;
