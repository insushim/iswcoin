import crypto from 'node:crypto';
import { env } from '../config/index.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'cryptosentinel-salt', KEY_LENGTH);
}

export function encrypt(text: string): string {
  const key = deriveKey(env.ENCRYPTION_KEY);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const ivHex = iv.toString('hex');
  return `${ivHex}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const key = deriveKey(env.ENCRYPTION_KEY);
  const parts = encryptedText.split(':');

  if (parts.length !== 2) {
    throw new Error('Invalid encrypted text format');
  }

  const [ivHex, encrypted] = parts as [string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}
