'use client';

import { Globe, ExternalLink } from 'lucide-react';
import type { DocumentRow } from '@/components/documents/DocumentsTable';

/**
 * Groups every document that came from a pasted URL by its source
 * domain — "click the domain name to see all the pages saved under it"
 * (an explicit request). Collapsed `<details>` per domain, same pattern
 * EvonDirectory already uses for its department groups, rather than a
 * new disclosure widget. Purely a browsing convenience layered on top of
 * the regular document table below (which still lists every document,
 * URL-sourced or not) — nothing here changes what's fetched or how
 * access is enforced.
 */
export function WebsiteGroups({ documents }: { documents: DocumentRow[] }) {
  const withUrl = documents.filter((d): d is DocumentRow & { sourceUrl: string } => !!d.sourceUrl);
  if (withUrl.length === 0) return null;

  const byDomain = new Map<string, (DocumentRow & { sourceUrl: string })[]>();
  for (const doc of withUrl) {
    let domain: string;
    try {
      domain = new URL(doc.sourceUrl).hostname;
    } catch {
      domain = doc.sourceUrl;
    }
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(doc);
  }
  const domains = [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Websites</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Pages added from a URL, grouped by the site they came from.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {domains.map(([domain, docs]) => (
          <details key={domain} className="group rounded-lg border border-zinc-200 dark:border-zinc-800 open:pb-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <span className="flex min-w-0 items-center gap-2">
                <Globe size={14} className="shrink-0 text-brand-600" />
                <span className="truncate">{domain}</span>
              </span>
              <span className="shrink-0 text-xs font-normal text-zinc-400">
                {docs.length} page{docs.length === 1 ? '' : 's'}
              </span>
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
        ))}
      </div>
    </section>
  );
}
