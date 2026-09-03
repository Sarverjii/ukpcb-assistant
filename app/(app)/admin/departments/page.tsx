import { listDepartments } from '@/lib/db/queries/departments';
import { DepartmentManager } from '@/components/admin/DepartmentManager';

export default async function DepartmentsPage() {
  const departments = await listDepartments();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Departments are purely additive to the clearance hierarchy — a document tagged with a
        department is visible to everyone in it, regardless of their own clearance, on top of
        whoever the clearance level already covers. An employee can belong to any number of
        departments. Click a department to manage its members.
      </p>
      <DepartmentManager departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
    </div>
  );
}
