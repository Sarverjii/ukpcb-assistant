'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Network, ScrollText, ChevronDown, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Document management lives in the Evon Knowledge Base now (see
// app/(app)/knowledge-base) — reachable by any role granted upload
// rights, not just admins, so it's deliberately not one of these tabs.
// What's left here (Overview, Employees, Hierarchy, Audit Log) is the
// genuinely admin-only surface: user/role management and the audit trail.
const SECTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/employees', label: 'Employees', icon: Users },
  { href: '/admin/hierarchy', label: 'Hierarchy', icon: Network },
  { href: '/admin/audit-logs', label: 'Audit Log', icon: ScrollText },
];

/**
 * Replaces a horizontally-scrolling tab strip (functional, but reads as an
 * afterthought on a phone screen — nothing signals there's more to the
 * right until you happen to swipe) with two purpose-built layouts: proper
 * underlined tabs with icons at sm+ where there's room for all five, and a
 * single tap target below sm that opens the same five as a dropdown list —
 * the standard "collapse a tab strip to a select" pattern, so switching
 * sections on a phone is one deliberate tap instead of a scroll-and-hope.
 */
export function AdminNav() {
  const pathname = usePathname();
  const active = SECTIONS.find((s) => s.href === pathname) ?? SECTIONS[0];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <>
      <nav className="mt-4 hidden gap-1 border-b border-zinc-200 dark:border-zinc-800 sm:flex">
        {SECTIONS.map((s) => {
          const isActive = s.href === active.href;
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <s.icon size={15} />
              {s.label}
            </Link>
          );
        })}
      </nav>

      <div ref={ref} className="relative mt-4 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-sm font-medium text-zinc-900 dark:text-white"
        >
          <span className="flex items-center gap-2">
            <active.icon size={16} className="text-brand-600 dark:text-brand-400" />
            {active.label}
          </span>
          <ChevronDown size={16} className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg">
            {SECTIONS.map((s) => {
              const isActive = s.href === active.href;
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm ${
                    isActive
                      ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium'
                      : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <s.icon size={16} />
                  {s.label}
                  {isActive && <Check size={14} className="ml-auto" />}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
