import { listDepartmentsWithStats } from '@/lib/db/queries/departments';
import { listUsersWithoutDepartment } from '@/lib/db/queries/users';
import { DepartmentGrid } from '@/components/admin/DepartmentGrid';

export default async function DepartmentsPage() {
  const [departments, noDepartmentUsers] = await Promise.all([
    listDepartmentsWithStats(),
    listUsersWithoutDepartment(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Clearance and department work together, not as alternatives: a document tagged with a
        department is visible only to someone whose clearance already covers it <em>and</em> who
        belongs to that department (or has head-department access) — department membership never
        substitutes for missing clearance, it only narrows what clearance already admits. A
        document with no department at all is governed by clearance alone. Every employee must
        belong to at least one department. Open a department to edit its description, set a head,
        mark it a head department, manage members, and see what it grants access to.
      </p>
      <DepartmentGrid
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          head: d.head,
          isHeadDepartment: d.isHeadDepartment,
          dailyMessageLimit: d.dailyMessageLimit,
          memberCount: d._count.users,
          documentCount: d._count.documents,
        }))}
        noDepartmentCount={noDepartmentUsers.length}
      />
    </div>
  );
}
