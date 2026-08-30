import { getAuthContext } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm';

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  // department isn't on AuthContext (nothing authorization-relevant reads
  // it — see prisma/schema.prisma's note that it's an unused extension
  // point for future dept-scoped ACLs), so it's fetched directly here just
  // to display it.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { department: true },
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Settings</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Profile</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Managed by your organization&apos;s admin — contact them to change your name, role, or department.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 text-sm sm:grid-cols-2">
          <Field label="Name" value={ctx.name} />
          <Field label="Email" value={ctx.email} />
          <Field label="Role" value={ctx.roleName} />
          <Field label="Department" value={user.department ?? '—'} />
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Appearance</h2>
        <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <ThemeToggle initialTheme={ctx.themePreference} />
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
