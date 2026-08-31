'use client';

import { useCallback, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import {
  UploadCloud,
  FileText,
  FileType,
  File as FileIcon,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';

type Role = { name: string; hierarchyRank: number };

// Mirrors lib/documents/textExtraction.ts's SUPPORTED_MIME_TYPES — kept as
// a separate client-side constant rather than importing that module
// directly, since it (transitively, via mammoth/officeparser/pdf-parse)
// pulls in server-only Node dependencies that have no business in the
// browser bundle. Same duplication the file input's own `accept` attribute
// already had; if a format is ever added there, it needs updating here too.
const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
]);
const ACCEPTED_EXTENSIONS = '.pdf,.docx,.pptx,.txt,.md';

type UploadResult = { id: string; status: string } | { error: string };

/**
 * Shared by both single and bulk mode: does the actual upload of one file
 * with its metadata, branching on storage backend exactly like the old
 * single-purpose uploadViaBlob did. Vercel's serverless functions reject
 * request bodies above ~4.5MB (confirmed directly: real corpus documents
 * 8-25MB all 413'd through a body-carrying POST) — client-direct-to-Blob
 * upload is the fix, not a workaround, and is the only path used whenever
 * useClientUpload is set (STORAGE_PROVIDER=vercel-blob). On local disk
 * storage there's no equivalent direct-upload target, so the plain
 * single-request route remains the only path there, which is fine: that
 * path only hits Vercel's ceiling on Vercel, and local-disk deployments
 * generally aren't on Vercel in the first place.
 */
async function submitFile(
  file: File,
  meta: { name: string; description?: string; clearanceLevel: number; department?: string; tags?: string[] },
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
        department: meta.department,
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
  if (meta.department) formData.set('department', meta.department);
  if (meta.tags?.length) formData.set('tags', meta.tags.join(','));
  const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
  const data = await res.json();
  return res.ok ? data : { error: data.error ?? 'Upload failed.' };
}

/** Polls a document's processing status until it settles, for status UI. */
async function pollUntilSettled(
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

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIconFor(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return <FileText size={18} className="text-red-500" />;
  if (ext === '.pptx') return <FileType size={18} className="text-orange-500" />;
  if (ext === '.docx') return <FileType size={18} className="text-blue-500" />;
  return <FileIcon size={18} className="text-zinc-400" />;
}

function validateFile(file: File, uploadMaxMb: number): string | null {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return `Unsupported file type${file.type ? ` (${file.type})` : ''}. Use PDF, DOCX, PPTX, TXT, or MD.`;
  }
  const maxBytes = uploadMaxMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File exceeds the ${uploadMaxMb}MB limit (${formatBytes(file.size)}).`;
  }
  return null;
}

export function UploadForm({
  roles,
  useClientUpload,
  uploadMaxMb,
  onUploadingChange,
}: {
  roles: Role[];
  useClientUpload: boolean;
  uploadMaxMb: number;
  // Fires true when a send starts and false once it's fully settled
  // (single: READY/FAILED; bulk: every file settled) — lets a parent page
  // that also shows a persistent, DB-backed document list (the knowledge
  // base) refresh that list live while an upload is in flight, instead of
  // only reflecting new documents on the next full page load.
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(newFiles: FileList | File[]) {
    setFiles((prev) => {
      // De-duped by name+size — dragging the same file twice (or selecting
      // an overlapping set via a second drop) shouldn't silently double it
      // up in the list.
      const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const additions = Array.from(newFiles).filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
      return [...prev, ...additions];
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  function resetAll() {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const dropZone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        dragActive
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
          : 'border-zinc-300 dark:border-zinc-700 hover:border-brand-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
      }`}
    >
      <UploadCloud size={28} className={dragActive ? 'text-brand-600' : 'text-zinc-400'} />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        Drag and drop files, or click to browse
      </p>
      <p className="text-xs text-zinc-400">
        PDF, DOCX, PPTX, TXT, or MD · up to {uploadMaxMb}MB each · select multiple to bulk-upload
      </p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
        }}
        className="hidden"
      />
    </div>
  );

  if (files.length === 0) {
    return <div className="flex flex-col gap-4">{dropZone}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {dropZone}
      {files.length === 1 ? (
        <SingleUpload
          file={files[0]}
          roles={roles}
          useClientUpload={useClientUpload}
          uploadMaxMb={uploadMaxMb}
          onRemove={resetAll}
          onAddMore={() => fileInputRef.current?.click()}
          onUploadingChange={onUploadingChange}
        />
      ) : (
        <BulkUpload
          files={files}
          roles={roles}
          useClientUpload={useClientUpload}
          uploadMaxMb={uploadMaxMb}
          onRemoveFile={(f) => setFiles((prev) => prev.filter((x) => x !== f))}
          onReset={resetAll}
          onUploadingChange={onUploadingChange}
        />
      )}
    </div>
  );
}

