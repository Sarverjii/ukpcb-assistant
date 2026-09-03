import crypto from 'crypto';
import { config } from '@/lib/config';

// AES-256-GCM — authenticated encryption, so a tampered ciphertext fails
// to decrypt loudly instead of silently producing garbage that gets
// handed to a provider SDK as an API key. Every saved credential is
// encrypted with a fresh random IV (never reused), stored alongside the
// ciphertext and auth tag as `iv.tag.ciphertext`, each base64.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — the standard, recommended GCM IV size

function getKey(): Buffer {
  const raw = config.AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'AI_CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'and add it as an environment variable before saving an AI provider credential.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `AI_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}) — ` +
        'regenerate it with the command above rather than hand-editing.',
    );
  }
  return key;
}

/**
 * Encrypts a plaintext secret (an API key, pasted by an admin) for storage
 * in AIProviderCredential.encryptedApiKey. The only place in this codebase
 * that should ever call this is lib/db/queries/aiProviders.ts's save
 * function — nothing else should touch a raw secret on its way into the
 * database.
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join('.');
}

/**
 * Decrypts a stored secret — called ONLY from the provider factories
 * (lib/llm/index.ts, lib/embeddings/index.ts) at the moment a request
 * actually needs to construct a provider client. The decrypted value must
 * never be logged, never returned from a server action to a client
 * component, and never persisted anywhere else.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) {
    throw new Error('Stored credential is malformed (expected iv.tag.ciphertext) — it may predate this encryption scheme.');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
