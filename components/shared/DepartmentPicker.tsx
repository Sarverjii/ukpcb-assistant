'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export type PickableDepartment = { id: string; name: string };

/**
 * Multi-select department checkbox-dropdown — the ONE picker used
 * everywhere a department needs to be assigned: document upload/edit
 * (multiple departments per document) and employee add/edit (multiple
 * departments per employee). Modeled on AdminNav.tsx's own mobile-menu
 * dropdown pattern (useState + useRef + outside-click listener), reused
 * here rather than reinvented, so this one well-built widget replaces what
 * would otherwise be two bespoke free-text inputs.
 *
 * Always fed by lib/db/queries/departments.ts::listDepartments() — see that
 * file's comment for why every department list in the app comes from
 * exactly one query, guaranteeing this picker never drifts from the real,
 * current department list.
 */
export function DepartmentPicker({
  departments,
  selectedIds,
  onChange,
  disabled,
  placeholder = 'No departments',
}: {
  departments: PickableDepartment[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedNames = departments.filter((d) => selectedIds.includes(d.id)).map((d) => d.name);
  const label =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length <= 2
        ? selectedNames.join(', ')
        : `${selectedNames.length} departments`;

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
      >
        <span className={selectedNames.length === 0 ? 'text-zinc-400' : 'text-zinc-900 dark:text-white'}>
          {label}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full min-w-[12rem] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg">
          {departments.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-400">No departments exist yet.</p>
          )}
          {departments.map((d) => {
            const checked = selectedIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-zinc-300 dark:border-zinc-600'
                  }`}
                >
                  {checked && <Check size={12} />}
                </span>
                {d.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
