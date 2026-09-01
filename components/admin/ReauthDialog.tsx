'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X } from 'lucide-react';

/**
 * Gates one "great concern" admin action behind re-entering the ADMIN'S OWN
 * current password — remove/delete an employee, reset a password,
 * disable/enable an account, bulk import. `onConfirm` is the action itself;
 * this component only owns the password field and pending/error state, so
 * every call site stays a one-line wrapper around its own server action.
 *
 * Portaled to document.body — see EmailPreviewModal's comment; needed for
 * the same reason (EmployeesTable renders this per-row, inside a <tr>).
 */
export function ReauthDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (password: string) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, pending]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onConfirm(password);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={() => !pending && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                destructive
                  ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Lock size={14} />
            </span>
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          {description && <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Confirm your password
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800 px-5 py-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !password}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-700 dark:bg-brand-600 hover:bg-brand-800'
            }`}
          >
            {pending ? 'Checking…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
