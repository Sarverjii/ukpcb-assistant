'use client';

import { useState, useTransition } from 'react';
import {
  changeEmployeeRoleAction,
  toggleEmployeeStatusAction,
  resetEmployeePasswordAction,
} from '@/app/(app)/admin/employees/actions';

type User = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  roleId: string;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
};
type Role = { id: string; name: string };

export function EmployeesTable({
  users,
  roles,
  currentUserId,
}: {
  users: User[];
  roles: Role[];
  currentUserId: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Department</th>
            <th className="px-3 py-2">Role / Clearance</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Last login</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <EmployeeRow key={u.id} user={u} roles={roles} isSelf={u.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeRow({ user, roles, isSelf }: { user: User; roles: Role[]; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const roleId = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeRoleAction(user.id, roleId);
      if (result.error) setError(result.error);
    });
  }

  function handleToggleStatus() {
    setError(null);
    startTransition(async () => {
      const result = await toggleEmployeeStatusAction(user.id);
      if (result.error) setError(result.error);
    });
  }

  function handleResetPassword() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await resetEmployeePasswordAction(user.id);
      if (result.error) setError(result.error);
      else setMessage(`New temporary password: ${result.tempPassword}`);
    });
  }

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800 align-top">
      <td className="px-3 py-2">{user.name}</td>
      <td className="px-3 py-2">{user.email}</td>
      <td className="px-3 py-2">{user.department ?? '—'}</td>
      <td className="px-3 py-2">
        <select
          defaultValue={user.roleId}
          disabled={isSelf || pending}
          onChange={handleRoleChange}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs disabled:opacity-50"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <span
          className={
            user.status === 'ACTIVE'
              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
              : 'rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600'
          }
        >
          {user.status}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSelf || pending}
            onClick={handleToggleStatus}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleResetPassword}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Reset password
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {message && <p className="mt-1 text-xs text-emerald-700 font-mono">{message}</p>}
      </td>
    </tr>
  );
}
