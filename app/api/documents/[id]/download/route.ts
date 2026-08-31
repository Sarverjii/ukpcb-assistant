import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanManageDocument, ForbiddenError } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { getDocument } from '@/lib/db/queries/documents';
import { getStorageProvider } from '@/lib/documents/storage';

// Gated the same way the knowledge base's other management actions are
// (requireCanManageDocument: an admin, or a canUploadDocuments user whose
// own clearance covers this specific document) — not admin-only anymore,
// since the knowledge base itself is now reachable by any non-admin
// document manager (see app/(app)/knowledge-base). Forces a real download
// (Content-Disposition: attachment), unlike [id]/view's inline display.
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/documents/[id]/download'>,
) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    throw err;
  }

  const { id } = await params;
  const document = await getDocument(id);

  try {
    await requireCanManageDocument(ctx, document.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const storage = getStorageProvider();
  let buffer: Buffer;
  try {
    buffer = await storage.read(document.fileKey);
  } catch (err) {
    // On the local-disk storage provider specifically, a file can go
    // missing if the server process has restarted since it was uploaded —
    // local disk isn't guaranteed to survive a restart. Confirmed directly
    // in production: a host restarted under memory pressure, and the next
    // download attempt hit exactly this. The chunk content and embeddings
    // are unaffected (they live in Postgres), so this is a "the original
    // file isn't available for download" case, not data loss for
    // chat/retrieval — worth a clean 404 instead of an unhandled crash
    // either way.
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
    metadata: { documentName: document.name },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.name)}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
