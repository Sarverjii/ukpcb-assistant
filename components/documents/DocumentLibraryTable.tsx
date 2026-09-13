'use client';

import { useMemo, useState } from 'react';
import { Files, Globe, ExternalLink, ChevronDown } from 'lucide-react';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';
import { SingleSelect } from '@/components/shared/SingleSelect';

export type LibraryDocument = {
  id: string;
  name: string;
  description: string | null;
  departments: PickableDepartment[];
  tags: string[];
  clearanceLevel: number;
  updatedAt: string;
  // Set only for a document added by pasting a URL — see
  // Document.sourceUrl's own comment. Splits this library into its own
  // "Websites" tab rather than mixing live web pages in among uploaded
  // files, and links straight to the real page instead of an internal PDF
  // rendition.
  sourceUrl: string | null;
};
type Role = { hierarchyRank: number; name: string };
type TabId = 'documents' | 'websites';

/**
 * Read-only browse view for the Feature 2 document library — deliberately
 * NOT DocumentsTable/DocumentRow with props gated off: that component's
 * row is almost entirely delete/replace/clearance-change actions with
 * nothing to reuse here, and no uploader/status columns belong on a page
 * every employee (not just uploaders) sees. Split into Documents/Websites
 * tabs mirroring the Knowledge Base's own tab split (KnowledgeBase.tsx) —
 * a website page was ending up mixed in among uploaded files here, opening
 * through the internal PDF-rendition viewer instead of the real live page
 * it actually came from.
 */
export function DocumentLibraryTable({
  documents,
  roles,
  departments,
  isAdmin,
}: {
  documents: LibraryDocument[];
  roles: Role[];
  // The full canonical department list (see listDepartments()) — only
  // ever non-empty when isAdmin, per the page's own gating.
  departments: PickableDepartment[];
  // Clearance/department filters are admin-only — a regular employee sees
  // only what their own clearance already lets through, so filtering by
  // clearance or department adds nothing for them but UI clutter.
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<TabId>('documents');
  const [search, setSearch] = useState('');
  const [clearanceFilter, setClearanceFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');

  const { fileDocuments, websiteDocuments } = useMemo(() => {
    const files: LibraryDocument[] = [];
    const sites: LibraryDocument[] = [];
    for (const d of documents) (d.sourceUrl ? sites : files).push(d);
    return { fileDocuments: files, websiteDocuments: sites };
  }, [documents]);

  const q = search.trim().toLowerCase();
  const filtered = fileDocuments.filter((d) => {
    if (clearanceFilter !== 'ALL' && String(d.clearanceLevel) !== clearanceFilter) return false;
    if (departmentFilter !== 'ALL' && !d.departments.some((dept) => dept.id === departmentFilter)) return false;
    if (q && !d.name.toLowerCase().includes(q) && !d.description?.toLowerCase().includes(q)) return false;
    return true;
  });

  const roleNameByRank = new Map(roles.map((r) => [r.hierarchyRank, r.name]));

  const tabs: { id: TabId; label: string; icon: typeof Files; count: number }[] = [
    { id: 'documents', label: 'Documents', icon: Files, count: fileDocuments.length },
    { id: 'websites', label: 'Websites', icon: Globe, count: websiteDocuments.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <t.icon size={15} />
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  isActive
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </nav>

      {tab === 'documents' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or description…"
              className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
            />
            {isAdmin && (
              <SingleSelect
                value={clearanceFilter}
                onChange={setClearanceFilter}
                options={[{ value: 'ALL', label: 'All clearances' }, ...roles.map((r) => ({ value: String(r.hierarchyRank), label: r.name }))]}
              />
            )}
            {isAdmin && departments.length > 0 && (
              <SingleSelect
                value={departmentFilter}
                onChange={setDepartmentFilter}
                options={[{ value: 'ALL', label: 'All departments' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
              />
            )}
            <span className="text-xs text-zinc-400">
              {filtered.length} of {fileDocuments.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((d) => (
              <a
                key={d.id}
                href={`/api/documents/${d.id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-sm transition-colors"
              >
                <p className="text-sm font-medium text-zinc-900 dark:text-white">{d.name}</p>
                {d.description && (
                  <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{d.description}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {roleNameByRank.get(d.clearanceLevel) ?? `Level ${d.clearanceLevel}`}
                  </span>
                  {d.departments.map((dept) => (
                    <span
                      key={dept.id}
                      className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300"
                    >
                      {dept.name}
                    </span>
                  ))}
                  {d.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-[11px] text-brand-700 dark:text-brand-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </a>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-zinc-400">
                {fileDocuments.length === 0 ? 'No uploaded documents yet.' : 'No documents match.'}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'websites' && <WebsiteList documents={websiteDocuments} />}
    </div>
  );
}

/**
 * Grouped by source domain, same "click the domain to see all its pages"
 * browsing pattern the Knowledge Base's WebsiteGroups already established
 * — every page here is always public to everyone (see UrlUploadForm's own
 * comment), so unlike the Documents tab above there's no clearance filter
 * to offer. Every link opens the real, live page — never the internal PDF
 * viewer uploaded files use.
 */
function WebsiteList({ documents }: { documents: LibraryDocument[] }) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const byDomain = new Map<string, LibraryDocument[]>();
  for (const doc of documents) {
    if (!doc.sourceUrl) continue;
    if (q && !doc.name.toLowerCase().includes(q)) continue;
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
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search pages by name…"
        className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
      />

      {domains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-10 text-center">
          <Globe size={22} className="mx-auto text-zinc-300 dark:text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {documents.length === 0 ? 'No websites have been added yet.' : 'No pages match your search.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {domains.map(([domain, docs]) => (
            <details key={domain} className="group rounded-xl border border-zinc-200 dark:border-zinc-800 open:pb-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                    <Globe size={15} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{domain}</span>
                    <span className="text-xs font-normal text-zinc-400">
                      {docs.length} page{docs.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </span>
                <ChevronDown size={16} className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-1 px-4 pt-1">
                {docs.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.sourceUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink size={12} className="shrink-0 text-zinc-400" />
                    <span className="truncate">{doc.name}</span>
                  </a>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
