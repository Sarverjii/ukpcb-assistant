import Link from 'next/link';
import { getAuthContext } from '@/lib/auth/session';
import { listUsersWithRole, listRolesByRank } from '@/lib/db/queries/users';
import { listDepartments } from '@/lib/db/queries/departments';
import { listImportBatches } from '@/lib/db/queries/employeeImportBatches';
import { AddEmployeeForm } from '@/components/admin/AddEmployeeForm';
import { EmployeesTable } from '@/components/admin/EmployeesTable';
import { BulkImportEmployees } from '@/components/admin/BulkImportEmployees';

export default async function EmployeesPage() {
  const ctx = await getAuthContext();
  const [users, roles, departments, batches] = await Promise.all([
    listUsersWithRole(),
    listRolesByRank(),
    listDepartments(),
    listImportBatches(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">Employees</h1>
        <div className="flex items-center gap-4">
          <a href="/api/admin/employees/export" className="text-xs font-medium text-brand-600 hover:underline">
            Export roster (XLSX) →
          </a>
          <Link href="/admin/employees/removed" className="text-xs font-medium text-brand-600 hover:underline">
            Removed employees →
          </Link>
        </div>
      </div>
      <AddEmployeeForm roles={roles} departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
      <BulkImportEmployees
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        batches={batches.map((b) => ({
          id: b.id,
          fileName: b.fileName,
          uploadedByName: b.uploadedBy?.name ?? 'Removed employee',
          uploadedAt: b.uploadedAt.toISOString(),
          rowCount: b.rowCount,
          successCount: b.successCount,
          failureCount: b.failureCount,
          hasErrorReport: !!b.errorReportFileKey,
        }))}
      />
      <EmployeesTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          departments: u.departments.map((d) => ({ id: d.id, name: d.name })),
          roleId: u.roleId,
          roleName: u.role.name,
          status: u.status,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        }))}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
