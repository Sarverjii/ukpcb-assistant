'use client';

import { upload } from '@vercel/blob/client';

// Mirrors lib/documents/textExtraction.ts's SUPPORTED_MIME_TYPES — kept as
// a separate client-side constant rather than importing that module
// directly, since it (transitively, via mammoth/officeparser/pdf-parse)
// pulls in server-only Node dependencies that have no business in the
// browser bundle. Same duplication the file input's own `accept` attribute
// already had; if a format is ever added there, it needs updating here too.
export const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/rtf',
  'text/html',
  'text/csv',
  'application/json',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/epub+zip',
]);
// Legacy binary Excel (.xls) is deliberately NOT supported — the only
// pure-JS parser for it (SheetJS's `xlsx` package) has two unpatched high-
// severity CVEs (prototype pollution, ReDoS) in the last version actually
// published to npm; the fixed releases only exist on SheetJS's own CDN,
// outside the registry. Modern .xlsx has no such gap (handled by
// officeparser, already a dependency for other formats) — legacy .ppt has
// the same story as .xls: no dependable pure-JS parser, so also skipped.
export const ACCEPTED_EXTENSIONS =
  '.pdf,.docx,.pptx,.txt,.md,.xlsx,.doc,.rtf,.html,.htm,.csv,.json,.odt,.odp,.ods,.epub';

export type UploadResult = { id: string; status: string } | { error: string };

/**
 * Shared by both single and bulk upload (and the persistent upload queue
 * they both ultimately submit through): does the actual upload of one file
 * with its metadata, branching on storage backend. Vercel's serverless
 * functions reject request bodies above ~4.5MB (confirmed directly: real
 * corpus documents 8-25MB all 413'd through a body-carrying POST) —
 * client-direct-to-Blob upload is the fix, not a workaround, and is the
 * only path used whenever useClientUpload is set (STORAGE_PROVIDER=vercel-
 * blob). On local disk storage there's no equivalent direct-upload target,
 * so the plain single-request route remains the only path there, which is
 * fine: that path only hits Vercel's ceiling on Vercel, and local-disk
 * deployments generally aren't on Vercel in the first place.
 */
export async function submitFile(
  file: File,
  meta: {
    name: string;
    description?: string;
    clearanceLevel: number;
    departmentIds?: string[];
    tags?: string[];
  },
  useClientUpload: boolean,
): Promise<UploadResult> {
  if (useClientUpload) {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const pathname = `documents/${crypto.randomUUID()}${ext}`;
    let blob;
    try {
      blob = await upload(pathname, file, {
        access: 'private',
        handleUploadUrl: '/api/documents/blob-upload-token',
        clientPayload: JSON.stringify({ clearanceLevel: meta.clearanceLevel }),
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Upload failed.' };
    }
    const res = await fetch('/api/documents/finalize-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pathname: blob.pathname,
        mimeType: file.type,
        fileSizeBytes: file.size,
        name: meta.name,
        description: meta.description,
        clearanceLevel: meta.clearanceLevel,
        departmentIds: meta.departmentIds ?? [],
        tags: meta.tags ?? [],
      }),
    });
    const data = await res.json();
    return res.ok ? data : { error: data.error ?? 'Upload failed.' };
  }

  const formData = new FormData();
  formData.set('file', file);
  formData.set('name', meta.name);
  if (meta.description) formData.set('description', meta.description);
  formData.set('clearanceLevel', String(meta.clearanceLevel));
  for (const id of meta.departmentIds ?? []) formData.append('departmentIds', id);
  if (meta.tags?.length) formData.set('tags', meta.tags.join(','));
  const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
  const data = await res.json();
  return res.ok ? data : { error: data.error ?? 'Upload failed.' };
}

/** Polls a document's processing status until it settles, for status UI. */
export async function pollUntilSettled(
  documentId: string,
  onUpdate: (status: string, processingError?: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/documents/${documentId}/status`);
      const data = await res.json();
      onUpdate(data.status, data.processingError);
      if (data.status === 'READY' || data.status === 'FAILED') {
        clearInterval(interval);
        resolve();
      }
    }, 2000);
  });
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateFile(file: File, uploadMaxMb: number): string | null {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return `Unsupported file type${file.type ? ` (${file.type})` : ''}. Use PDF, Word, PowerPoint, Excel, CSV, TXT, MD, RTF, HTML, JSON, EPUB, or OpenDocument (.odt/.odp/.ods).`;
  }
  const maxBytes = uploadMaxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File exceeds the ${uploadMaxMb}MB limit (${formatBytes(file.size)}).`;
  }
  return null;
}
