import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { getImportBatchById } from '@/lib/db/queries/employeeImportBatches';
import { getStorageProvider } from '@/lib/documents/storage';

// Downloads a bulk-import batch's generated "failed rows + reasons" XLSX —
// see buildImportErrorReportXlsx. Same shape as the sibling file/ route.
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/admin/employee-imports/[id]/errors'>,
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

  if (!batch.errorReportFileKey) {
    return NextResponse.json({ error: 'This import had no failed rows.' }, { status: 404 });
  }

  const storage = getStorageProvider();
  let buffer: Buffer;
  try {
    buffer = await storage.read(batch.errorReportFileKey);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json(
        { error: 'The error report is no longer available on this server (it may have restarted since upload).' },
        { status: 404 },
      );
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(batch.fileName)}-errors.xlsx"`,
      'Content-Length': String(buffer.length),
    },
  });
}
