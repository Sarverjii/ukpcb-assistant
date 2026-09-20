'use client';

import { Check } from 'lucide-react';
import type { PickableLocation } from '@/components/shared/LocationPicker';

/**
 * A horizontal row of toggle pills — one per location — used specifically
 * for document location tagging (upload form and the Knowledge Base
 * management table), the exact same pattern as DepartmentCheckboxList
 * applied to the separate location axis (see Location's schema.prisma
 * comment for how the two axes differ). Kept as a genuine sibling file
 * rather than a shared generic component for the same reason
 * LocationPicker is a sibling of DepartmentPicker.
 */
export function LocationCheckboxList({
  locations,
  selectedIds,
  onChange,
  disabled,
}: {
  locations: PickableLocation[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  if (locations.length === 0) {
    return <p className="text-xs text-zinc-400">No locations exist yet.</p>;
  }

  return (
    <div className="flex flex-row flex-wrap items-center gap-1.5">
      {locations.map((l) => {
        const selected = selectedIds.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(l.id)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              selected
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {selected && <Check size={11} className="shrink-0" />}
            {l.name}
          </button>
        );
      })}
    </div>
  );
}
