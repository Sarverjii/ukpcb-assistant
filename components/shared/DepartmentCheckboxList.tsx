'use client';

import { Check } from 'lucide-react';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

/**
 * A horizontal row of toggle pills — one per department — used
 * specifically for document department tagging (upload form and the
 * Knowledge Base management table), as distinct from DepartmentPicker's
 * checkbox-DROPDOWN used for employee department assignment. Every
 * department is visible and togglable at a glance, no popup to open, at
 * the cost of needing more horizontal room — acceptable here since the
 * canonical department list is small (a handful of entries) and document
 * tagging is a "set it and rarely revisit" action, unlike the picker's use
 * on a per-row table cell.
 *
 * Rendered as actual toggle buttons (not bare native `<input
 * type="checkbox">`s) — a plain checkbox+label pair reads as barely-there
 * in a dense, dark-mode admin table (no visible affordance beyond a tiny
 * native control), which is exactly what made the Knowledge Base table
 * look broken/unstyled. A `<button aria-pressed>` keeps the same toggle
 * semantics while actually looking like a clickable control.
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
    <div className="flex flex-row flex-wrap items-center gap-1.5">
      {departments.map((d) => {
        const selected = selectedIds.includes(d.id);
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(d.id)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              selected
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {selected && <Check size={11} className="shrink-0" />}
            {d.name}
          </button>
        );
      })}
    </div>
  );
}
