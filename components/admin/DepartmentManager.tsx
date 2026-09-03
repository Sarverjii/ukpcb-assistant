'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { createDepartmentAction, renameDepartmentAction } from '@/app/(app)/admin/departments/actions';

type Department = { id: string; name: string };

/**
 * Modeled directly on HierarchyManager.tsx (list + inline add form), minus
 * the reorder controls (departments have no rank) and minus a delete
 * action — mirrors Role, which also can't be deleted, only added/renamed,
 * so nothing in this app ever needs to handle "a department disappeared
 * out from under a document/employee still tagged with it".
 */
export function DepartmentManager({ departments }: { departments: Department[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        {departments.map((dept, i) => (
          <DepartmentRow key={dept.id} dept={dept} isFirst={i === 0} />
        ))}
        {departments.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-400">No departments yet.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
          >
            <Plus size={16} /> Add department
          </button>
        ) : (
          <AddDepartmentForm onDone={() => setAddOpen(false)} onError={setError} />
        )}
      </div>
    </div>
  );
}

function DepartmentRow({ dept, isFirst }: { dept: Department; isFirst: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dept.name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await renameDepartmentAction(dept.id, name);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 ${
        !isFirst ? 'border-t border-zinc-100 dark:border-zinc-800' : ''
      }`}
    >
      {editing ? (
        <form onSubmit={handleRename} className="flex flex-1 items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
          />
          <button type="submit" disabled={pending} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
            <Check size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(dept.name);
              setError(null);
            }}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <Link
            href={`/admin/departments/${dept.id}`}
            className="flex flex-1 items-center justify-between text-sm font-medium text-zinc-900 dark:text-white hover:text-brand-600"
          >
            {dept.name}
            <ChevronRight size={16} className="text-zinc-400" />
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${dept.name}`}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-brand-600"
          >
            <Pencil size={14} />
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AddDepartmentForm({ onDone, onError }: { onDone: () => void; onError: (msg: string | null) => void }) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDepartmentAction(formData);
      if (result.error) onError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        name="name"
        placeholder="New department name"
        autoFocus
        required
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-700 dark:bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
      >
        Add
      </button>
      <button type="button" onClick={onDone} className="text-sm text-zinc-500 hover:underline">
        Cancel
      </button>
    </form>
  );
}
