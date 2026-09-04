import Link from 'next/link';
import { listAuditLogs, listDistinctAuditActions, type AuditLogEntry } from '@/lib/db/queries/auditLogs';
import { listRolesByRank } from '@/lib/db/queries/users';
import { describeAuditEvent } from '@/lib/audit/describe';
import { AuditLogFilters } from '@/components/admin/AuditLogFilters';
import { LocalTime } from '@/components/admin/LocalTime';

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string; result?: string; q?: string; noAnswer?: string }>;
}) {
  const { page: pageParam, action, result, q, noAnswer } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const filters = {
    action: action || undefined,
    result: result || undefined,
    q: q || undefined,
    noAuthorizedInfoAnswer: noAnswer === '1' || undefined,
  };
  const isFiltered = Boolean(filters.action || filters.result || filters.q || filters.noAuthorizedInfoAnswer);

  const [{ entries, total, totalPages }, distinctActions, roles] = await Promise.all([
    listAuditLogs(page, filters),
    listDistinctAuditActions(),
    listRolesByRank(),
  ]);
  const roleNameByRank = new Map(roles.map((r) => [r.hierarchyRank, r.name]));

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.result) params.set('result', filters.result);
    if (filters.q) params.set('q', filters.q);
    if (filters.noAuthorizedInfoAnswer) params.set('noAnswer', '1');
    params.set('page', String(p));
    return `/admin/audit-logs?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {isFiltered ? `${total} matching event${total === 1 ? '' : 's'}` : `${total} events recorded`}
        </p>
      </div>

      <AuditLogFilters actions={distinctActions} />

      <div className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <AuditLogRow key={entry.id} entry={entry} roleNameByRank={roleNameByRank} />
        ))}
        {entries.length === 0 && (
          <p className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-sm text-zinc-400">
            {isFiltered ? 'No events match your filters.' : 'No activity yet.'}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <Link
          href={pageHref(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={page <= 1 ? 'pointer-events-none text-zinc-300' : 'text-brand-600 hover:underline'}
        >
          ← Previous
        </Link>
        <span className="text-zinc-500">
          Page {page} of {totalPages || 1}
        </span>
        <Link
          href={pageHref(page + 1)}
          aria-disabled={page >= totalPages}
          className={page >= totalPages ? 'pointer-events-none text-zinc-300' : 'text-brand-600 hover:underline'}
        >
          Next →
        </Link>
      </div>
    </div>
  );
}

const RESULT_STYLES: Record<string, string> = {
  SUCCESS: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  DENIED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  ERROR: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};

function AuditLogRow({
  entry,
  roleNameByRank,
}: {
  entry: AuditLogEntry;
  roleNameByRank: Map<number, string>;
}) {
  const summary = describeAuditEvent(entry.action, entry.metadata, entry.resource, roleNameByRank);
  const hasDetails = Boolean(
    entry.resource || (entry.metadata && Object.keys(entry.metadata as object).length > 0),
  );

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-900 dark:text-zinc-100">{summary}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {entry.userName ? (
              <>
                <span className="font-medium text-zinc-500 dark:text-zinc-400">{entry.userName}</span>
                {entry.userEmail && <span> · {entry.userEmail}</span>}
                <span> · </span>
              </>
            ) : (
              'System · '
            )}
            <LocalTime iso={entry.createdAt.toISOString()} />
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_STYLES[entry.result] ?? 'bg-zinc-100 text-zinc-600'}`}
        >
          {entry.result}
        </span>
      </div>

      {hasDetails && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            Details
          </summary>
          <div className="mt-1.5 space-y-1 rounded-md bg-zinc-50 dark:bg-zinc-950 p-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            <div>
              action: <span className="text-zinc-700 dark:text-zinc-300">{entry.action}</span>
            </div>
            {entry.resource && (
              <div>
                resource: <span className="text-zinc-700 dark:text-zinc-300">{entry.resource}</span>
              </div>
            )}
            {entry.metadata !== null && entry.metadata !== undefined && (
              <pre className="overflow-x-auto whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
