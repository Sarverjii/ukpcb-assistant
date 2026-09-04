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
    // Was max-w-6xl (1152px) — real reported issue: every admin table
    // (Employees especially, with 7 columns including a name+email
    // identity cell, a department picker, and a role select) needed more
    // room than that left after the page's own side padding, forcing an
    // internal horizontal scroll that hid the Actions column by default
    // on an ordinary laptop-width window, while leaving visibly empty
    // gutters on anything wider. max-w-[100rem] (1600px) is generous
    // enough that these tables lay out comfortably without scrolling on
    // a normal wide monitor, while still capping line length on an
    // ultrawide display rather than going edge-to-edge unbounded.
    <div className="mx-auto max-w-[100rem] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Admin dashboard</h1>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
