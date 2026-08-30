'use client';

import { useState, useRef, useTransition } from 'react';
import { createEmployeeAction } from '@/app/(app)/admin/employees/actions';

type Role = { id: string; name: string; hierarchyRank: number };

export function AddEmployeeForm({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTempPassword(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createEmployeeAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTempPassword(result.tempPassword ?? null);
      formRef.current?.reset();
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
        <form ref={formRef} onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
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
          <input
            name="department"
            placeholder="Department (optional)"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />

          <div className="col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
            >
              Create employee
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          {tempPassword && (
            <p className="col-span-2 rounded-md bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              Employee created. Temporary password (share this with them out of band — it won&apos;t be
              shown again): <code className="font-mono">{tempPassword}</code>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
