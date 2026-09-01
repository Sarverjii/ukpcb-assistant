'use client';

import { useState } from 'react';

export type LibraryDocument = {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  tags: string[];
  clearanceLevel: number;
  updatedAt: string;
};
type Role = { hierarchyRank: number; name: string };

/**
 * Read-only browse view for the Feature 2 document library — deliberately
 * NOT DocumentsTable/DocumentRow with props gated off: that component's
 * row is almost entirely delete/replace/clearance-change actions with
 * nothing to reuse here, and no uploader/status columns belong on a page
 * every employee (not just uploaders) sees. Same client-side filter-bar
 * pattern as DocumentsTable, at the same corpus size this app already
 * reasons about elsewhere (dozens to low hundreds).
 */
export function DocumentLibraryTable({ documents, roles }: { documents: LibraryDocument[]; roles: Role[] }) {
  const [search, setSearch] = useState('');
  const [clearanceFilter, setClearanceFilter] = useState('ALL');
  const departments = Array.from(new Set(documents.map((d) => d.department).filter(Boolean))) as string[];
  const [departmentFilter, setDepartmentFilter] = useState('ALL');

  const q = search.trim().toLowerCase();
  const filtered = documents.filter((d) => {
    if (clearanceFilter !== 'ALL' && String(d.clearanceLevel) !== clearanceFilter) return false;
    if (departmentFilter !== 'ALL' && d.department !== departmentFilter) return false;
    if (q && !d.name.toLowerCase().includes(q) && !d.description?.toLowerCase().includes(q)) return false;
    return true;
  });

  const roleNameByRank = new Map(roles.map((r) => [r.hierarchyRank, r.name]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description…"
          className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={clearanceFilter}
          onChange={(e) => setClearanceFilter(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All clearances</option>
          {roles.map((r) => (
            <option key={r.hierarchyRank} value={r.hierarchyRank}>
              {r.name}
            </option>
          ))}
        </select>
        {departments.length > 0 && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
          >
            <option value="ALL">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-zinc-400">
          {filtered.length} of {documents.length}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((d) => (
          <div key={d.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{d.name}</p>
            {d.description && (
              <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{d.description}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                {roleNameByRank.get(d.clearanceLevel) ?? `Level ${d.clearanceLevel}`}
              </span>
              {d.department && (
                <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                  {d.department}
                </span>
              )}
              {d.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-[11px] text-brand-700 dark:text-brand-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-zinc-400">No documents match.</p>
        )}
      </div>
    </div>
  );
}
