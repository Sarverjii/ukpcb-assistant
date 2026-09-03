'use client';

import { useState, useTransition } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { addDepartmentMemberAction, removeDepartmentMemberAction } from '@/app/(app)/admin/departments/actions';

type Employee = { id: string; name: string; email: string; roleName: string };

/**
 * The one piece of this feature with no direct precedent elsewhere in the
 * app (Role has no membership concept to manage) — built fresh, but styled
 * consistently with EmployeesTable: two side-by-side lists (current
 * members, everyone else) with a search box each, since a full roster can
 * run to dozens of names.
 */
export function DepartmentMembers({
  departmentId,
  members,
  nonMembers,
}: {
  departmentId: string;
  members: Employee[];
  nonMembers: Employee[];
}) {
  const [memberSearch, setMemberSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(userId: string) {
    setPendingId(userId);
    setError(null);
    startTransition(async () => {
      const result = await removeDepartmentMemberAction(departmentId, userId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  function add(userId: string) {
    setPendingId(userId);
    setError(null);
    startTransition(async () => {
      const result = await addDepartmentMemberAction(departmentId, userId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  const filteredMembers = members.filter((m) => matches(m, memberSearch));
  const filteredNonMembers = nonMembers.filter((m) => matches(m, addSearch));

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Members</h2>
        <input
          type="text"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
          placeholder="Search members…"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {filteredMembers.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-white">{m.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {m.email} · {m.roleName}
                </p>
              </div>
              <button
                type="button"
                disabled={pendingId === m.id}
                onClick={() => remove(m.id)}
                aria-label={`Remove ${m.name}`}
                className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 disabled:opacity-50"
              >
                <UserMinus size={15} />
              </button>
            </div>
          ))}
          {filteredMembers.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">No members yet.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Add members</h2>
        <input
          type="text"
          value={addSearch}
          onChange={(e) => setAddSearch(e.target.value)}
          placeholder="Search employees…"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {filteredNonMembers.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-white">{m.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {m.email} · {m.roleName}
                </p>
              </div>
              <button
                type="button"
                disabled={pendingId === m.id}
                onClick={() => add(m.id)}
                aria-label={`Add ${m.name}`}
                className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:text-emerald-600 disabled:opacity-50"
              >
                <UserPlus size={15} />
              </button>
            </div>
          ))}
          {filteredNonMembers.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">Everyone is already a member.</p>
          )}
        </div>
      </section>

      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
    </div>
  );
}

function matches(e: Employee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
}
