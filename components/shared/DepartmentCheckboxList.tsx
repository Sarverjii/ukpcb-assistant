'use client';

import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

/**
 * A plain horizontal row of checkboxes — one per department — used
 * specifically for document department tagging (upload form and the
 * Knowledge Base management table), as distinct from DepartmentPicker's
 * checkbox-DROPDOWN used for employee department assignment. Every
 * department is visible and togglable at a glance, no popup to open, at
 * the cost of needing more horizontal room — acceptable here since the
 * canonical department list is small (a handful of entries) and document
 * tagging is a "set it and rarely revisit" action, unlike the picker's use
 * on a per-row table cell.
 */
export function DepartmentCheckboxList({
  departments,
  selectedIds,
  onChange,
  disabled,
}: {
  departments: PickableDepartment[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  if (departments.length === 0) {
    return <p className="text-xs text-zinc-400">No departments exist yet.</p>;
  }

  return (
    <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
      {departments.map((d) => (
        <label
          key={d.id}
          className={`flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(d.id)}
            onChange={() => toggle(d.id)}
            disabled={disabled}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-brand-600 focus:ring-brand-500"
          />
          {d.name}
        </label>
      ))}
    </div>
  );
}
