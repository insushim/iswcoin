import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  SERVER_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/cryptosentinel"),
  JWT_SECRET: isProd
    ? z.string().min(64, "Production JWT_SECRET must be at least 64 characters")
    : z
        .string()
        .default("dev-jwt-secret-do-not-use-in-prod-minimum-32-chars!!"),
  JWT_EXPIRES_IN: z.string().default("24h"),
  ENCRYPTION_KEY: isProd
    ? z.string().length(32)
    : z.string().min(32).default("01234567890123456789012345678901"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // 레이트 리미팅
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15분
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  UPBIT_API_KEY: z.string().optional(),
  UPBIT_API_SECRET: z.string().optional(),
  BYBIT_API_KEY: z.string().optional(),
  BYBIT_API_SECRET: z.string().optional(),
  PYTHON_ENGINE_URL: z.string().default("http://localhost:8000"),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Paper Trading
  PAPER_INITIAL_BALANCE: z.coerce.number().default(10000),
  PAPER_SLIPPAGE_ENABLED: z.enum(["true", "false"]).default("true"),
  PAPER_LOOP_INTERVAL_MS: z.coerce.number().default(120000), // 2분
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.format();
    const errorMessages = Object.entries(formatted)
      .filter(([key]) => key !== "_errors")
      .map(([key, value]) => {
        const errors = (value as { _errors?: string[] })._errors;
        return `  ${key}: ${errors?.join(", ") ?? "unknown error"}`;
      })
      .join("\n");

    console.error(`Environment validation errors:\n${errorMessages}`);
    console.warn("Using default values where possible...");

    const withDefaults = envSchema.parse(process.env);
    return withDefaults;
  }

  return parsed.data;
}

export const env = loadEnv();

// 개발 환경 기본값 사용 시 경고
if (!isProd) {
  if (!process.env["JWT_SECRET"]) {
    console.warn(
      "[SECURITY] JWT_SECRET이 설정되지 않아 개발용 기본값을 사용합니다. 프로덕션에서는 반드시 환경변수를 설정하세요.",
    );
  }
  if (!process.env["ENCRYPTION_KEY"]) {
    console.warn(
      "[SECURITY] ENCRYPTION_KEY가 설정되지 않아 개발용 기본값을 사용합니다. 프로덕션에서는 반드시 환경변수를 설정하세요.",
    );
  }
}
