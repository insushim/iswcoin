import crypto from 'node:crypto';
import { env } from '../config/index.js';

// AES-256-GCM (인증된 암호화) 사용
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 권장 IV 길이
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

// 키 캐싱 (매번 scrypt 연산 방지 - 성능 최적화)
let cachedKey: Buffer | null = null;

function deriveKey(secret: string): Buffer {
  if (cachedKey) return cachedKey;
  // 환경별 고유 salt 사용
  const salt = crypto.createHash('sha256').update(`${secret}-cryptosentinel`).digest().subarray(0, 16);
  cachedKey = crypto.scryptSync(secret, salt, KEY_LENGTH);
  return cachedKey;
}

export function encrypt(text: string): string {
  const key = deriveKey(env.ENCRYPTION_KEY);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const key = deriveKey(env.ENCRYPTION_KEY);
  const parts = encryptedText.split(':');

  // GCM 형식 (iv:authTag:encrypted) 또는 레거시 CBC 형식 (iv:encrypted) 지원
  if (parts.length === 3) {
    const [ivHex, authTagHex, encrypted] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // 레거시 CBC 형식 호환
  if (parts.length === 2) {
    const [ivHex, encrypted] = parts as [string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.concat([iv, Buffer.alloc(16 - iv.length)]));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error('Invalid encrypted text format');
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}
