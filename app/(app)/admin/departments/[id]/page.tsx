import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDepartmentWithMembers } from '@/lib/db/queries/departments';
import { listUsersWithRole, listRolesByRank } from '@/lib/db/queries/users';
import { listDocumentsForDepartment } from '@/lib/db/queries/documents';
import { DepartmentDetailHeader } from '@/components/admin/DepartmentDetailHeader';
import { DepartmentMembers } from '@/components/admin/DepartmentMembers';
import { DepartmentDocuments } from '@/components/admin/DepartmentDocuments';

export default async function DepartmentDetailPage({
  params,
}: PageProps<'/admin/departments/[id]'>) {
  const { id } = await params;
  const [dept, allUsers, roles, documents] = await Promise.all([
    getDepartmentWithMembers(id).catch(() => null),
    listUsersWithRole(),
    listRolesByRank(),
    listDocumentsForDepartment(id),
  ]);
  if (!dept) notFound();

  const memberIds = new Set(dept.users.map((u) => u.id));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/departments" className="text-xs font-medium text-brand-600 hover:underline">
        ← Departments
      </Link>

      <DepartmentDetailHeader
        departmentId={dept.id}
        name={dept.name}
        description={dept.description}
        headUserId={dept.headUserId}
        members={dept.users.map((u) => ({ id: u.id, name: u.name }))}
      />

      <DepartmentDocuments
        documents={documents}
        roles={roles.map((r) => ({ hierarchyRank: r.hierarchyRank, name: r.name }))}
      />

      <DepartmentMembers
        departmentId={dept.id}
        members={dept.users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleName: u.role.name }))}
        nonMembers={nonMembers.map((u) => ({ id: u.id, name: u.name, email: u.email, roleName: u.role.name }))}
      />
    </div>
  );
}
