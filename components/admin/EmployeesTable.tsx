'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  changeEmployeeRoleAction,
  changeEmployeeDepartmentsAction,
  changeEmployeeMessageLimitAction,
  toggleEmployeeStatusAction,
  resetEmployeePasswordAction,
  removeEmployeeAction,
} from '@/app/(app)/admin/employees/actions';
import { LocalTime } from '@/components/admin/LocalTime';
import { ReauthDialog } from '@/components/admin/ReauthDialog';
import { EmailPreviewModal } from '@/components/admin/EmailPreviewModal';
import { DepartmentPicker, type PickableDepartment } from '@/components/shared/DepartmentPicker';
import { Avatar } from '@/components/shared/Avatar';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
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
  // See User.dailyMessageLimitOverride's own schema comment — null means
  // this employee inherits their role's defaultDailyMessageLimit.
  dailyMessageLimitOverride: number | null;
};
type Role = { id: string; name: string; defaultDailyMessageLimit: number };

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
  const activeCount = users.filter((u) => u.status === 'ACTIVE').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          <span className="font-semibold text-zinc-900 dark:text-white">{users.length}</span> employee
          {users.length === 1 ? '' : 's'}
        </span>
        <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden />
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {activeCount} active
        </span>
        {users.length - activeCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            {users.length - activeCount} disabled
          </span>
        )}
      </div>

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
        <span className="ml-auto text-xs text-zinc-400">
          {filtered.length} of {users.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Role / Clearance</th>
              <th className="px-4 py-3 font-medium">Msg limit/day</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last login</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
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
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reauthAction, setReauthAction] = useState<ReauthAction | null>(null);
  const [previewEmail, setPreviewEmail] = useState<ComposedEmail | null>(null);
  const [departmentIds, setDepartmentIds] = useState(user.departments.map((d) => d.id));
  const [limitInput, setLimitInput] = useState(
    user.dailyMessageLimitOverride === null ? '' : String(user.dailyMessageLimitOverride),
  );
  const roleDefault = roles.find((r) => r.id === user.roleId)?.defaultDailyMessageLimit ?? null;

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const roleId = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeRoleAction(user.id, roleId);
      if (result.error) setError(result.error);
    });
  }

  function handleDepartmentsChange(ids: string[]) {
    const previous = departmentIds;
    setDepartmentIds(ids);
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeDepartmentsAction(user.id, ids);
      if (result.error) {
        setError(result.error);
        // Revert the optimistic update — e.g. "Clear all" down to zero
        // departments is rejected server-side (every employee must keep
        // at least one), and without this the picker would keep showing
        // "—" (no departments) even though the real DB row still has its
        // old ones, staying wrong until the next full page load.
        setDepartmentIds(previous);
      }
    });
  }

  function saveLimitOverride() {
    const trimmed = limitInput.trim();
    if (trimmed && (!Number.isInteger(Number(trimmed)) || Number(trimmed) < 1)) {
      setError('Daily message limit must be a positive whole number, or blank to inherit the role default.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await changeEmployeeMessageLimitAction(user.id, trimmed ? Number(trimmed) : null);
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
    <tr className="border-t border-zinc-100 dark:border-zinc-800 align-top hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900 dark:text-white">{user.name}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 w-40">
        <DepartmentPicker
          departments={departments}
          selectedIds={departmentIds}
          onChange={handleDepartmentsChange}
          disabled={pending}
          placeholder="—"
        />
      </td>
      <td className="px-4 py-3">
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
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          value={limitInput}
          onChange={(e) => setLimitInput(e.target.value)}
          onBlur={saveLimitOverride}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          disabled={pending}
          placeholder={roleDefault !== null ? `${roleDefault} (default)` : '—'}
          title="Leave blank to use the role's default daily message limit"
          className="w-28 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-3">
        <span
          className={
            user.status === 'ACTIVE'
              ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300'
              : 'inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-400'
          }
        >
          {user.status === 'ACTIVE' ? 'Active' : 'Disabled'}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-zinc-500">
        {user.lastLoginAt ? <LocalTime iso={user.lastLoginAt} /> : 'Never'}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <RowActionsMenu
            actions={[
              { label: 'View conversations', onClick: () => router.push(`/admin/employees/${user.id}`) },
              {
                label: user.status === 'ACTIVE' ? 'Disable' : 'Enable',
                onClick: () => setReauthAction('toggleStatus'),
                disabled: isSelf || pending,
              },
              { label: 'Reset password', onClick: () => setReauthAction('resetPassword'), disabled: pending },
              {
                label: 'Remove',
                onClick: () => setReauthAction('remove'),
                disabled: isSelf || pending,
                danger: true,
              },
            ]}
          />
        </div>
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

type ReauthAction = 'toggleStatus' | 'resetPassword' | 'remove';
