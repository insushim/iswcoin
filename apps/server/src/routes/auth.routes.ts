import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authMiddleware, type AuthenticatedRequest, generateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
    .max(128, '비밀번호는 128자를 초과할 수 없습니다')
    .regex(/[A-Z]/, '대문자를 1개 이상 포함해야 합니다')
    .regex(/[a-z]/, '소문자를 1개 이상 포함해야 합니다')
    .regex(/[0-9]/, '숫자를 1개 이상 포함해야 합니다'),
  name: z.string().min(1, 'Name is required').max(100),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { email, password, name } = validation.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    await prisma.portfolio.create({
      data: {
        userId: user.id,
        totalValue: 0,
        dailyPnL: 0,
        positions: [],
      },
    });

    const token = generateToken({ userId: user.id, email: user.email });

    logger.info('User registered', { userId: user.id, email: user.email });

    res.status(201).json({
      user,
      token,
    });
  } catch (err) {
    logger.error('Registration failed', { error: String(err) });
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const { email, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken({ userId: user.id, email: user.email });

    logger.info('User logged in', { userId: user.id });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    logger.error('Login failed', { error: String(err) });
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /me - 현재 로그인된 유저 정보
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    logger.error('Failed to get user profile', { error: String(err) });
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// POST /refresh - 토큰 갱신
router.post('/refresh', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const email = req.user?.email;
    if (!userId || !email) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const token = generateToken({ userId, email });
    res.json({ token });
  } catch (err) {
    logger.error('Token refresh failed', { error: String(err) });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

export default router;
