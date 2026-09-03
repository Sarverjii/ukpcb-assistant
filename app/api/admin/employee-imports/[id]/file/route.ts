import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { getImportBatchById } from '@/lib/db/queries/employeeImportBatches';
import { getStorageProvider } from '@/lib/documents/storage';

// Downloads a past bulk-import batch's ORIGINAL uploaded sheet — modeled
// directly on app/api/documents/[id]/download/route.ts (same auth shape,
// same ENOENT-as-404 handling for the local-disk storage provider). Admin-
// only, same as every other employees admin surface.
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/admin/employee-imports/[id]/file'>,
) {
  let ctx;
  try {
    ctx = await getAuthContext();
    await requireAdmin(ctx);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const { id } = await params;
  const batch = await getImportBatchById(id);

  const storage = getStorageProvider();
  let buffer: Buffer;
  try {
    buffer = await storage.read(batch.fileKey);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json(
        { error: 'The original file is no longer available on this server (it may have restarted since upload).' },
        { status: 404 },
      );
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(batch.fileName)}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
