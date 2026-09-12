'use client';

import { useRef, useState } from 'react';
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
import {
  ACCEPTED_EXTENSIONS,
  formatBytes,
  pollUntilSettled,
  stripExtension,
  submitFile,
  validateFile,
  type OcrProgress,
} from '@/lib/documents/uploadClient';
import { useUploadQueue, type QueueItem } from '@/components/documents/UploadQueueContext';
import { DepartmentCheckboxList } from '@/components/shared/DepartmentCheckboxList';
import { ClearanceLevelPicker } from '@/components/shared/ClearanceLevelPicker';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

type Role = { name: string; hierarchyRank: number };

function fileIconFor(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return <FileText size={18} className="text-red-500" />;
  if (ext === '.pptx') return <FileType size={18} className="text-orange-500" />;
  if (ext === '.docx') return <FileType size={18} className="text-blue-500" />;
  return <FileIcon size={18} className="text-zinc-400" />;
}

export function UploadForm({
  roles,
  departments,
  useClientUpload,
  uploadMaxMb,
  onUploadingChange,
}: {
  roles: Role[];
  departments: PickableDepartment[];
  useClientUpload: boolean;
  uploadMaxMb: number;
  // Fires true when a *single*-file upload starts and false once it fully
  // settles (READY/FAILED) — bulk uploads don't go through this prop at
  // all; their progress lives in the shared upload queue (see
  // UploadQueueContext) instead, which a parent page can read directly via
  // useUploadQueue() since it needs to survive this component unmounting.
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const queue = useUploadQueue();
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
        PDF, Word, PowerPoint, Excel, CSV, TXT, MD, RTF, HTML, JSON, EPUB, or OpenDocument · up to{' '}
        {uploadMaxMb}MB each · select multiple to bulk-upload
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

  // A bulk batch is running or has just finished — show its progress
  // instead of the local file picker, regardless of whatever is (or
  // isn't) selected locally right now. This is the piece that survives
  // navigating away and back: the queue lives above this component (see
  // UploadQueueContext), so its state didn't reset just because this
  // component remounted.
  if (queue.items.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <BulkUploadProgress
          items={queue.items}
          isRunning={queue.isRunning}
          onUploadMore={() => {
            queue.clear();
            resetAll();
          }}
        />
      </div>
    );
  }

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
          departments={departments}
          useClientUpload={useClientUpload}
          uploadMaxMb={uploadMaxMb}
          onRemove={resetAll}
          onAddMore={() => fileInputRef.current?.click()}
          onUploadingChange={onUploadingChange}
        />
      ) : (
        <BulkUploadPicker
          files={files}
          roles={roles}
          departments={departments}
          uploadMaxMb={uploadMaxMb}
          onRemoveFile={(f) => setFiles((prev) => prev.filter((x) => x !== f))}
          onReset={resetAll}
          onStart={(clearanceLevel, departmentIds, validFiles) => {
            queue.start({ files: validFiles, clearanceLevel, departmentIds, useClientUpload });
            resetAll();
          }}
        />
      )}
    </div>
  );
}

type Status = 'idle' | 'invalid' | 'uploading' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

