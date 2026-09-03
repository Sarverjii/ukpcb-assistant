'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  changeEmployeeRoleAction,
  changeEmployeeDepartmentsAction,
  toggleEmployeeStatusAction,
  resetEmployeePasswordAction,
  removeEmployeeAction,
} from '@/app/(app)/admin/employees/actions';
import { LocalTime } from '@/components/admin/LocalTime';
import { ReauthDialog } from '@/components/admin/ReauthDialog';
import { EmailPreviewModal } from '@/components/admin/EmailPreviewModal';
import { DepartmentPicker, type PickableDepartment } from '@/components/shared/DepartmentPicker';
import type { ComposedEmail } from '@/lib/employees/emailCompose';

// listUsersWithRole (the sole source of this table's rows) excludes REMOVED
// employees entirely, but the underlying column type is the full UserStatus
// enum — kept honest here rather than narrowed, since a REMOVED row reaching
// this component by mistake should be a visible type/runtime surprise, not
// silently coerced away.
type User = {
  id: string;
  name: string;
  email: string;
  departments: PickableDepartment[];
  roleId: string;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED' | 'REMOVED';
  lastLoginAt: string | null;
};
type Role = { id: string; name: string };

export function EmployeesTable({
  users,
  roles,
  departments,
  currentUserId,
}: {
  users: User[];
  roles: Role[];
  departments: PickableDepartment[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Client-side filtering: the whole roster (a few dozen rows at most) is
  // already fetched for this page, and every deployed environment here pays
  // a real cross-region round trip per DB query (see vercel.json's region
  // pin) — adding a server round trip just to filter an already-in-memory
  // list would make the exact lag this table is meant to help with worse,
  // not better.
  const q = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (roleFilter !== 'ALL' && u.roleId !== roleFilter) return false;
    if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
    if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All roles</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <span className="text-xs text-zinc-400">
          {filtered.length} of {users.length}
        </span>
      </div>

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
            {filtered.map((u) => (
              <EmployeeRow
                key={u.id}
                user={u}
                roles={roles}
                departments={departments}
                isSelf={u.id === currentUserId}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-zinc-400">
                  No employees match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ReauthAction = 'toggleStatus' | 'resetPassword' | 'remove';

function EmployeeRow({
  user,
  roles,
  departments,
  isSelf,
}: {
  user: User;
  roles: Role[];
  departments: PickableDepartment[];
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reauthAction, setReauthAction] = useState<ReauthAction | null>(null);
  const [previewEmail, setPreviewEmail] = useState<ComposedEmail | null>(null);
  const [departmentIds, setDepartmentIds] = useState(user.departments.map((d) => d.id));

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const roleId = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeRoleAction(user.id, roleId);
      if (result.error) setError(result.error);
    });
  }

  function handleDepartmentsChange(ids: string[]) {
    setDepartmentIds(ids);
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeDepartmentsAction(user.id, ids);
      if (result.error) setError(result.error);
    });
  }

  async function confirmToggleStatus(password: string) {
    const result = await toggleEmployeeStatusAction(user.id, password);
    if (!result.error && result.email) setPreviewEmail(result.email);
    return result;
  }

  async function confirmResetPassword(password: string) {
    const result = await resetEmployeePasswordAction(user.id, password);
    if (!result.error && result.email) setPreviewEmail(result.email);
    return result;
  }

  async function confirmRemove(password: string) {
    return removeEmployeeAction(user.id, password);
  }

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800 align-top">
      <td className="px-3 py-2">{user.name}</td>
      <td className="px-3 py-2">{user.email}</td>
      <td className="px-3 py-2 min-w-[10rem]">
        <DepartmentPicker
          departments={departments}
          selectedIds={departmentIds}
          onChange={handleDepartmentsChange}
          disabled={pending}
          placeholder="—"
        />
      </td>
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
        {user.lastLoginAt ? <LocalTime iso={user.lastLoginAt} /> : 'Never'}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/employees/${user.id}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            View conversations
          </Link>
          <button
            type="button"
            disabled={isSelf || pending}
            onClick={() => setReauthAction('toggleStatus')}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setReauthAction('resetPassword')}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Reset password
          </button>
          <button
            type="button"
            disabled={isSelf || pending}
            onClick={() => setReauthAction('remove')}
            className="rounded-md border border-red-300 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>

      {reauthAction === 'toggleStatus' && (
        <ReauthDialog
          title={user.status === 'ACTIVE' ? `Disable ${user.name}` : `Enable ${user.name}`}
          description={
            user.status === 'ACTIVE'
              ? 'They will immediately be signed out and unable to log in.'
              : 'They will be able to log in again immediately.'
          }
          confirmLabel={user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          destructive={user.status === 'ACTIVE'}
          onConfirm={confirmToggleStatus}
          onClose={() => setReauthAction(null)}
        />
      )}
      {reauthAction === 'resetPassword' && (
        <ReauthDialog
          title={`Reset password for ${user.name}`}
          description="A new temporary password will be generated immediately."
          confirmLabel="Reset password"
          onConfirm={confirmResetPassword}
          onClose={() => setReauthAction(null)}
        />
      )}
      {reauthAction === 'remove' && (
        <ReauthDialog
          title={`Remove ${user.name}`}
          description="Blocks their login and moves them to Removed employees, where you can review any documents they uploaded before permanently deleting the account. This does not delete anything yet."
          confirmLabel="Remove"
          destructive
          onConfirm={confirmRemove}
          onClose={() => setReauthAction(null)}
        />
      )}
      {previewEmail && <EmailPreviewModal email={previewEmail} onClose={() => setPreviewEmail(null)} />}
    </tr>
  );
}
