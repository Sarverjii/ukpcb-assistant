'use client';

import { useState, useRef, useTransition } from 'react';
import { createEmployeeAction } from '@/app/(app)/admin/employees/actions';
import { EmailPreviewModal } from '@/components/admin/EmailPreviewModal';
import { DepartmentPicker, type PickableDepartment } from '@/components/shared/DepartmentPicker';
import type { ComposedEmail } from '@/lib/employees/emailCompose';

type Role = { id: string; name: string; hierarchyRank: number };

export function AddEmployeeForm({ roles, departments }: { roles: Role[]; departments: PickableDepartment[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEmail, setPreviewEmail] = useState<ComposedEmail | null>(null);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    // DepartmentPicker isn't a native form element — its selection is
    // appended manually rather than relying on FormData's automatic
    // collection of named inputs.
    for (const id of departmentIds) formData.append('departmentIds', id);
    startTransition(async () => {
      const result = await createEmployeeAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.email) setPreviewEmail(result.email);
      formRef.current?.reset();
      setDepartmentIds([]);
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        {open ? '− Hide' : '+ Add employee'}
      </button>

      {open && (
        <form ref={formRef} onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            name="name"
            placeholder="Full name"
            required
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
          <select
            name="roleId"
            required
            defaultValue=""
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select a role…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <DepartmentPicker
            departments={departments}
            selectedIds={departmentIds}
            onChange={setDepartmentIds}
            placeholder="Departments (optional)"
          />

          <div className="col-span-1 flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
            >
              Create employee
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </form>
      )}

      {previewEmail && <EmailPreviewModal email={previewEmail} onClose={() => setPreviewEmail(null)} />}
    </div>
  );
}
