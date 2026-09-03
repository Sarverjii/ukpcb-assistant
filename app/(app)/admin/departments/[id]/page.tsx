import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDepartmentWithMembers } from '@/lib/db/queries/departments';
import { listUsersWithRole } from '@/lib/db/queries/users';
import { DepartmentMembers } from '@/components/admin/DepartmentMembers';

export default async function DepartmentDetailPage({
  params,
}: PageProps<'/admin/departments/[id]'>) {
  const { id } = await params;
  const [dept, allUsers] = await Promise.all([
    getDepartmentWithMembers(id).catch(() => null),
    listUsersWithRole(),
  ]);
  if (!dept) notFound();

  const memberIds = new Set(dept.users.map((u) => u.id));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/departments" className="text-xs font-medium text-brand-600 hover:underline">
          ← Departments
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{dept.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {dept.users.length} member{dept.users.length === 1 ? '' : 's'} — visible to everyone here on
          any document tagged with this department, regardless of their own clearance.
        </p>
      </div>

      <DepartmentMembers
        departmentId={dept.id}
        members={dept.users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleName: u.role.name }))}
        nonMembers={nonMembers.map((u) => ({ id: u.id, name: u.name, email: u.email, roleName: u.role.name }))}
      />
    </div>
  );
}
