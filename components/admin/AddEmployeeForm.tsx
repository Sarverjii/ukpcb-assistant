'use client';

import { useState, useRef, useTransition } from 'react';
import { createEmployeeAction } from '@/app/(app)/admin/employees/actions';
import { EmailPreviewModal } from '@/components/admin/EmailPreviewModal';
import { DepartmentPicker, type PickableDepartment } from '@/components/shared/DepartmentPicker';
import { SingleSelect } from '@/components/shared/SingleSelect';
import type { ComposedEmail } from '@/lib/employees/emailCompose';

type Role = { id: string; name: string; hierarchyRank: number };

export function AddEmployeeForm({ roles, departments }: { roles: Role[]; departments: PickableDepartment[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEmail, setPreviewEmail] = useState<ComposedEmail | null>(null);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [roleId, setRoleId] = useState('');
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!roleId) {
      setError('Select a role.');
      return;
    }
    const formData = new FormData(e.currentTarget);
    // Neither DepartmentPicker nor SingleSelect (roleId, just below) is a
    // native form element — their selections are appended manually rather
    // than relying on FormData's automatic collection of named inputs.
    formData.set('roleId', roleId);
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
      setRoleId('');
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
          <SingleSelect
            value={roleId}
            onChange={setRoleId}
            options={[{ value: '', label: 'Select a role…' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
            triggerClassName="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
          <DepartmentPicker
            departments={departments}
            selectedIds={departmentIds}
            onChange={setDepartmentIds}
            placeholder="Select department(s)…"
          />

          <div className="col-span-1 flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={pending || departmentIds.length === 0}
              title={departmentIds.length === 0 ? 'Select at least one department first' : undefined}
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
