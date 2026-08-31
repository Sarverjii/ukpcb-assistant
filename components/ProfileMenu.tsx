'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, ShieldCheck, Upload } from 'lucide-react';
import { logoutAction } from '@/app/(app)/actions';
import { ThemeToggle } from '@/components/ThemeToggle';

export type ProfileMenuUser = { name: string; email: string; roleName: string };

/**
 * The single account menu used everywhere in the app that needs one — the
 * chat sidebar's footer ("full" variant: avatar + name/role row, opening
 * upward) and every other page's header ("compact" variant: bare avatar,
 * opening downward). One component so the two can never drift into two
 * different sets of options, and so a professional detail like "which
 * links appear, in which order" only has to be decided once.
 */
export function ProfileMenu({
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
  variant = 'compact',
  onNavigate,
}: {
  user: ProfileMenuUser;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  variant?: 'compact' | 'full';
  onNavigate?: () => void;
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

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function close() {
    setOpen(false);
    onNavigate?.();
  }

  const menu = (
    <div
      className={`absolute z-20 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg ${
        variant === 'full' ? 'bottom-full left-2 right-2 mb-1' : 'right-0 top-full mt-2 w-64'
      }`}
    >
      <div className="border-b border-zinc-100 dark:border-zinc-800 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{user.name}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{user.roleName} clearance</p>
      </div>
      {isAdmin && (
        <Link
          href="/admin"
          onClick={close}
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ShieldCheck size={15} /> Admin dashboard
        </Link>
      )}
      {canUploadDocuments && (
        <Link
          href="/documents/upload"
          onClick={close}
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <Upload size={15} /> Upload documents
        </Link>
      )}
      <Link
        href="/settings"
        onClick={close}
        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Settings size={15} /> Settings
      </Link>
      <div className="border-t border-zinc-100 dark:border-zinc-800 py-1">
        <ThemeToggle initialTheme={initialTheme} />
      </div>
      <form action={logoutAction} className="border-t border-zinc-100 dark:border-zinc-800 pt-1">
        <button
          type="submit"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <LogOut size={15} /> Sign out
        </button>
      </form>
    </div>
  );

  if (variant === 'full') {
    return (
      <div ref={ref} className="relative border-t border-zinc-200 dark:border-zinc-800 p-2">
        {open && menu}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
        >
          <Avatar initials={initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">{user.name}</span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{user.roleName}</span>
          </span>
          <Settings size={16} className="shrink-0 text-zinc-400 dark:text-zinc-400" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      {open && menu}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Avatar initials={initials} />
        <ChevronDown size={14} className="text-zinc-400 dark:text-zinc-500" />
      </button>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 dark:bg-brand-600 text-xs font-semibold text-white">
      {initials}
    </span>
  );
}
