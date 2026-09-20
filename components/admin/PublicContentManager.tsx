'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw, Globe, Upload } from 'lucide-react';
import {
  addPublicUrlAction,
  uploadPublicDocumentAction,
  retryPublicDocumentAction,
  deletePublicDocumentAction,
  reprocessPublicCrawlSiteAction,
  updatePublicCrawlSiteDepthAction,
} from '@/app/(app)/admin/public-content/actions';
import { LocalTime } from '@/components/admin/LocalTime';
import { formatBytes, ACCEPTED_EXTENSIONS } from '@/lib/documents/uploadClient';
import { WebsiteGroups, type CrawlSiteRow } from '@/components/documents/WebsiteGroups';
import { SingleSelect } from '@/components/shared/SingleSelect';
import { MAX_CRAWL_DEPTH } from '@/lib/documents/crawlConstants';

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

const DEPTH_LABELS = ['pages linked directly from this one', 'and pages linked from those'];
function depthLabel(n: number): string {
  if (n <= DEPTH_LABELS.length) return DEPTH_LABELS[n - 1];
  return `${n - 1} hops further still`;
}

/**
 * Admin → Public Content's own management UI — the isPublic counterpart of
 * KnowledgeBase.tsx, split the same way into a grouped Websites view (any
 * page added by URL, crawled or not — see WebsiteGroups, shared verbatim
 * with the main Knowledge Base) and a flat table for uploaded files, since
 * none of clearance/department/location mean anything for a document in
 * this pool (see Document.isPublic's own schema.prisma comment).
 */
export function PublicContentManager({
  documents,
  crawlSites,
}: {
  documents: PublicDocumentRow[];
  crawlSites: CrawlSiteRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(false);
  const [crawlDepth, setCrawlDepth] = useState('1');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const websiteDocuments = documents.filter((d): d is PublicDocumentRow & { sourceUrl: string } => d.sourceUrl !== null);
  const uploadedDocuments = documents.filter((d) => d.sourceUrl === null);

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
    setDoneCount(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('url', trimmed);
      formData.set('crawl', crawl ? 'true' : 'false');
      formData.set('crawlDepth', crawlDepth);
      const result = await addPublicUrlAction(formData);
      if (result.error) {
        setUrlError(result.error);
        return;
      }
      setDoneCount(result.pagesAdded ?? 1);
      setUrl('');
      setCrawl(false);
      setCrawlDepth('1');
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
        <form onSubmit={handleAddUrl} className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={crawl}
              onChange={(e) => setCrawl(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-zinc-700 dark:text-zinc-300">
              Also crawl other pages linked from this one, on the same site — a page already added is
              never fetched twice. A big site won&apos;t all fit in one pass; add it once, then use{' '}
              <span className="font-medium">Process again</span> below to keep working through the rest.
            </span>
          </label>
          {crawl && (
            <label className="ml-6 flex items-center gap-2 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">Crawl depth</span>
              <SingleSelect
                value={crawlDepth}
                onChange={setCrawlDepth}
                options={Array.from({ length: MAX_CRAWL_DEPTH }, (_, i) => i + 1).map((n) => ({
                  value: String(n),
                  label: `${n} — ${depthLabel(n)}`,
                }))}
              />
            </label>
          )}
          {urlError && <p className="text-sm text-red-600 dark:text-red-400">{urlError}</p>}
          {doneCount !== null && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Added {doneCount} page{doneCount === 1 ? '' : 's'} — indexing now, they&apos;ll show up below shortly.
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !url.trim()}
            className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
          >
            {pending ? (crawl ? 'Crawling…' : 'Fetching…') : 'Add page'}
          </button>
        </form>

        <form onSubmit={handleUpload} className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
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

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">Websites</h2>
        {websiteDocuments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-sm text-zinc-400">
            No pages added by URL yet.
          </p>
        ) : (
          <WebsiteGroups
            documents={websiteDocuments}
            crawlSites={crawlSites}
            maxDepth={MAX_CRAWL_DEPTH}
            onProcessAgain={async (crawlSiteId) => {
              const result = await reprocessPublicCrawlSiteAction(crawlSiteId);
              router.refresh();
              return result;
            }}
            onChangeDepth={async (crawlSiteId, depth) => {
              const result = await updatePublicCrawlSiteDepthAction(crawlSiteId, depth);
              router.refresh();
              return result;
            }}
          />
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">Uploaded documents</h2>
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
              {uploadedDocuments.map((d) => (
                <tr key={d.id} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                  <td className="px-3 py-2">{d.name}</td>
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
              {uploadedDocuments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-zinc-400">
                    No uploaded documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
