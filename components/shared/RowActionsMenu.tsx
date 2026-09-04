'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export type RowAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/**
 * A single "⋮" trigger collapsing several row-level actions into one
 * dropdown — the direct fix for a real reported bug: a table row with
 * several inline action buttons (View conversations / Disable / Reset
 * password / Remove) ran out of horizontal room and got visibly cut off
 * at the table's right edge. One icon button per row instead of N text
 * buttons is also just the standard modern admin-table pattern (Linear,
 * Vercel's own dashboard, etc.) — reads as more deliberate/professional
 * than a wall of bordered buttons regardless of the overflow issue.
 *
 * Portaled to document.body with `fixed` coordinates computed from the
 * trigger's own bounding rect, not a normal `absolute` child — the exact
 * same reasoning (and close-on-scroll/outside-click handling) as
 * DepartmentPicker.tsx's dropdown, which exists specifically because a
 * plain absolute child gets clipped by a scrollable table wrapper's
 * `overflow-x-auto`.
 */
export function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
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
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Right-aligned to the trigger (`left` is the panel's right edge
      // minus its own width via CSS, not computed here) — a kebab menu
      // conventionally opens toward the content it belongs to, not off
      // the edge of the viewport for a trigger sitting at the far right
      // of a wide table.
      setCoords({ top: rect.bottom + 4, left: rect.right });
    }
    setOpen((o) => !o);
  }

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-label="Actions"
        aria-expanded={open}
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <MoreVertical size={16} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: coords.top, left: coords.left, transform: 'translateX(-100%)' }}
            className="fixed z-50 min-w-[10rem] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
                className={`block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                  action.danger
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                    : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
