'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export type SelectOption = { value: string; label: string };

/**
 * A single-select dropdown built the same way DepartmentPicker.tsx's
 * multi-select one already is (see that file's own comment for the full
 * reasoning on the portal + fixed-position + mousedown-based
 * outside-click pattern) — used everywhere a filter previously used a
 * plain native `<select>`. Replaced directly because of a real reported
 * bug: native `<select>` dropdowns, under at least one real browser/OS
 * combination this app is used on, only stay open while the mouse button
 * is actively held down — a normal click-to-open, click-an-option-to-
 * choose interaction (which is how every OTHER control on this site
 * behaves, DepartmentPicker included) effectively couldn't be used to
 * pick a filter value at all. A native `<select>`'s own popup is
 * browser/OS-native chrome outside this app's control — there is no CSS
 * or JS fix for its open/close behavior specifically, so the actual fix
 * is to stop using it here and reuse the ALREADY-consistent custom
 * dropdown behavior every other picker on this site already has.
 */
export function SingleSelect({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
  triggerClassName = '',
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
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
    // See DepartmentPicker.tsx's identical listener for why this is
    // `mousedown` (fires before the trigger's own `click`, so opening
    // and closing never race) and why scroll/resize also close the panel
    // (its position is computed once, in pixels, at open time — nothing
    // keeps it glued to a trigger that has since moved).
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

  const selected = options.find((o) => o.value === value);

  function select(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggleOpen}
        aria-expanded={open}
        className={
          (triggerClassName ||
            'flex items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500') +
          ' disabled:opacity-50'
        }
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: Math.max(8, coords.top),
              left: coords.left,
              minWidth: Math.max(coords.width, 160),
              maxHeight: coords.maxHeight,
            }}
            className="fixed z-50 flex flex-col overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => select(o.value)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{o.value === value && <Check size={14} className="text-brand-600" />}</span>
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
