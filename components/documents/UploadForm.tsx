'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { upload } from '@vercel/blob/client';

type Role = { name: string; hierarchyRank: number };
type Status = 'idle' | 'uploading' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

/**
 * uploadViaBlob bypasses this app's own server for the file bytes entirely
 * — the browser uploads straight to Vercel Blob (via
 * app/api/documents/blob-upload-token's short-lived token), then a small
 * JSON POST to /api/documents/finalize-upload creates the Document row.
 * Vercel's serverless functions reject request bodies above ~4.5MB, a hard
 * platform ceiling confirmed directly (real corpus documents 8-25MB all
 * 413'd through the old file-through-the-server route) — this is the fix,
 * not a workaround for something UPLOAD_MAX_MB or Next config could ever
 * have addressed on its own.
 *
 * Only used when useClientUpload is true (STORAGE_PROVIDER=vercel-blob —
 * see app/(app)/documents/upload/page.tsx). On local disk storage there's
 * no equivalent direct-upload target, so the plain single-request route
 * remains the only path there, which is fine: that path only hits Vercel's
 * ceiling on Vercel, and local-disk deployments generally aren't on Vercel
 * in the first place (see StorageProvider's own doc comment).
 */
async function uploadViaBlob(formData: FormData): Promise<{ id: string; status: string } | { error: string }> {
  const file = formData.get('file') as File;
  const clearanceLevel = formData.get('clearanceLevel') as string;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const pathname = `documents/${crypto.randomUUID()}${ext}`;

  let blob;
  try {
    blob = await upload(pathname, file, {
      access: 'private',
      handleUploadUrl: '/api/documents/blob-upload-token',
      clientPayload: JSON.stringify({ clearanceLevel }),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload failed.' };
  }

  const finalizeRes = await fetch('/api/documents/finalize-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pathname: blob.pathname,
      mimeType: file.type,
      fileSizeBytes: file.size,
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      clearanceLevel: Number(clearanceLevel),
      department: formData.get('department') || undefined,
      tags: String(formData.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }),
  });
  const data = await finalizeRes.json();
  if (!finalizeRes.ok) return { error: data.error ?? 'Upload failed.' };
  return data;
}

export function UploadForm({ roles, useClientUpload }: { roles: Role[]; useClientUpload: boolean }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus('uploading');

    const formData = new FormData(e.currentTarget);

    const data = useClientUpload
      ? await uploadViaBlob(formData)
      : await fetch('/api/documents/upload', { method: 'POST', body: formData }).then((r) => r.json());

    if ('error' in data) {
      setError(data.error ?? 'Upload failed.');
      setStatus('idle');
      return;
    }

    setStatus(data.status);
    formRef.current?.reset();

    pollRef.current = setInterval(async () => {
      const statusRes = await fetch(`/api/documents/${data.id}/status`);
      const statusData = await statusRes.json();
      setStatus(statusData.status);
      if (statusData.status === 'READY' || statusData.status === 'FAILED') {
        stopPolling();
        if (statusData.status === 'FAILED') setError(statusData.processingError ?? 'Processing failed.');
      }
    }, 2000);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="File" required>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.docx,.pptx,.txt,.md"
          className="text-sm text-zinc-600 dark:text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 dark:file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-800 dark:hover:file:bg-brand-500"
        />
      </Field>

      <Field label="Document name" required>
        <input
          type="text"
          name="name"
          required
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
      </Field>

      <Field label="Description">
        <textarea
          name="description"
          rows={2}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
      </Field>

      <Field label="Clearance level" required>
        <select
          name="clearanceLevel"
          required
          defaultValue=""
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="" disabled>
            Select a clearance level…
          </option>
          {roles.map((r) => (
            <option key={r.hierarchyRank} value={r.hierarchyRank}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Department (optional)">
          <input
            type="text"
            name="department"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Field>
        <Field label="Tags (comma-separated)">
          <input
            type="text"
            name="tags"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Field>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={status === 'uploading' || status === 'PENDING' || status === 'PROCESSING'}
        className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
      >
        Upload
      </button>

      {status !== 'idle' && <StatusPill status={status} />}
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

const STATUS_STYLES: Record<string, string> = {
  uploading: 'bg-zinc-100 text-zinc-600',
  PENDING: 'bg-zinc-100 text-zinc-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  uploading: 'Uploading…',
  PENDING: 'Queued for processing…',
  PROCESSING: 'Processing…',
  READY: 'Ready — indexed and available in chat',
  FAILED: 'Processing failed',
};

function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
