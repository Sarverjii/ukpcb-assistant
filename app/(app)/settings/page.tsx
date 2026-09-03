import { getAuthContext } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { listSessionsForUser } from '@/lib/db/queries/loginSessions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm';
import { SessionsList } from '@/components/settings/SessionsList';

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  // ctx.departmentIds only carries ids (all that authorization needs) —
  // department NAMES are fetched directly here just to display them.
  // Departments now genuinely affect what this user can see (the
  // clearance-OR-department document-visibility rule — see
  // lib/db/queries/chunks.ts), unlike the free-text field this replaced,
  // which was purely cosmetic.
  const [user, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { departments: { select: { name: true } } } }),
    listSessionsForUser(ctx.userId),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Settings</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Profile</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Managed by your organization&apos;s admin — contact them to change your name, role, or department.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 text-sm sm:grid-cols-2">
          <Field label="Name" value={ctx.name} />
          <Field label="Email" value={ctx.email} />
          <Field label="Role" value={ctx.roleName} />
          <Field
            label="Departments"
            value={user.departments.length > 0 ? user.departments.map((d) => d.name).join(', ') : '—'}
          />
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Appearance</h2>
        <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <ThemeToggle initialTheme={ctx.themePreference} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Active sessions</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Everywhere you&apos;re currently signed in. Sign out of anything you don&apos;t recognize.
        </p>
        <div className="mt-4">
          <SessionsList
            sessions={sessions.map((s) => ({
              id: s.id,
              userAgent: s.userAgent,
              ipAddress: s.ipAddress,
              createdAt: s.createdAt.toISOString(),
              lastSeenAt: s.lastSeenAt.toISOString(),
            }))}
            currentSessionId={ctx.loginSessionId}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Password</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Choose a new password. You&apos;ll need your current one.
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-white">{value}</dd>
    </div>
  );
}
