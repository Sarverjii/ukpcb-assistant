import { listDepartmentsWithStats } from '@/lib/db/queries/departments';
import { DepartmentGrid } from '@/components/admin/DepartmentGrid';

export default async function DepartmentsPage() {
  const departments = await listDepartmentsWithStats();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Departments are purely additive to the clearance hierarchy — a document tagged with a
        department is visible to everyone in it, regardless of their own clearance, on top of
        whoever the clearance level already covers. An employee can belong to any number of
        departments. Open a department to edit its description, set a head, manage members, and see
        what it grants access to.
      </p>
      <DepartmentGrid
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          head: d.head,
          memberCount: d._count.users,
          documentCount: d._count.documents,
        }))}
      />
    </div>
  );
}
