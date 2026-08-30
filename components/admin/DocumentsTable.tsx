'use client';

import { useRef, useState, useTransition } from 'react';
import {
  changeDocumentClearanceAction,
  deleteDocumentAction,
  replaceDocumentAction,
} from '@/app/(app)/admin/documents/actions';

type Document = {
  id: string;
  name: string;
  uploadedByName: string;
  clearanceLevel: number;
  department: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  updatedAt: string;
};
type Role = { hierarchyRank: number; name: string };

export function DocumentsTable({ documents, roles }: { documents: Document[]; roles: Role[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Document</th>
            <th className="px-3 py-2">Uploaded by</th>
            <th className="px-3 py-2">Clearance</th>
            <th className="px-3 py-2">Department</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Updated</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <DocumentRow key={d.id} doc={d} roles={roles} />
          ))}
          {documents.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-zinc-400">
                No documents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DocumentRow({ doc, roles }: { doc: Document; roles: Role[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClearanceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const level = Number(e.target.value);
    setError(null);
    startTransition(async () => {
      const result = await changeDocumentClearanceAction(doc.id, level);
      if (result.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteDocumentAction(doc.id);
      if (result.error) setError(result.error);
    });
  }

  function handleReplacePick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set('documentId', doc.id);
    formData.set('file', file);
    startTransition(async () => {
      const result = await replaceDocumentAction(formData);
      if (result.error) setError(result.error);
      e.target.value = '';
    });
  }

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800 align-top">
      <td className="px-3 py-2">{doc.name}</td>
      <td className="px-3 py-2">{doc.uploadedByName}</td>
      <td className="px-3 py-2">
        <select
          defaultValue={doc.clearanceLevel}
          disabled={pending}
          onChange={handleClearanceChange}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs disabled:opacity-50"
        >
          {roles.map((r) => (
            <option key={r.hierarchyRank} value={r.hierarchyRank}>
              {r.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">{doc.department ?? '—'}</td>
      <td className="px-3 py-2">
        <StatusPill status={doc.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
        {new Date(doc.updatedAt).toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          {/* Temporarily disabled: the local-disk storage provider doesn't
              reliably survive a server restart on hosts with tight memory
              limits (confirmed in production — a download 404'd after the
              server restarted under memory pressure). Chat/retrieval are
              unaffected either way, since chunk content and embeddings live
              in Postgres, not on disk. Re-enable once storage is backed by
              something that survives a restart (see StorageProvider in
              lib/documents/storage.ts). */}
          <button
            type="button"
            disabled
            title="Temporarily unavailable — the original file may not have survived a server restart. Chat answers from this document are unaffected."
            className="cursor-not-allowed rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs text-zinc-400 dark:text-zinc-600"
          >
            Download
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleReplacePick}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Replace
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
              confirmingDelete
                ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {confirmingDelete ? 'Confirm delete?' : 'Delete'}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-zinc-100 text-zinc-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}>
      {status}
    </span>
  );
}
