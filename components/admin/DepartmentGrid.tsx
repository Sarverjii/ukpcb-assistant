'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Users, FileText, Crown, Layers, UserX, MessageSquare } from 'lucide-react';
import { createDepartmentAction } from '@/app/(app)/admin/departments/actions';
import { TileIcon } from '@/components/shared/Avatar';

type Department = {
  id: string;
  name: string;
  description: string | null;
  head: { id: string; name: string; email: string } | null;
  isHeadDepartment: boolean;
  dailyMessageLimit: number | null;
  memberCount: number;
  documentCount: number;
};

/**
 * A card grid, not a bare list — each department is a real at-a-glance
 * summary (description, head, member/document counts) rather than a name
 * you have to click through to learn anything about. Modeled on the same
 * card visual language as the document library's grid
 * (components/documents/DocumentLibraryTable.tsx), the closest existing
 * precedent for "browsable cards" in this app. A trailing "No department"
 * card — styled distinctly (dashed border, not a real Department row) —
 * links to a lightweight worklist of employees currently in zero
 * departments, since membership is optional and that's an expected,
 * ordinary state worth being able to find and act on.
 */
export function DepartmentGrid({
  departments,
  noDepartmentCount,
}: {
  departments: Department[];
  noDepartmentCount: number;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {departments.map((dept) => (
          <Link
            key={dept.id}
            href={`/admin/departments/${dept.id}`}
            className="group flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-sm transition-colors"
          >
            <div className="flex items-start gap-3">
              <TileIcon label={dept.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{dept.name}</p>
                  {dept.isHeadDepartment && (
                    <Layers size={12} className="shrink-0 text-brand-600" aria-label="Head department" />
                  )}
                </div>
                {dept.head ? (
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <Crown size={11} className="shrink-0 text-amber-500" />
                    <span className="truncate">{dept.head.name}</span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">No head set</p>
                )}
              </div>
            </div>

            {dept.description ? (
              <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{dept.description}</p>
            ) : (
              <p className="text-xs italic text-zinc-400 dark:text-zinc-600">No description yet</p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Users size={13} /> {dept.memberCount} member{dept.memberCount === 1 ? '' : 's'}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText size={13} /> {dept.documentCount} document{dept.documentCount === 1 ? '' : 's'}
              </span>
              {dept.dailyMessageLimit !== null && (
                <span className="flex items-center gap-1.5">
                  <MessageSquare size={13} /> {dept.dailyMessageLimit}/day budget
                </span>
              )}
            </div>
          </Link>
        ))}

        <Link
          href="/admin/departments/none"
          className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <UserX size={14} />
            <p className="text-sm font-semibold">No department</p>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Employees not currently in any department.
          </p>
          <div className="mt-auto flex items-center gap-1.5 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
            <Users size={13} /> {noDepartmentCount} employee{noDepartmentCount === 1 ? '' : 's'}
          </div>
        </Link>

        <AddDepartmentCard open={addOpen} onOpen={() => setAddOpen(true)} onClose={() => setAddOpen(false)} onError={setError} />
      </div>

      {departments.length === 0 && !addOpen && (
        <p className="py-6 text-center text-sm text-zinc-400">No departments yet — add your first one above.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function AddDepartmentCard({
  open,
  onOpen,
  onClose,
  onError,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 transition-colors"
      >
        <Plus size={20} />
        Add department
      </button>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDepartmentAction(formData);
      if (result.error) onError(result.error);
      else onClose();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-[9.5rem] flex-col justify-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"
    >
      <input
        name="name"
        placeholder="Department name"
        autoFocus
        required
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-700 dark:bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
