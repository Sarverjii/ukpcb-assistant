'use client';

import { useState, useTransition } from 'react';
import { Pencil, Check, X, Crown } from 'lucide-react';
import { updateDepartmentAction } from '@/app/(app)/admin/departments/actions';

type Member = { id: string; name: string };

/**
 * The editable identity of a department — name, description, and head —
 * all saved through the one updateDepartmentAction. Inline-edit pattern
 * (click the pencil, edit in place, save/cancel) matching this app's
 * established editing conventions (HierarchyManager's rows, EmployeesTable's
 * inline selects) rather than a separate settings page.
 */
export function DepartmentDetailHeader({
  departmentId,
  name,
  description,
  headUserId,
  members,
}: {
  departmentId: string;
  name: string;
  description: string | null;
  headUserId: string | null;
  members: Member[];
}) {
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [headValue, setHeadValue] = useState(headUserId ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentHead = members.find((m) => m.id === headUserId);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateDepartmentAction(departmentId, {
        name: nameValue,
        description: descriptionValue.trim() || null,
        headUserId: headValue || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  function handleCancel() {
    setNameValue(name);
    setDescriptionValue(description ?? '');
    setHeadValue(headUserId ?? '');
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{name}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {description || <span className="italic text-zinc-400 dark:text-zinc-600">No description yet</span>}
          </p>
          {currentHead && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <Crown size={14} className="text-amber-500" /> Headed by {currentHead.name}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <Pencil size={13} /> Edit
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Name</span>
        <input
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          required
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Description</span>
        <textarea
          value={descriptionValue}
          onChange={(e) => setDescriptionValue(e.target.value)}
          rows={2}
          placeholder="What this department does, at a glance…"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Head</span>
        <select
          value={headValue}
          onChange={(e) => setHeadValue(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="">No head set</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {members.length === 0 && (
          <span className="text-xs text-zinc-400">Add a member below before you can set a head.</span>
        )}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-brand-700 dark:bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
        >
          <Check size={14} /> Save
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}
