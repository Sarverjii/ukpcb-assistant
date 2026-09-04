'use client';

import { useMemo, useState } from 'react';
import { Search, Mail, Crown } from 'lucide-react';

export type DirectoryPerson = {
  id: string;
  name: string;
  email: string;
  roleName: string;
  departments: { id: string; name: string }[];
};

/**
 * The Evon Directory — a company-wide "who's who," visible to every
 * employee (see the page's own gating comment). Two modes, switched
 * purely by whether the search box has anything in it:
 *
 *  - Empty search: every department as its own collapsible group,
 *    department name + head shown up front, membership revealed only on
 *    click — deliberately NOT pre-expanded and deliberately NOT leading
 *    with the viewer's own department(s) (an earlier version did both;
 *    removed per explicit feedback that browsing should start from the
 *    full department list, not the viewer's own membership).
 *  - Non-empty search: a flat, ranked list of every matching person
 *    across the whole company (name, email, or department), regardless
 *    of department — the fast path once you know roughly who you're
 *    looking for.
 *
 * All filtering/grouping happens client-side over the already-fetched
 * roster (see listDirectoryEntries's own sizing rationale — same "dozens
 * to low hundreds, filter in memory" reasoning this app already applies
 * to the Employees and Documents tables).
 */
export function EvonDirectory({
  people,
  departmentHeads,
  viewerId,
}: {
  people: DirectoryPerson[];
  // Department name -> head's name, for the small "Headed by" line on
  // each browsable group below. Keyed by name (not id) since that's what
  // the person-grouping already uses as its key.
  departmentHeads: Record<string, string>;
  viewerId: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return null;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.roleName.toLowerCase().includes(q) ||
        p.departments.some((d) => d.name.toLowerCase().includes(q)),
    );
  }, [people, q]);

  const groups = useMemo(() => {
    const byDept = new Map<string, { name: string; people: DirectoryPerson[] }>();
    const noDept: DirectoryPerson[] = [];
    for (const person of people) {
      if (person.departments.length === 0) {
        noDept.push(person);
        continue;
      }
      for (const dept of person.departments) {
        if (!byDept.has(dept.id)) byDept.set(dept.id, { name: dept.name, people: [] });
        byDept.get(dept.id)!.people.push(person);
      }
    }
    const sorted = [...byDept.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (noDept.length > 0) sorted.push({ name: 'No department', people: noDept });
    return sorted;
  }, [people]);

  return (
    <div className="flex flex-col gap-8">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, role, or department…"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {matches ? (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </p>
          {matches.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((p) => (
                <PersonCard key={p.id} person={p} isViewer={p.id === viewerId} />
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-zinc-400">No one matches &quot;{query}&quot;.</p>
          )}
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">All departments</h2>
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <details
                  key={group.name}
                  className="group rounded-lg border border-zinc-200 dark:border-zinc-800 open:pb-3"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{group.name}</span>
                      {departmentHeads[group.name] && (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          <Crown size={11} className="text-amber-500" /> {departmentHeads[group.name]}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-zinc-400">
                      {group.people.length} {group.people.length === 1 ? 'person' : 'people'}
                    </span>
                  </summary>
                  <div className="grid grid-cols-1 gap-2 px-4 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                    {group.people.map((p) => (
                      <PersonCard key={p.id} person={p} isViewer={p.id === viewerId} compact />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PersonCard({ person, isViewer, compact }: { person: DirectoryPerson; isViewer: boolean; compact?: boolean }) {
  const initials = person.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 dark:bg-brand-600 text-xs font-semibold text-white">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">
          {person.name} {isViewer && <span className="font-normal text-zinc-400">(You)</span>}
        </p>
        <a
          href={`mailto:${person.email}`}
          className="flex items-center gap-1 truncate text-xs text-zinc-500 dark:text-zinc-400 hover:text-brand-600 hover:underline"
        >
          <Mail size={11} className="shrink-0" />
          <span className="truncate">{person.email}</span>
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-zinc-400">{person.roleName}</span>
          {person.departments.map((d) => (
            <span
              key={d.id}
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300"
            >
              {d.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
