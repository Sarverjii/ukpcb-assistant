'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * The dropdown panel is portaled to document.body and positioned with
 * `fixed` coordinates computed from the trigger button's own bounding
 * rect — NOT rendered as a normal `absolute` child of the trigger. A
 * plain absolute child gets silently clipped by the first ancestor with
 * non-visible overflow, which both the Employees and Documents admin
 * tables have (`overflow-x-auto`, which per the CSS spec also computes
 * overflow-y to `auto` — a real reported bug: the panel opened but was cut
 * off at the table's bottom edge). Portaling escapes that ancestor
 * entirely, the same fix ReauthDialog/EmailPreviewModal already use for a
 * related reason (rendering inside a `<tr>`).
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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
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
    // A scroll anywhere in the page (most commonly the table wrapper this
    // picker sits inside) closes the dropdown rather than trying to keep
    // fixed coordinates in sync with a moving trigger — the same
    // close-on-scroll behavior most browsers' own <select> dropdowns use.
    // Registered on window with capture:true so a scroll ANYWHERE closes
    // the dropdown — including the page/table scrolling out from under
    // this fixed-position panel, which is the actual point (see the
    // comment above). Scroll events don't bubble, but still traverse the
    // capturing phase through every ancestor of their real target,
    // window included — so without the containment check below, this
    // also fired (and immediately closed the panel) whenever the PANEL'S
    // OWN scrollbar moved, since the panel is a descendant of window too.
    // With exactly 7 departments the list is just tall enough to need
    // that internal scroll, so this was a real bug: the last department
    // or two in the list became permanently unreachable, confirmed
    // directly (Playwright's scrollIntoView on a lower item closed the
    // panel out from under it before the click could land).
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
      setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen((o) => !o);
  }

  const selectedNames = departments.filter((d) => selectedIds.includes(d.id)).map((d) => d.name);
  // Was "join every name up to 2, then switch to a count" — two long
  // department names (e.g. "Sales & Business Development") joined
  // together routinely overflowed a table cell's width with nothing to
  // stop it wrapping onto several lines, ballooning that one row's height
  // far past its neighbors (a real reported bug, not a hypothetical). A
  // single selection still shows its real name (the common case, worth
  // being concrete about); two or more always collapses to a count —
  // `truncate` below is what actually guarantees one line regardless, this
  // just keeps the usual case from needing it.
  const label =
    selectedNames.length === 0
      ? placeholder
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} departments`;

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
            style={{ top: coords.top, left: coords.left, minWidth: Math.max(coords.width, 192) }}
            className="fixed z-50 max-h-60 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
