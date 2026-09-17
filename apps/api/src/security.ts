import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

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

/** Encrypts one-time operational secrets at rest. The encryption key is derived
 * from the server-only HMAC secret and is never sent to clients. */
export function encryptSecret(value: string, secret: string): string {
  const key = createHash('sha256').update(`bj-encryption:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivValue, tagValue, ciphertextValue] = payload.split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Secreto cifrado inválido.');
  const key = createHash('sha256').update(`bj-encryption:${secret}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function stableVersion(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
