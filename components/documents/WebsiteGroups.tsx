'use client';

import { useState, useTransition } from 'react';
import { Globe, ExternalLink, ChevronDown, RotateCw, Pencil, Check, X } from 'lucide-react';
import { LocalTime } from '@/components/admin/LocalTime';

export type WebsiteDocumentRow = {
  id: string;
  name: string;
  sourceUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
};

export type CrawlSiteRow = {
  id: string;
  domain: string;
  depth: number;
  lastCrawledAt: string;
};

/**
 * Groups every website-sourced document by its source domain — "click the
 * domain name to see all the pages saved under it" (an explicit request),
 * now also the home of "Process again": every domain that was ever added
 * WITH crawling enabled (i.e. has a matching CrawlSiteRow) gets a button
 * that re-runs that exact crawl — see reprocessCrawlSiteAction /
 * reprocessPublicCrawlSiteAction — to pick up pages that are newly linked,
 * or that a prior run discovered but didn't reach before its page budget
 * ran out (see lib/documents/siteCrawl.ts's own comment for why that's
 * safe to just retry rather than needing its own persisted queue). A
 * domain with no CrawlSiteRow (every page under it was added one at a
 * time, crawl never checked) just doesn't get the button — there's no
 * "site" to re-crawl.
 *
 * Shared verbatim between the main Knowledge Base's Websites tab and
 * Admin -> Public Content's own Websites section — the two pools differ
 * in clearance/department/location, but this view only ever shows
 * name/status/source, which is identical shape either way. `documents`
 * and `crawlSites` are deliberately the only two props (plus the process-
 * again/depth-edit callbacks) so this component never needs to know which
 * pool it's rendering.
 */
export function WebsiteGroups({
  documents,
  crawlSites,
  onProcessAgain,
  onChangeDepth,
  maxDepth,
}: {
  documents: WebsiteDocumentRow[];
  crawlSites: CrawlSiteRow[];
  onProcessAgain: (crawlSiteId: string) => Promise<{ error?: string }>;
  onChangeDepth: (crawlSiteId: string, depth: number) => Promise<{ error?: string }>;
  maxDepth: number;
}) {
  const byDomain = new Map<string, WebsiteDocumentRow[]>();
  for (const doc of documents) {
    if (!doc.sourceUrl) continue;
    let domain: string;
    try {
      domain = new URL(doc.sourceUrl).hostname;
    } catch {
      domain = doc.sourceUrl;
    }
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(doc);
  }
  const crawlSiteByDomain = new Map(crawlSites.map((s) => [s.domain, s]));
  const domains = [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (domains.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {domains.map(([domain, docs]) => (
        <DomainGroup
          key={domain}
          domain={domain}
          docs={docs}
          crawlSite={crawlSiteByDomain.get(domain) ?? null}
          onProcessAgain={onProcessAgain}
          onChangeDepth={onChangeDepth}
          maxDepth={maxDepth}
        />
      ))}
    </div>
  );
}

function DomainGroup({
  domain,
  docs,
  crawlSite,
  onProcessAgain,
  onChangeDepth,
  maxDepth,
}: {
  domain: string;
  docs: WebsiteDocumentRow[];
  crawlSite: CrawlSiteRow | null;
  onProcessAgain: (crawlSiteId: string) => Promise<{ error?: string }>;
  onChangeDepth: (crawlSiteId: string, depth: number) => Promise<{ error?: string }>;
  maxDepth: number;
}) {
  const readyCount = docs.filter((d) => d.status === 'READY').length;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingDepth, setEditingDepth] = useState(false);
  const [depthValue, setDepthValue] = useState(String(crawlSite?.depth ?? 1));

  function handleProcessAgain(e: React.MouseEvent) {
    // Nested inside <summary> — without this, the click also toggles the
    // parent <details> open/closed, which reads as broken (the accordion
    // snapping shut right as the button is clicked).
    e.preventDefault();
    e.stopPropagation();
    if (!crawlSite || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await onProcessAgain(crawlSite.id);
      if (result.error) setError(result.error);
    });
  }

  function handleSaveDepth(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!crawlSite) return;
    const parsed = Number(depthValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxDepth) {
      setError(`Depth must be a whole number from 1 to ${maxDepth}.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onChangeDepth(crawlSite.id, parsed);
      if (result.error) setError(result.error);
      else setEditingDepth(false);
    });
  }

  return (
    <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800 open:pb-3 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
            <Globe size={15} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{domain}</span>
            <span className="text-xs font-normal text-zinc-400">
              {docs.length} page{docs.length === 1 ? '' : 's'}
              {readyCount < docs.length && ` · ${readyCount} ready`}
              {crawlSite && (
                <>
                  {' '}
                  · crawl depth {crawlSite.depth} · last crawled{' '}
                  <LocalTime iso={crawlSite.lastCrawledAt} />
                </>
              )}
            </span>
          </span>
        </span>

        {crawlSite && (
          <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.preventDefault()}>
            {editingDepth ? (
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  min={1}
                  max={maxDepth}
                  autoFocus
                  value={depthValue}
                  onChange={(e) => setDepthValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveDepth(e);
                    if (e.key === 'Escape') setEditingDepth(false);
                  }}
                  disabled={pending}
                  className="w-14 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleSaveDepth}
                  disabled={pending}
                  aria-label="Save depth"
                  className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-50"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingDepth(false);
                  }}
                  disabled={pending}
                  aria-label="Cancel"
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <X size={13} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDepthValue(String(crawlSite.depth));
                  setEditingDepth(true);
                }}
                title="Edit crawl depth"
                aria-label="Edit crawl depth"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={handleProcessAgain}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <RotateCw size={12} className={pending ? 'animate-spin' : ''} />
              {pending ? 'Crawling…' : 'Process again'}
            </button>
          </span>
        )}

        <ChevronDown size={16} className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
      </summary>

      {error && <p className="px-4 pt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-col gap-1 px-4 pt-1">
        {docs.map((doc) => (
          <a
            key={doc.id}
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <ExternalLink size={12} className="shrink-0 text-zinc-400" />
            <span className="truncate">{doc.name}</span>
            <span
              className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                doc.status === 'READY'
                  ? 'bg-emerald-100 text-emerald-700'
                  : doc.status === 'FAILED'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {doc.status}
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
