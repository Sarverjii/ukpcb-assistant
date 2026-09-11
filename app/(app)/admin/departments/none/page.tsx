import Link from 'next/link';
import { listUsersWithoutDepartment } from '@/lib/db/queries/users';
import { listDepartments } from '@/lib/db/queries/departments';
import { NoDepartmentEmployees } from '@/components/admin/NoDepartmentEmployees';

// Not a real Department (no id, no detail page of its own) — just a
// worklist for fixing a policy violation, linked from the dashed "No
// department" card on the main grid. Every employee is now required to
// belong to at least one department (see lib/db/queries/departments.ts's
// requireNonEmptyDepartments), so anyone showing up here predates that
// policy — it's not reachable for anyone created since. Lets an admin
// assign someone a department right from this list instead of hunting
// for them in the full Employees table.
export default async function NoDepartmentPage() {
  const [users, departments] = await Promise.all([listUsersWithoutDepartment(), listDepartments()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/departments" className="text-xs font-medium text-brand-600 hover:underline">
          ← Departments
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">No department</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {users.length} employee{users.length === 1 ? '' : 's'} not currently in any department.
          Every employee must belong to at least one — assign one below to fix each.
        </p>
      </div>

      <NoDepartmentEmployees
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleName: u.role.name }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />
    </div>
  );
}
