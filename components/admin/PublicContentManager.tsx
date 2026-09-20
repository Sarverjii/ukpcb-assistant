'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, RotateCw, Globe, Upload } from 'lucide-react';
import {
  addPublicUrlAction,
  uploadPublicDocumentAction,
  retryPublicDocumentAction,
  deletePublicDocumentAction,
} from '@/app/(app)/admin/public-content/actions';
import { LocalTime } from '@/components/admin/LocalTime';
import { formatBytes, ACCEPTED_EXTENSIONS } from '@/lib/documents/uploadClient';

export type PublicDocumentRow = {
  id: string;
  name: string;
  sourceUrl: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  fileSizeBytes: number;
  createdAt: string;
  processingError: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-zinc-100 text-zinc-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

/**
 * Admin → Public Content's own management UI — the isPublic counterpart of
 * DocumentsTable.tsx/KnowledgeBase.tsx, deliberately much simpler: no
 * clearance/department/location controls anywhere, since none of them mean
 * anything for a document in this pool (see Document.isPublic's own
 * schema.prisma comment). Two add forms (URL, single file) and one flat
 * table, nothing else.
 */
export function PublicContentManager({ documents }: { documents: PublicDocumentRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processingIds = documents.filter((d) => d.status === 'PROCESSING').map((d) => d.id);
  const processingKey = processingIds.join(',');
  useEffect(() => {
    if (!processingKey) return;
    const ids = processingKey.split(',');
    const interval = setInterval(() => {
      for (const id of ids) fetch(`/api/documents/${id}/status`).catch(() => {});
      router.refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [processingKey, router]);

  function handleAddUrl(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setUrlError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('url', trimmed);
      const result = await addPublicUrlAction(formData);
      if (result.error) {
        setUrlError(result.error);
        return;
      }
      setUrl('');
      router.refresh();
    });
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setFileError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('file', file);
      if (docName.trim()) formData.set('name', docName.trim());
      const result = await uploadPublicDocumentAction(formData);
      if (result.error) {
        setFileError(result.error);
        return;
      }
      setFile(null);
      setDocName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      router.refresh();
    });
  }

  function handleRetry(id: string) {
    startTransition(async () => {
      await retryPublicDocumentAction(id);
      router.refresh();
    });
  }

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  function handleDelete(id: string) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      return;
    }
    startTransition(async () => {
      await deletePublicDocumentAction(id);
      setConfirmingDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form
          onSubmit={handleAddUrl}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Globe size={16} /> Add a public page by URL
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.gov.in/notice"
            disabled={pending}
            required
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
          />
          {urlError && <p className="text-sm text-red-600 dark:text-red-400">{urlError}</p>}
          <button
            type="submit"
            disabled={pending || !url.trim()}
            className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
          >
            Add page
          </button>
        </form>

        <form
          onSubmit={handleUpload}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Upload size={16} /> Upload a public document
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={pending}
            className="text-sm text-zinc-600 dark:text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-300 dark:file:border-zinc-700 file:bg-white dark:file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 dark:file:text-zinc-200 hover:file:bg-zinc-50 dark:hover:file:bg-zinc-700 file:cursor-pointer"
          />
          <input
            type="text"
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Document name (optional — defaults to the filename)"
            disabled={pending}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
          />
          {fileError && <p className="text-sm text-red-600 dark:text-red-400">{fileError}</p>}
          <button
            type="submit"
            disabled={pending || !file}
            className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
          >
            Upload
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Added</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                <td className="px-3 py-2">
                  {d.name}
                  {d.sourceUrl && (
                    <a
                      href={d.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={d.sourceUrl}
                      className="ml-1.5 inline-flex items-center align-middle text-zinc-400 hover:text-brand-600"
                    >
                      <Link2 size={12} />
                    </a>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-500">{formatBytes(d.fileSizeBytes)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.status] ?? ''}`}>
                    {d.status}
                  </span>
                  {d.status === 'FAILED' && d.processingError && (
                    <p className="mt-1 max-w-[16rem] text-xs text-zinc-400" title={d.processingError}>
                      {d.processingError}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  <LocalTime iso={d.createdAt} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {d.status === 'FAILED' && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleRetry(d.id)}
                        className="flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <RotateCw size={11} />
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleDelete(d.id)}
                      className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                        confirmingDeleteId === d.id
                          ? 'border-red-400 bg-red-50 text-red-700'
                          : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {confirmingDeleteId === d.id ? 'Confirm delete?' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-zinc-400">
                  No public content yet — add a page or document above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
