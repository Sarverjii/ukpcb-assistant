import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { AdminNav } from '@/components/admin/AdminNav';
import { logAuditEvent } from '@/lib/audit/log';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Server-side gate — this is what actually enforces admin-only access;
  // the nav link in (app)/layout.tsx being hidden for non-admins is just UX.
  // describeAuditEvent already had a case for this exact resource value
  // ("Blocked: tried to open the admin dashboard without access") from
  // when the audit log was overhauled — this is the call that was
  // supposed to feed it, found missing while testing the RBAC boundary
  // directly: five non-admin roles hit this redirect and none left a
  // trace in the audit log at all.
  if (!ctx.isAdmin) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: 'admin',
    });
    redirect('/chat');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Admin dashboard</h1>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
