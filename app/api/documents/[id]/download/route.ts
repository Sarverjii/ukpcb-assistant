import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { getDocument } from '@/lib/db/queries/documents';
import { getStorageProvider } from '@/lib/documents/storage';

// Admin-only (matches the admin Documents table's "Download" action in the
// spec). Deliberately not "any user cleared for this document" — this MVP
// hasn't built that broader download surface, and gating strictly to admins
// is the safer default per the spec's IDOR/unauthorized-download warning
// (§24) until that's designed properly.
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/documents/[id]/download'>,
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
  const document = await getDocument(id);
  const storage = getStorageProvider();
  const buffer = await storage.read(document.fileKey);

  await logAuditEvent({
    action: 'DOCUMENT_DOWNLOADED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: id,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.name)}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
