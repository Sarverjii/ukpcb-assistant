'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

const RESULTS = ['SUCCESS', 'DENIED', 'ERROR'];

export function AuditLogFilters({ actions }: { actions: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Any filter change starts back at page 1 — staying on, say, page 4 of
    // an unfiltered list almost never corresponds to page 4 of the
    // filtered one.
    params.delete('page');
    router.push(`/admin/audit-logs?${params.toString()}`);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParam('q', q.trim());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={handleSearchSubmit} className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search user, document, action…"
          className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-7 pr-3 text-sm outline-none focus:border-brand-500"
        />
      </form>
      <select
        value={searchParams.get('action') ?? ''}
        onChange={(e) => updateParam('action', e.target.value)}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
      >
        <option value="">All actions</option>
        {actions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        value={searchParams.get('result') ?? ''}
        onChange={(e) => updateParam('result', e.target.value)}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
      >
        <option value="">All results</option>
        {RESULTS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {(searchParams.get('q') || searchParams.get('action') || searchParams.get('result')) && (
        <button
          type="button"
          onClick={() => {
            setQ('');
            router.push('/admin/audit-logs');
          }}
          className="text-xs font-medium text-zinc-500 hover:text-red-500"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
