import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/cryptosentinel'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('default-jwt-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32).default('01234567890123456789012345678901'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  UPBIT_API_KEY: z.string().optional(),
  UPBIT_API_SECRET: z.string().optional(),
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  PYTHON_ENGINE_URL: z.string().default('http://localhost:8000'),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.format();
    const errorMessages = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, value]) => {
        const errors = (value as { _errors?: string[] })._errors;
        return `  ${key}: ${errors?.join(', ') ?? 'unknown error'}`;
      })
      .join('\n');

    console.error(`Environment validation errors:\n${errorMessages}`);
    console.warn('Using default values where possible...');

    const withDefaults = envSchema.parse(process.env);
    return withDefaults;
  }

  return parsed.data;
}

export const env = loadEnv();
