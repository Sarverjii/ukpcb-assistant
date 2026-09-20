'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export type PickableLocation = { id: string; name: string };

/**
 * Multi-select location checkbox-dropdown — used wherever a document needs
 * one or more locations assigned (upload/edit). A near-exact mirror of
 * components/shared/DepartmentPicker.tsx (same portal-to-body positioning,
 * same outside-click/scroll-close behavior, fixing the same real
 * overflow-clipping and off-screen-panel bugs that component's own comment
 * documents) — kept as a genuine sibling file rather than a shared generic
 * component specifically so a future change to one picker's behavior can't
 * silently ripple into the other; the two pickers back conceptually
 * different, independently-evolving axes (department vs location — see
 * Location's schema.prisma comment for how they differ), not the same
 * concept wearing two labels.
 *
 * There's deliberately no employee-side equivalent of this picker: an
 * employee has exactly ONE location (User.locationId, a required scalar
 * FK, not a multi-select relation like Department), so employee location
 * assignment uses the existing single-select SingleSelect component
 * instead, the same way role assignment already does.
 *
 * Always fed by lib/db/queries/locations.ts::listLocations().
 */
export function LocationPicker({
  locations,
  selectedIds,
  onChange,
  disabled,
  placeholder = 'No locations',
}: {
  locations: PickableLocation[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, maxHeight: 240, openUpward: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  function handleToggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const MARGIN = 8;
      const PREFERRED = 240;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      const openUpward = spaceBelow < PREFERRED && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(PREFERRED, openUpward ? spaceAbove : spaceBelow));
      setCoords({
        top: openUpward ? rect.top - maxHeight - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight,
        openUpward,
      });
    }
    setOpen((o) => !o);
  }

  const selectedNames = locations.filter((l) => selectedIds.includes(l.id)).map((l) => l.name);
  const label =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} locations`;

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggleOpen}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
      >
        <span className={`truncate ${selectedNames.length === 0 ? 'text-zinc-400' : 'text-zinc-900 dark:text-white'}`}>
          {label}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: Math.max(8, coords.top),
              left: coords.left,
              minWidth: Math.max(coords.width, 192),
              maxHeight: coords.maxHeight,
            }}
            className="fixed z-50 flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg"
          >
            {locations.length > 1 && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 px-3 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => onChange(locations.map((l) => l.id))}
                  className="font-medium text-brand-600 hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="font-medium text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  Clear all
                </button>
              </div>
            )}
            <div className="overflow-y-auto py-1">
              {locations.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">No locations exist yet.</p>}
              {locations.map((l) => {
                const checked = selectedIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggle(l.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-300 dark:border-zinc-600'
                      }`}
                    >
                      {checked && <Check size={12} />}
                    </span>
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
