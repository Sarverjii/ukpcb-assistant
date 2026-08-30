import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '@/lib/config';
import { VercelBlobStorageProvider } from '@/lib/documents/vercelBlobStorage';

/**
 * Swap point #3 of 3 (with EmbeddingProvider and LLMProvider). Local disk is
 * fine for dev/MVP; swap STORAGE_PROVIDER to an S3-backed implementation
 * later without touching callers.
 */
export interface StorageProvider {
  /** Persists a buffer, returns an opaque key to pass to read() later. */
  save(originalFileName: string, buffer: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
}

export class LocalDiskStorageProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir = config.STORAGE_LOCAL_DIR) {
    // Resolved relative to process.cwd() (the project root), and
    // deliberately NOT under app/public — files here are never served by a
    // static route, so "downloading" a document requires going through an
    // authorized route handler (not built in this MVP pass) rather than a
    // guessable URL.
    // turbopackIgnore: baseDir is a runtime-only, env-derived path (never a
    // static import), so this isn't something Turbopack needs to trace —
    // without the hint it conservatively bundles the whole project.
    this.baseDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), baseDir);
  }

  async save(originalFileName: string, buffer: Buffer): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const ext = path.extname(originalFileName);
    const key = `${randomUUID()}${ext}`;
    await fs.writeFile(path.join(this.baseDir, key), buffer);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.baseDir, key));
  }
}

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  provider ??=
    config.STORAGE_PROVIDER === 'vercel-blob' ? new VercelBlobStorageProvider() : new LocalDiskStorageProvider();
  return provider;
}
