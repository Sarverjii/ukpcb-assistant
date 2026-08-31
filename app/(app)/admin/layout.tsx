import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuthContext } from '@/lib/auth/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Server-side gate — this is what actually enforces admin-only access;
  // the nav link in (app)/layout.tsx being hidden for non-admins is just UX.
  if (!ctx.isAdmin) redirect('/chat');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Admin dashboard</h1>
      {/* Scrolls horizontally rather than wrapping — 5 tabs' worth of
          padded labels don't fit a phone-width screen, and wrapping to a
          second row would shove page content down inconsistently between
          tabs. whitespace-nowrap keeps each tab from breaking mid-label. */}
      <nav className="mt-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-zinc-200 dark:border-zinc-800">
        <AdminTab href="/admin" label="Overview" />
        <AdminTab href="/admin/employees" label="Employees" />
        <AdminTab href="/admin/documents" label="Documents" />
        <AdminTab href="/admin/hierarchy" label="Hierarchy" />
        <AdminTab href="/admin/audit-logs" label="Audit Log" />
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-brand-600 border-b-2 border-transparent hover:border-brand-600"
    >
      {label}
    </Link>
  );
}
