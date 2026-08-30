import { getAuthContext } from '@/lib/auth/session';
import { listUsersWithRole, listRolesByRank } from '@/lib/db/queries/users';
import { AddEmployeeForm } from '@/components/admin/AddEmployeeForm';
import { EmployeesTable } from '@/components/admin/EmployeesTable';

export default async function EmployeesPage() {
  const ctx = await getAuthContext();
  const [users, roles] = await Promise.all([listUsersWithRole(), listRolesByRank()]);

  return (
    <div className="flex flex-col gap-6">
      <AddEmployeeForm roles={roles} />
      <EmployeesTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          department: u.department,
          roleId: u.roleId,
          roleName: u.role.name,
          status: u.status,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        }))}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
