import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { config } from '@/lib/config';
import { UploadForm } from '@/components/documents/UploadForm';

export default async function DocumentUploadPage() {
  const ctx = await getAuthContext();
  if (!ctx.canUploadDocuments) redirect('/chat');

  // Clearance options are pulled from the Role table (data-driven, ordered
  // by hierarchyRank) rather than a hardcoded enum, so a new role shows up
  // here automatically.
  const roles = await prisma.role.findMany({
    orderBy: { hierarchyRank: 'desc' },
    select: { name: true, hierarchyRank: true },
  });
  // An uploader can only classify documents at or below their own
  // clearance — see the matching check in app/api/documents/upload/route.ts.
  const availableRoles = roles.filter((r) => r.hierarchyRank <= ctx.clearanceRank);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Upload documents</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Every document must be assigned a clearance level. Only employees at that level or above
        will ever see it — including in AI answers. Select or drop multiple files to bulk-upload
        them all to one clearance level at once.
      </p>
      <div className="mt-6">
        <UploadForm
          roles={availableRoles}
          useClientUpload={config.STORAGE_PROVIDER === 'vercel-blob'}
          uploadMaxMb={config.UPLOAD_MAX_MB}
        />
      </div>
    </main>
  );
}
