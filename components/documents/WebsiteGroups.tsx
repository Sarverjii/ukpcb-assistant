'use client';

import { Globe, ExternalLink, ChevronDown } from 'lucide-react';
import type { DocumentRow } from '@/components/documents/DocumentsTable';

/**
 * Groups every website-sourced document by its source domain — "click the
 * domain name to see all the pages saved under it" (an explicit request).
 * Collapsed `<details>` per domain, same pattern UkpcbDirectory already
 * uses for its department groups, rather than a new disclosure widget.
 *
 * Lives entirely on its own tab now (KnowledgeBase.tsx's "Websites" tab) —
 * the caller already filters `documents` down to website-sourced rows
 * only, so every row here is guaranteed to have a `sourceUrl`. Read-only
 * by design: a website page is always public to everyone (see
 * UrlUploadForm's own comment for how that's enforced), so unlike
 * DocumentsTable there is deliberately no clearance/department control
 * anywhere in this component — nothing here is meant to ever become
 * editable.
 */
export function WebsiteGroups({ documents }: { documents: DocumentRow[] }) {
  const byDomain = new Map<string, (DocumentRow & { sourceUrl: string })[]>();
  for (const doc of documents) {
    if (!doc.sourceUrl) continue;
    let domain: string;
    try {
      domain = new URL(doc.sourceUrl).hostname;
    } catch {
      domain = doc.sourceUrl;
    }
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(doc as DocumentRow & { sourceUrl: string });
  }
  const domains = [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (domains.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {domains.map(([domain, docs]) => {
        const readyCount = docs.filter((d) => d.status === 'READY').length;
        return (
          <details
            key={domain}
            className="group rounded-xl border border-zinc-200 dark:border-zinc-800 open:pb-3 open:shadow-sm"
          >
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
                  </span>
                </span>
              </span>
              <ChevronDown size={16} className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
            </summary>
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
      })}
    </div>
  );
}
