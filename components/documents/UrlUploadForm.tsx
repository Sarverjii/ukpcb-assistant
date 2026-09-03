'use client';

import { useRef, useState, useTransition } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { addDocumentFromUrlAction } from '@/app/(app)/knowledge-base/actions';

type Role = { name: string; hierarchyRank: number };

/**
 * "Add from a URL" — a deliberately separate, much simpler form from
 * UploadForm rather than a mode woven into it: no drag-and-drop, no
 * client/server-upload branching for large files, no bulk queue. Just a
 * URL, an optional name override, and a clearance level — no department
 * picker at all, since URL-sourced content is always visible to every
 * department (see addDocumentFromUrlAction's own comment for exactly how
 * that's enforced), which is the one thing that makes this genuinely
 * simpler than a file upload rather than just a smaller version of it.
 */
export function UrlUploadForm({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [clearanceLevel, setClearanceLevel] = useState('');
  const [crawl, setCrawl] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function reset() {
    setUrl('');
    setName('');
    setClearanceLevel('');
    setCrawl(false);
    setError(null);
    setDoneCount(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !clearanceLevel) return;
    setError(null);
    setDoneCount(null);
    const formData = new FormData();
    formData.set('url', url.trim());
    formData.set('name', name.trim());
    formData.set('clearanceLevel', clearanceLevel);
    formData.set('crawl', crawl ? 'true' : 'false');
    startTransition(async () => {
      const result = await addDocumentFromUrlAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setDoneCount(result.pagesAdded ?? 1);
        setUrl('');
        setName('');
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
        <form ref={formRef} onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Fetches the page and indexes its text, exactly like an uploaded document — but always
            visible to every department, regardless of clearance-level restrictions on it. Only
            public web pages (http/https) are supported, not internal/private addresses.
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
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Document name <span className="font-normal text-zinc-400">(optional — defaults to the page title)</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank to use the page's own title"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Clearance level</span>
            <select
              required
              value={clearanceLevel}
              onChange={(e) => setClearanceLevel(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose a clearance level…
              </option>
              {roles.map((r) => (
                <option key={r.hierarchyRank} value={r.hierarchyRank}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={crawl}
              onChange={(e) => setCrawl(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-zinc-700 dark:text-zinc-300">
              Also fetch other pages linked from this one, on the same site (up to 15 total)
            </span>
          </label>
          <div>
            <button
              type="submit"
              disabled={pending || !url.trim() || !clearanceLevel}
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
