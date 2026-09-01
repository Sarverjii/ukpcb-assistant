'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mail, X } from 'lucide-react';
import type { ComposedEmail } from '@/lib/employees/emailCompose';

/**
 * Stands in for actually sending an email — see lib/employees/emailCompose.ts
 * for why. Shows exactly what would be sent so nothing is silently lost
 * compared to the old on-screen "here's the temp password" message; the
 * password now only ever appears inside this composed body, not loose on
 * the page.
 *
 * Portaled to document.body — a caller inside a <table> (EmployeesTable's
 * per-row dialogs) can't otherwise render a fixed-position overlay without
 * putting invalid markup directly inside a <tr>.
 */
export function EmailPreviewModal({ email, onClose }: { email: ComposedEmail; onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
              <Mail size={14} />
            </span>
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
              Mail to be sent on — {email.to}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Subject</p>
          <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">{email.subject}</p>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-400">Body</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {email.body}
          </p>
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-2.5 text-xs text-zinc-400">
          Not sent automatically yet — share these credentials with the employee yourself for now.
        </div>
      </div>
    </div>,
    document.body,
  );
}