type Status = 'idle' | 'invalid' | 'uploading' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

function SingleUpload({
  file,
  roles,
  useClientUpload,
  uploadMaxMb,
  onRemove,
  onAddMore,
  onUploadingChange,
}: {
  file: File;
  roles: Role[];
  useClientUpload: boolean;
  uploadMaxMb: number;
  onRemove: () => void;
  onAddMore: () => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const validationError = validateFile(file, uploadMaxMb);
  const [name, setName] = useState(stripExtension(file.name));
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState('');
  const [tags, setTags] = useState('');
  const [clearanceLevel, setClearanceLevel] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(validationError);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validationError || !clearanceLevel) return;
    setError(null);
    setStatus('uploading');
    onUploadingChange?.(true);

    const result = await submitFile(
      file,
      {
        name: name.trim() || stripExtension(file.name),
        description: description.trim() || undefined,
        clearanceLevel: Number(clearanceLevel),
        department: department.trim() || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      },
      useClientUpload,
    );

    if ('error' in result) {
      setError(result.error);
      setStatus('idle');
      onUploadingChange?.(false);
      return;
    }

    setStatus(result.status as Status);
    await pollUntilSettled(result.id, (s, procError) => {
      setStatus(s as Status);
      if (s === 'FAILED' && procError) setError(procError);
    });
    onUploadingChange?.(false);
  }

  const busy = status !== 'idle' && status !== 'FAILED';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center gap-3">
        {fileIconFor(file.name)}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{file.name}</p>
          <p className="text-xs text-zinc-400">{formatBytes(file.size)}</p>
        </div>
        {status === 'idle' && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove file"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-500"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {validationError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{validationError}</p>
      ) : (
        <>
          <Field label="Document name" required>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
              className={inputClass}
            />
          </Field>

          <Field label="Description">
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={2}
              className={inputClass}
            />
          </Field>

          <Field label="Clearance level" required>
            <select
              name="clearanceLevel"
              value={clearanceLevel}
              onChange={(e) => setClearanceLevel(e.target.value)}
              disabled={busy}
              required
              className={inputClass}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Department (optional)">
              <input name="department" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={busy} className={inputClass} />
            </Field>
            <Field label="Tags (comma-separated)">
              <input name="tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} className={inputClass} />
            </Field>
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !!validationError}
          className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
        >
          Upload
        </button>
        {status === 'idle' && !validationError && (
          <button type="button" onClick={onAddMore} className="text-sm font-medium text-brand-600 hover:underline">
            + Add another file (bulk upload)
          </button>
        )}
        {status !== 'idle' && <StatusPill status={status} />}
      </div>
    </form>
  );
}

