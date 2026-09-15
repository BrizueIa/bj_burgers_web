import { createHash, createHmac, randomBytes } from 'node:crypto';

export function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

export function digestCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeCode(code)).digest('hex');
}

export function digestToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function stableVersion(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
