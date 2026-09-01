'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revokeSessionAction } from '@/app/(app)/actions';
import { LocalTime } from '@/components/admin/LocalTime';

type Session = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
};

// Loose, cosmetic parsing only — not a security boundary, just a friendlier
// label than a raw User-Agent string. Good enough for "which browser/OS is
// this" at a glance; deliberately not a full UA-parsing dependency for
// something this low-stakes.
function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsList({
  sessions,
  currentSessionId,
}: {
  sessions: Session[];
  currentSessionId: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(sessions);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleRevoke(id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await revokeSessionAction(id);
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRows((prev) => prev.filter((s) => s.id !== id));
      if (id === currentSessionId) router.push('/login');
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-white">
              {describeUserAgent(s.userAgent)}
              {s.id === currentSessionId && (
                <span className="rounded-full bg-brand-50 dark:bg-brand-950 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-400">
                  This device
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {s.ipAddress ?? 'Unknown IP'} · Last active <LocalTime iso={s.lastSeenAt} />
            </p>
          </div>
          <button
            type="button"
            disabled={pendingId === s.id}
            onClick={() => handleRevoke(s.id)}
            className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {pendingId === s.id ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ))}
      {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-zinc-400">No active sessions.</p>}
      {error && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
