'use client';

import { useState, useTransition } from 'react';
import { Check, Pencil, X, Gauge, Users, Building2 } from 'lucide-react';
import { setOrgMessageLimitAction } from '@/app/(app)/admin/usage-limits/actions';

type UsageRow = { id: string; label: string; sublabel?: string; used: number; limit: number };

/**
 * The visibility half of usage limiting — real companies don't just set a
 * ceiling and walk away, they watch how close usage is running to it, day
 * by day, so the numbers can be tuned instead of guessed at once and
 * forgotten. Three sections: the org-wide circuit breaker (editable right
 * here), then today's top employees and departments by usage — anyone
 * with zero messages today simply doesn't appear, so this stays a short,
 * actionable list even as the roster grows, not a wall of zeroes.
 */
export function UsageLimitsManager({
  org,
  users,
  departments,
}: {
  org: { used: number; limit: number };
  users: UsageRow[];
  departments: UsageRow[];
}) {
  const [editingOrg, setEditingOrg] = useState(false);
  const [orgLimitValue, setOrgLimitValue] = useState(String(org.limit));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function saveOrgLimit() {
    const parsed = Number(orgLimitValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('Daily message limit must be a positive whole number.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setOrgMessageLimitAction(parsed);
      if (result.error) setError(result.error);
      else setEditingOrg(false);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
              <Gauge size={18} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Company-wide daily limit</h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                The final circuit breaker — enforced even when no single employee or department is
                anywhere near their own limit. Resets at midnight UTC.
              </p>
            </div>
          </div>
          {!editingOrg && (
            <button
              type="button"
              onClick={() => {
                setOrgLimitValue(String(org.limit));
                setEditingOrg(true);
                setError(null);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4">
          {editingOrg ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                type="number"
                min={1}
                value={orgLimitValue}
                onChange={(e) => setOrgLimitValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveOrgLimit();
                  if (e.key === 'Escape') setEditingOrg(false);
                }}
                disabled={pending}
                className="w-28 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={saveOrgLimit}
                disabled={pending}
                aria-label="Save"
                className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-50"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={() => setEditingOrg(false)}
                disabled={pending}
                aria-label="Cancel"
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </span>
          ) : (
            <UsageBar used={org.used} limit={org.limit} size="lg" />
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Users size={15} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Today&apos;s usage by employee</h2>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Per-employee limits are set from the role default (Admin → Hierarchy) or an individual
          override (Admin → Employees). Only employees with at least one message today are listed.
        </p>
        <UsageTable rows={users} emptyLabel="No chat messages sent yet today." />
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Today&apos;s usage by department</h2>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Only departments with an explicit budget set (Admin → Departments) are shown — most
          departments have no aggregate cap and rely on each member&apos;s own limit instead.
        </p>
        <UsageTable rows={departments} emptyLabel="No department has an active budget with usage today." />
      </section>
    </div>
  );
}

function UsageTable({ rows, emptyLabel }: { rows: UsageRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="mt-3 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-sm text-zinc-400">{emptyLabel}</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      {rows.map((row, i) => (
        <div
          key={row.id}
          className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${i !== 0 ? 'border-t border-zinc-100 dark:border-zinc-800' : ''}`}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{row.label}</p>
            {row.sublabel && <p className="truncate text-xs text-zinc-400">{row.sublabel}</p>}
          </div>
          <UsageBar used={row.used} limit={row.limit} />
        </div>
      ))}
    </div>
  );
}

function UsageBar({ used, limit, size = 'sm' }: { used: number; limit: number; size?: 'sm' | 'lg' }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const atLimit = used >= limit;
  const near = !atLimit && pct >= 80;
  const barColor = atLimit ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-brand-500';
  const textColor = atLimit ? 'text-red-600 dark:text-red-400' : near ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400';
  return (
    <div className={`flex shrink-0 items-center gap-2 ${size === 'lg' ? 'w-64' : 'w-40'}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`shrink-0 whitespace-nowrap text-xs font-medium tabular-nums ${textColor}`}>
        {used}/{limit}
      </span>
    </div>
  );
}
