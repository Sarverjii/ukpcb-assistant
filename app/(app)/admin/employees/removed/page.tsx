import Link from 'next/link';
import { listRemovedUsersWithRole } from '@/lib/db/queries/users';
import { LocalTime } from '@/components/admin/LocalTime';

// Admin-only by inheritance — see app/(app)/admin/layout.tsx.
export default async function RemovedEmployeesPage() {
  const removed = await listRemovedUsersWithRole();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/employees" className="text-xs font-medium text-brand-600 hover:underline">
          ← Employees
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">Removed employees</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Login is blocked for everyone here. Open an employee to review any documents they uploaded
          before permanently deleting the account.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Last login</th>
            </tr>
          </thead>
          <tbody>
            {removed.map((u) => (
              <tr key={u.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link href={`/admin/employees/removed/${u.id}`} className="text-brand-600 hover:underline">
                    {u.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.role.name}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {u.lastLoginAt ? <LocalTime iso={u.lastLoginAt.toISOString()} /> : 'Never'}
                </td>
              </tr>
            ))}
            {removed.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  No removed employees.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
