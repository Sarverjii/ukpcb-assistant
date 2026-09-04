import { getTodayUsageSnapshot } from '@/lib/db/queries/usage';
import { UsageLimitsManager } from '@/components/admin/UsageLimitsManager';

export default async function UsageLimitsPage() {
  const snapshot = await getTodayUsageSnapshot();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Three levels of chat-message quota, always all enforced together — per employee (set the
        default in Hierarchy, override individuals in Employees), optionally per department (set in
        Departments), and this company-wide ceiling. A blocked message costs nothing: every limit is
        checked before the AI is ever called, so there is no way to run up a bill past what these
        numbers allow.
      </p>
      <UsageLimitsManager
        org={snapshot.org}
        users={snapshot.users.map((u) => ({
          id: u.id,
          label: u.name,
          sublabel: u.email,
          used: u.used,
          limit: u.limit,
        }))}
        departments={snapshot.departments.map((d) => ({ id: d.id, label: d.name, used: d.used, limit: d.limit }))}
      />
    </div>
  );
}
