import Link from 'next/link';
import { listAuditLogs } from '@/lib/db/queries/auditLogs';

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { entries, total, totalPages } = await listAuditLogs(page);

  return (
    <div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{total} events recorded.</p>

      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {entry.createdAt.toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {entry.user ? (
                    <>
                      {entry.user.name}
                      <div className="text-xs text-zinc-400">{entry.user.email}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{entry.action}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{entry.resource ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      entry.result === 'SUCCESS'
                        ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                        : entry.result === 'DENIED'
                          ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
                          : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700'
                    }
                  >
                    {entry.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link
          href={`/admin/audit-logs?page=${Math.max(1, page - 1)}`}
          aria-disabled={page <= 1}
          className={page <= 1 ? 'pointer-events-none text-zinc-300' : 'text-brand-600 hover:underline'}
        >
          ← Previous
        </Link>
        <span className="text-zinc-500">
          Page {page} of {totalPages || 1}
        </span>
        <Link
          href={`/admin/audit-logs?page=${page + 1}`}
          aria-disabled={page >= totalPages}
          className={page >= totalPages ? 'pointer-events-none text-zinc-300' : 'text-brand-600 hover:underline'}
        >
          Next →
        </Link>
      </div>
    </div>
  );
}
