'use client';

import { useState, useTransition } from 'react';
import { changeEmployeeDepartmentsAction } from '@/app/(app)/admin/employees/actions';
import { DepartmentPicker, type PickableDepartment } from '@/components/shared/DepartmentPicker';

type Employee = { id: string; name: string; email: string; roleName: string };

/**
 * A quick-assign worklist, not a read-only list — each row gets its own
 * DepartmentPicker so an admin can fix "no department" right here, one
 * click, without a trip through the full Employees table. A row
 * disappears from THIS list once it's saved (optimistic — the employee no
 * longer has zero departments), even though the page won't actually
 * refetch until next navigation; that's the expected, useful behavior for
 * a worklist.
 */
export function NoDepartmentEmployees({
  users,
  departments,
}: {
  users: Employee[];
  departments: PickableDepartment[];
}) {
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function assign(userId: string, departmentIds: string[]) {
    if (departmentIds.length === 0) return;
    setPendingId(userId);
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeDepartmentsAction(userId, departmentIds);
      if (result.error) setError(result.error);
      else setAssigned((prev) => new Set(prev).add(userId));
      setPendingId(null);
    });
  }

  const remaining = users.filter((u) => !assigned.has(u.id));

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Assign department</th>
            </tr>
          </thead>
          <tbody>
            {remaining.map((u) => (
              <tr key={u.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2 text-zinc-500">{u.roleName}</td>
                <td className="px-3 py-2 min-w-[10rem]">
                  <DepartmentPicker
                    departments={departments}
                    selectedIds={[]}
                    onChange={(ids) => assign(u.id, ids)}
                    disabled={pendingId === u.id}
                    placeholder="Assign…"
                  />
                </td>
              </tr>
            ))}
            {remaining.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  Everyone has at least one department.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