function SingleUpload({
  file,
  roles,
  departments,
  useClientUpload,
  uploadMaxMb,
  onRemove,
  onAddMore,
  onUploadingChange,
}: {
  file: File;
  roles: Role[];
  departments: PickableDepartment[];
  useClientUpload: boolean;
  uploadMaxMb: number;
  onRemove: () => void;
  onAddMore: () => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const validationError = validateFile(file, uploadMaxMb);
  const [name, setName] = useState(stripExtension(file.name));
  const [description, setDescription] = useState('');
  // Every department checked by default — the common case is a document
  // meant for everyone; an uploader narrows it down rather than having to
  // remember to opt every department in.
  const [departmentIds, setDepartmentIds] = useState<string[]>(() => departments.map((d) => d.id));
  const [tags, setTags] = useState('');
  const [clearanceLevel, setClearanceLevel] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(validationError);
  // Set only for a scanned PDF mid-OCR — see pollUntilSettled's own
  // comment. Null for every ordinary document, including for a moment
  // right after upload before the first status poll lands.
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);

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
        departmentIds,
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
    await pollUntilSettled(result.id, (s, procError, ocr) => {
      setStatus(s as Status);
      setOcrProgress(ocr ?? null);
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
            <ClearanceLevelPicker
              roles={roles}
              value={clearanceLevel}
              onChange={(rank) => setClearanceLevel(String(rank))}
              disabled={busy}
            />
          </Field>

          <Field label="Departments" required>
            <DepartmentCheckboxList
              departments={departments}
              selectedIds={departmentIds}
              onChange={setDepartmentIds}
              disabled={busy}
            />
          </Field>

          <Field label="Tags (comma-separated)">
            <input name="tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} className={inputClass} />
          </Field>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          // The ClearanceLevelPicker's pills aren't a native form control,
          // so there's no browser "please fill in this field" validation
          // to lean on the way the old <select required> got for free —
          // this disabled check is now the only thing stopping a submit
          // with no clearance level chosen. departmentIds defaults to
          // every department checked, so hitting zero here means an admin
          // actively unchecked all of them — still blocked, same as a
          // missing clearance level (every document needs at least one).
          disabled={busy || !!validationError || !clearanceLevel || departmentIds.length === 0}
          className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
        >
          Upload
        </button>
        {status === 'idle' && !validationError && (
          <button type="button" onClick={onAddMore} className="text-sm font-medium text-brand-600 hover:underline">
            + Add another file (bulk upload)
          </button>
        )}
        {status !== 'idle' && <StatusPill status={status} ocrProgress={ocrProgress} />}
      </div>
    </form>
  );
}

/**
 * The pre-flight picker: choose a clearance level (and optional
 * department) applied to every file in the batch, review/remove files,
 * then hand the whole batch off to the shared upload queue. Once `onStart`
 * fires, this component's local state is thrown away — from then on the
 * queue (not this component) owns tracking each file through to
 * READY/FAILED, so it keeps going even if this page unmounts.
 */
function BulkUploadPicker({
  files,
  roles,
  departments,
  uploadMaxMb,
  onRemoveFile,
  onReset,
  onStart,
}: {
  files: File[];
  roles: Role[];
  departments: PickableDepartment[];
  uploadMaxMb: number;
  onRemoveFile: (file: File) => void;
  onReset: () => void;
  onStart: (clearanceLevel: number, departmentIds: string[], validFiles: File[]) => void;
}) {
  const [clearanceLevel, setClearanceLevel] = useState('');
  // Every department checked by default — see SingleUpload's matching comment.
  const [departmentIds, setDepartmentIds] = useState<string[]>(() => departments.map((d) => d.id));
  const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

  function statusFor(file: File): { status: Status; error?: string } {
    const validationError = validateFile(file, uploadMaxMb);
    return validationError ? { status: 'invalid', error: validationError } : { status: 'idle' };
  }

  const validFiles = files.filter((f) => statusFor(f).status !== 'invalid');

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-900 dark:text-white">
          {files.length} files selected
          {validFiles.length !== files.length && (
            <span className="ml-1.5 font-normal text-red-500">({files.length - validFiles.length} invalid)</span>
          )}
        </p>
        <button type="button" onClick={onReset} className="text-xs font-medium text-zinc-500 hover:text-red-500">
          Clear all
        </button>
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
                {entry.error && <p className="truncate text-xs text-red-500">{entry.error}</p>}
              </div>
              <span className="shrink-0 text-xs text-zinc-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => onRemoveFile(file)}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        One clearance level applies to every file in this batch. Files are named after their
        filename — rename them individually afterward from the Knowledge Base table if needed.
      </p>
      <Field label="Clearance level for all files" required>
        <ClearanceLevelPicker roles={roles} value={clearanceLevel} onChange={(rank) => setClearanceLevel(String(rank))} />
      </Field>
      <Field label="Departments (applies to all files in this batch)" required>
        <DepartmentCheckboxList departments={departments} selectedIds={departmentIds} onChange={setDepartmentIds} />
      </Field>

      <button
        type="button"
        onClick={() => onStart(Number(clearanceLevel), departmentIds, validFiles)}
        disabled={!clearanceLevel || validFiles.length === 0 || departmentIds.length === 0}
        className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
      >
        Upload {validFiles.length} file{validFiles.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

/**
 * Renders the shared upload queue's live progress. Deliberately reads its
 * list straight from `queue.items` (passed down as `items`) rather than
 * keeping any copy of its own — there's exactly one source of truth for
 * "what's done and what's left," and it's the queue, precisely because
 * that's what needs to survive this component unmounting and remounting.
 */
function BulkUploadProgress({
  items,
  isRunning,
  onUploadMore,
}: {
  items: QueueItem[];
  isRunning: boolean;
  onUploadMore: () => void;
}) {
  const readyCount = items.filter((it) => it.status === 'READY').length;
  const failedCount = items.filter((it) => it.status === 'FAILED').length;
  const allSettled = !isRunning;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <p className="text-sm font-medium text-zinc-900 dark:text-white">
        {items.length} file{items.length === 1 ? '' : 's'} in this batch
      </p>

      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-3 rounded-lg border border-zinc-100 dark:border-zinc-800 px-3 py-2"
          >
            {fileIconFor(item.fileName)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">{item.fileName}</p>
              {item.error && item.status === 'FAILED' && <p className="truncate text-xs text-red-500">{item.error}</p>}
            </div>
            <span className="shrink-0 text-xs text-zinc-400">{formatBytes(item.fileSize)}</span>
            <BulkStatusIcon status={item.status} />
          </li>
        ))}
      </ul>

      {allSettled && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Done — <span className="font-medium text-emerald-600 dark:text-emerald-400">{readyCount} ready</span>
          {failedCount > 0 && (
            <>
              , <span className="font-medium text-red-500">{failedCount} failed</span>
            </>
          )}
          . <button type="button" onClick={onUploadMore} className="font-medium text-brand-600 hover:underline">Upload more</button>
        </p>
      )}
      {!allSettled && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This keeps going even if you leave this page — come back anytime to check progress.
        </p>
      )}
    </div>
  );
}

function BulkStatusIcon({ status }: { status: QueueItem['status'] }) {
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

function StatusPill({ status, ocrProgress }: { status: Status; ocrProgress?: OcrProgress | null }) {
  // A large document — scanned (multi-pass OCR) or not (multi-pass
  // embedding, see pipeline.ts's own comment on why that's now also
  // resumable across passes) — can take multiple processing passes, so
  // "Processing…" alone would look stuck for however long that takes; this
  // shows real page-by-page progress instead whenever it's available.
  // Deliberately generic ("page", not "scanned page") since ocrProgress now
  // covers ordinary text pages too, not just OCR'd ones.
  const label =
    status === 'PROCESSING' && ocrProgress
      ? `Processing — page ${Math.min(ocrProgress.done + 1, ocrProgress.total)} of ${ocrProgress.total}…`
      : (STATUS_LABELS[status] ?? status);
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}
    >
      {label}
    </span>
  );
}
