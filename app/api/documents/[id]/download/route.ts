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
  let buffer: Buffer;
  try {
    buffer = await storage.read(document.fileKey);
  } catch (err) {
    // On the local-disk storage provider specifically, a file can go
    // missing if the server process has restarted since it was uploaded —
    // local disk isn't guaranteed to survive a restart. Confirmed directly
    // in production (Render's free tier restarted under memory pressure,
    // and the next download attempt hit exactly this). The chunk content
    // and embeddings are unaffected (they live in Postgres), so this is a
    // "the original file isn't available for download" case, not data
    // loss for chat/retrieval — worth a clean 404 instead of an unhandled
    // crash either way.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json(
        { error: 'The original file is no longer available on this server (it may have restarted since upload). Chat answers sourced from this document are unaffected.' },
        { status: 404 },
      );
    }
    throw err;
  }

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
