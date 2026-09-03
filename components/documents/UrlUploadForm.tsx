'use client';

import { useState, useTransition } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { addDocumentFromUrlAction } from '@/app/(app)/knowledge-base/actions';

/**
 * "Add from a URL" — a deliberately separate, much simpler form from
 * UploadForm rather than a mode woven into it: no drag-and-drop, no
 * client/server-upload branching for large files, no bulk queue, and —
 * per explicit request — no clearance picker and no name field either.
 * URL-sourced content is always public to every department AND every
 * clearance level (see addDocumentFromUrlAction's own comment for
 * exactly how that's enforced), and its name always comes straight from
 * the page's own <title>, grouped under its domain in the Websites
 * section below rather than something the person adding it has to name
 * themselves. A URL and an optional crawl checkbox is genuinely the
 * whole form.
 */
export function UrlUploadForm() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(false);
  const [crawlDepth, setCrawlDepth] = useState('1');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  function reset() {
    setUrl('');
    setCrawl(false);
    setCrawlDepth('1');
    setError(null);
    setDoneCount(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setDoneCount(null);
    const formData = new FormData();
    formData.set('url', url.trim());
    formData.set('crawl', crawl ? 'true' : 'false');
    formData.set('crawlDepth', crawlDepth);
    startTransition(async () => {
      const result = await addDocumentFromUrlAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setDoneCount(result.pagesAdded ?? 1);
        setUrl('');
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (open) reset();
        }}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
      >
        <Link2 size={14} />
        {open ? '− Hide' : '+ Add from a URL'}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Fetches the page and indexes its text, exactly like an uploaded document — but always
            visible to every employee, at every clearance level, in every department. Named from the
            page&apos;s own title and grouped under its site in the Websites list below. Only public
            web pages (http/https) are supported, not internal/private addresses.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Page URL</span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/about"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={crawl}
              onChange={(e) => setCrawl(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-zinc-700 dark:text-zinc-300">
              Also fetch other pages linked from this one, on the same site (up to 3 total — a page
              already in the knowledge base is never fetched twice)
            </span>
          </label>
          {crawl && (
            <label className="ml-6 flex items-center gap-2 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">Crawl depth</span>
              <select
                value={crawlDepth}
                onChange={(e) => setCrawlDepth(e.target.value)}
                className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
              >
                <option value="1">1 — pages linked directly from this one</option>
                <option value="2">2 — and pages linked from those</option>
                <option value="3">3 — and one hop further still</option>
              </select>
            </label>
          )}
          <div>
            <button
              type="submit"
              disabled={pending || !url.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {pending ? (crawl ? 'Fetching pages…' : 'Fetching…') : 'Add document'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {doneCount !== null && (
            <p className="text-sm text-emerald-600">
              Added {doneCount} page{doneCount === 1 ? '' : 's'} — indexing now, they&apos;ll show up below shortly.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
