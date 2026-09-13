'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X, Layers, Trash2 } from 'lucide-react';
import { updateDepartmentAction, deleteDepartmentAction } from '@/app/(app)/admin/departments/actions';
import { TileIcon } from '@/components/shared/Avatar';
import { SingleSelect } from '@/components/shared/SingleSelect';

type Member = { id: string; name: string };

/**
 * The editable identity of a department — name, description, head, budget,
 * and the head-department flag — all saved through the one
 * updateDepartmentAction. Inline-edit pattern (click the pencil, edit in
 * place, save/cancel) matching this app's established editing conventions
 * (HierarchyManager's rows, EmployeesTable's inline selects) rather than a
 * separate settings page.
 *
 * Deliberately shows only identity (name, description, the head-department
 * badge) in its READ-ONLY view — head, budget, and member/document counts
 * moved to DepartmentFactsSidebar alongside this header once the page grew
 * enough fields that stacking everything into one always-expanded card
 * stopped reading as organized. This component still OWNS all of those
 * fields in its edit form (one save action, one place to change anything),
 * it just doesn't redundantly display them twice.
 *
 * Also owns the destructive "delete this department" action, kept visually
 * and functionally separate from the edit form (a plain two-click confirm,
 * not a full re-auth dialog — see deleteDepartmentAction's own comment for
 * why that tier of gating fits this action).
 */
export function DepartmentDetailHeader({
  departmentId,
  name,
  description,
  headUserId,
  isHeadDepartment,
  dailyMessageLimit,
  members,
}: {
  departmentId: string;
  name: string;
  description: string | null;
  headUserId: string | null;
  isHeadDepartment: boolean;
  // See Department.dailyMessageLimit's own schema comment — null means no
  // department-level cap at all, the default for every department.
  dailyMessageLimit: number | null;
  members: Member[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [headValue, setHeadValue] = useState(headUserId ?? '');
  const [headDeptValue, setHeadDeptValue] = useState(isHeadDepartment);
  const [limitValue, setLimitValue] = useState(dailyMessageLimit === null ? '' : String(dailyMessageLimit));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedLimit = limitValue.trim();
    if (trimmedLimit && (!Number.isInteger(Number(trimmedLimit)) || Number(trimmedLimit) < 1)) {
      setError('Daily message limit must be a positive whole number, or blank for no department cap.');
      return;
    }
    startTransition(async () => {
      const result = await updateDepartmentAction(departmentId, {
        name: nameValue,
        description: descriptionValue.trim() || null,
        headUserId: headValue || null,
        isHeadDepartment: headDeptValue,
        dailyMessageLimit: trimmedLimit ? Number(trimmedLimit) : null,
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
    setHeadDeptValue(isHeadDepartment);
    setLimitValue(dailyMessageLimit === null ? '' : String(dailyMessageLimit));
    setError(null);
    setEditing(false);
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    startDeleteTransition(async () => {
      const result = await deleteDepartmentAction(departmentId);
      if (result.error) {
        setError(result.error);
        setConfirmingDelete(false);
        return;
      }
      router.push('/admin/departments');
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <TileIcon label={name} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{name}</h1>
                {isHeadDepartment && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                    <Layers size={11} /> Head department
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {description || <span className="italic text-zinc-400 dark:text-zinc-600">No description yet</span>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Pencil size={13} /> Edit
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 px-3 py-2">
          <p className="text-xs text-red-700/80 dark:text-red-400/80">
            Deleting removes this department from every document and employee tagged with it.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePending}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-60 ${
              confirmingDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950'
            }`}
          >
            <Trash2 size={13} /> {confirmingDelete ? 'Confirm delete?' : 'Delete department'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
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
        <SingleSelect
          value={headValue}
          onChange={setHeadValue}
          options={[{ value: '', label: 'No head set' }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
          triggerClassName="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
        {members.length === 0 && (
          <span className="text-xs text-zinc-400">Add a member below before you can set a head.</span>
        )}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Daily message budget (optional)</span>
        <input
          type="number"
          min={1}
          value={limitValue}
          onChange={(e) => setLimitValue(e.target.value)}
          placeholder="Blank = no department-wide cap"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          An aggregate chat-message limit across every member of this department combined, on top of
          (not instead of) each member&apos;s own individual limit. Leave blank unless this
          department needs a tighter, explicit cost budget.
        </span>
      </label>

      <label className="flex items-start gap-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 p-3 text-sm">
        <input
          type="checkbox"
          checked={headDeptValue}
          onChange={(e) => setHeadDeptValue(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Head department</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Members see every document tagged with any department (not just this one), on top of the
            usual clearance and own-department rules. Doesn&apos;t grant access to a document with no
            department at all.
          </span>
        </span>
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
