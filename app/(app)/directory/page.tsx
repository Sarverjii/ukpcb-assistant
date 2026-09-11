import { getAuthContext } from '@/lib/auth/session';
import { listDirectoryEntries } from '@/lib/db/queries/users';
import { listDepartmentsWithStats } from '@/lib/db/queries/departments';
import { UkpcbDirectory } from '@/components/directory/UkpcbDirectory';

// Every authenticated active employee can browse this — same gating as
// the Document Library (/documents): no canUploadDocuments/isAdmin check,
// just getAuthContext(). Directory data itself is already the narrowest
// possible shape (see listDirectoryEntries) so there's nothing here that
// needs a higher bar than "is a real, active employee."
export default async function DirectoryPage() {
  const ctx = await getAuthContext();
  const [entries, departments] = await Promise.all([listDirectoryEntries(), listDepartmentsWithStats()]);

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">UKPCB Directory</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Find anyone at UKPCB by name, email, or department — {entries.length} people.
      </p>
      <div className="mt-6">
        <UkpcbDirectory
          people={entries.map((e) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            roleName: e.role.name,
            departments: e.departments,
          }))}
          departmentHeads={Object.fromEntries(
            departments.filter((d) => d.head).map((d) => [d.name, d.head!.name]),
          )}
          viewerId={ctx.userId}
        />
      </div>
    </main>
  );
}
