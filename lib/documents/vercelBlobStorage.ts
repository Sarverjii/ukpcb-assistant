import { put, get } from '@vercel/blob';
import { randomUUID } from 'crypto';
import path from 'path';
import type { StorageProvider } from '@/lib/documents/storage';

/**
 * Storage provider #2 of 2 (with LocalDiskStorageProvider). Exists because
 * local disk doesn't work on Vercel: serverless functions don't share a
 * persistent filesystem across invocations, so a document uploaded in one
 * request may not even be readable by a "download" request seconds later on
 * a different instance — not just "lost on redeploy," genuinely unreliable
 * within a single session. See README's deployment section.
 *
 * access: 'private' throughout — this preserves the same security property
 * LocalDiskStorageProvider documents: a blob's URL alone isn't enough to
 * fetch it, the app's own BLOB_READ_WRITE_TOKEN is required, so "downloading
 * a document" still has to go through this app's authorized route handler
 * rather than a guessable/public URL. Never switch this to 'public' — that
 * would make every uploaded document fetchable by anyone with the URL,
 * clearance level irrelevant, regardless of what the rest of the app enforces.
 */
export class VercelBlobStorageProvider implements StorageProvider {
  async save(originalFileName: string, buffer: Buffer): Promise<string> {
    const ext = path.extname(originalFileName);
    // "documents/" prefix just keeps the store's namespace organized if it's
    // ever reused for something else later — has no behavioral effect here.
    const key = `documents/${randomUUID()}${ext}`;
    await put(key, buffer, { access: 'private' });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const result = await get(key, { access: 'private' });
    if (!result) {
      throw new Error(`Document not found in blob storage: ${key}`);
    }
    const arrayBuffer = await new Response(result.stream).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
