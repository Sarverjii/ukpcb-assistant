import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { AdminNav } from '@/components/admin/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // Server-side gate — this is what actually enforces admin-only access;
  // the nav link in (app)/layout.tsx being hidden for non-admins is just UX.
  if (!ctx.isAdmin) redirect('/chat');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Admin dashboard</h1>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
