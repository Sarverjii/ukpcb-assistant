import Link from 'next/link';
import { getDashboardOverview } from '@/lib/db/queries/admin';
import { listRecentUnansweredQuestions } from '@/lib/db/queries/auditLogs';
import { prisma } from '@/lib/db/prisma';
import { LocalTime } from '@/components/admin/LocalTime';

export default async function AdminOverviewPage() {
  const [overview, roles, unanswered] = await Promise.all([
    getDashboardOverview(),
    prisma.role.findMany(),
    listRecentUnansweredQuestions(10),
  ]);

  const roleByRank = new Map(roles.map((r) => [r.hierarchyRank, r.name]));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total employees" value={overview.totalEmployees} />
        <StatCard label="Active users" value={overview.activeUsers} />
        <StatCard label="Total documents" value={overview.totalDocuments} />
        <StatCard label="AI questions asked" value={overview.aiQuestionsAsked} />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Documents by clearance</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {overview.documentsByClearance.map((row) => (
            <span
              key={row.clearanceLevel}
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              {roleByRank.get(row.clearanceLevel) ?? `Rank ${row.clearanceLevel}`}: {row._count._all}
            </span>
          ))}
          {overview.documentsByClearance.length === 0 && (
            <p className="text-sm text-zinc-400">No documents yet.</p>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent unanswered questions</h2>
          <Link href="/admin/audit-logs?action=CHAT_QUERY&noAnswer=1" className="text-xs font-medium text-brand-600 hover:underline">
            View all in Audit Log →
          </Link>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Questions the AI couldn&apos;t answer from any document your team is cleared to see — each one is a real content gap.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Asked by</th>
                <th className="px-3 py-2">Question</th>
              </tr>
            </thead>
            <tbody>
              {unanswered.map((entry) => (
                <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    <LocalTime iso={entry.createdAt.toISOString()} />
                  </td>
                  <td className="px-3 py-2">{entry.userName ?? '—'}</td>
                  <td className="px-3 py-2">{entry.question ?? '—'}</td>
                </tr>
              ))}
              {unanswered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-zinc-400">
                    No unanswered questions recorded — nice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent activity</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentActivity.map((entry) => (
                <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-500">
                    <LocalTime iso={entry.createdAt.toISOString()} />
                  </td>
                  <td className="px-3 py-2">{entry.user?.name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.action}</td>
                  <td className="px-3 py-2">
                    <ResultBadge result={entry.result} />
                  </td>
                </tr>
              ))}
              {overview.recentActivity.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-zinc-400">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const styles: Record<string, string> = {
    SUCCESS: 'bg-emerald-100 text-emerald-700',
    DENIED: 'bg-red-100 text-red-700',
    ERROR: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[result] ?? 'bg-zinc-100 text-zinc-600'}`}>
      {result}
    </span>
  );
}