function BulkUpload({
  files,
  roles,
  useClientUpload,
  uploadMaxMb,
  onRemoveFile,
  onReset,
  onUploadingChange,
}: {
  files: File[];
  roles: Role[];
  useClientUpload: boolean;
  uploadMaxMb: number;
  onRemoveFile: (file: File) => void;
  onReset: () => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [clearanceLevel, setClearanceLevel] = useState('');
  const [department, setDepartment] = useState('');
  // Only ever holds an entry for a file that has actually started
  // uploading (set explicitly inside handleUploadAll below) — never
  // synced from the `files` prop via an effect. Validation status for a
  // file that HASN'T started is instead derived fresh on every render by
  // statusFor(), a pure function of the file itself: React's own guidance
  // is to compute derived state during render rather than push a prop
  // change into a separate piece of state via useEffect, and here it also
  // sidesteps ever needing to reconcile "did this file's validity change"
  // against "is this file mid-upload" by hand.
  const [progress, setProgress] = useState<Record<string, { status: Status; error?: string }>>({});
  const [running, setRunning] = useState(false);
  const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

  function statusFor(file: File): { status: Status; error?: string } {
    const key = keyOf(file);
    if (progress[key]) return progress[key];
    const validationError = validateFile(file, uploadMaxMb);
    return validationError ? { status: 'invalid', error: validationError } : { status: 'idle' };
  }

  const validFiles = files.filter((f) => statusFor(f).status !== 'invalid');
  const readyCount = files.filter((f) => statusFor(f).status === 'READY').length;
  const failedCount = files.filter((f) => statusFor(f).status === 'FAILED').length;
  const allSettled =
    files.length > 0 && files.every((f) => ['READY', 'FAILED', 'invalid'].includes(statusFor(f).status));

  const updateEntry = useCallback((key: string, patch: { status: Status; error?: string }) => {
    setProgress((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  async function handleUploadAll() {
    if (!clearanceLevel || validFiles.length === 0) return;
    setRunning(true);
    onUploadingChange?.(true);

    // Sequential, not parallel — this app measured real problems (RAM
    // exhaustion, embedding-API rate limits) from processing multiple
    // documents concurrently earlier on. One file fully reaches
    // READY/FAILED before the next one starts uploading.
    for (const file of validFiles) {
      const key = keyOf(file);
      updateEntry(key, { status: 'uploading' });
      const result = await submitFile(
        file,
        {
          name: stripExtension(file.name),
          clearanceLevel: Number(clearanceLevel),
          department: department.trim() || undefined,
        },
        useClientUpload,
      );
      if ('error' in result) {
        updateEntry(key, { status: 'FAILED', error: result.error });
        continue;
      }
      updateEntry(key, { status: result.status as Status });
      await pollUntilSettled(result.id, (s, procError) => {
        updateEntry(key, { status: s as Status, error: procError });
      });
    }

    setRunning(false);
    onUploadingChange?.(false);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-900 dark:text-white">
          {files.length} files selected
          {validFiles.length !== files.length && (
            <span className="ml-1.5 font-normal text-red-500">({files.length - validFiles.length} invalid)</span>
          )}
        </p>
        {!running && (
          <button type="button" onClick={onReset} className="text-xs font-medium text-zinc-500 hover:text-red-500">
            Clear all
          </button>
        )}
      </div>

      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {files.map((file) => {
          const entry = statusFor(file);
          return (
            <li
              key={keyOf(file)}
              className="flex items-center gap-3 rounded-lg border border-zinc-100 dark:border-zinc-800 px-3 py-2"
            >
              {fileIconFor(file.name)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">{file.name}</p>
                {entry.error && (entry.status === 'invalid' || entry.status === 'FAILED') && (
                  <p className="truncate text-xs text-red-500">{entry.error}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-zinc-400">{formatBytes(file.size)}</span>
              {entry.status !== 'idle' && entry.status !== 'invalid' ? (
                <BulkStatusIcon status={entry.status} />
              ) : (
                !running && (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(file)}
                    aria-label={`Remove ${file.name}`}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>

      {!allSettled && (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            One clearance level applies to every file in this batch. Files are named after their
            filename — rename them individually afterward from the admin Documents table if needed.
          </p>
          <Field label="Clearance level for all files" required>
            <select
              name="clearanceLevel"
              value={clearanceLevel}
              onChange={(e) => setClearanceLevel(e.target.value)}
              disabled={running}
              required
              className={inputClass}
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
          <Field label="Department (optional, applies to all)">
            <input name="department" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={running} className={inputClass} />
          </Field>

          <button
            type="button"
            onClick={handleUploadAll}
            disabled={running || !clearanceLevel || validFiles.length === 0}
            className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
          >
            {running ? 'Uploading…' : `Upload ${validFiles.length} file${validFiles.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {allSettled && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Done — <span className="font-medium text-emerald-600 dark:text-emerald-400">{readyCount} ready</span>
          {failedCount > 0 && (
            <>
              , <span className="font-medium text-red-500">{failedCount} failed</span>
            </>
          )}
          . <button type="button" onClick={onReset} className="font-medium text-brand-600 hover:underline">Upload more</button>
        </p>
      )}
    </div>
  );
}

function BulkStatusIcon({ status }: { status: Status }) {
  if (status === 'READY') return <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />;
  if (status === 'FAILED') return <XCircle size={16} className="shrink-0 text-red-500" />;
  return <Loader2 size={16} className="shrink-0 animate-spin text-amber-500" />;
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

const inputClass =
  'rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60';

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
