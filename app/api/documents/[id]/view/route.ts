import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/audit/log';
import { getDocument } from '@/lib/db/queries/documents';
import { getStorageProvider } from '@/lib/documents/storage';

/**
 * Serves a document's raw bytes for inline in-browser viewing — the
 * citation preview modal embeds a PDF here at `#page=N` so a citation
 * opens the actual source page, not just its extracted text. Deliberately
 * NOT the same route as [id]/download (admin-only, forces a download via
 * Content-Disposition: attachment): any user cleared for the document
 * needs to reach this one, since a citation can surface to any employee
 * whose clearance covers it, not just admins. Authorization here is the
 * same rule as chunk retrieval — EITHER the document is public (isPublic —
 * see its own schema.prisma comment: bypasses everything below, same as
 * every retrieval path), OR clearanceRank <= the document's level, AND
 * (the document has no department at all, OR the caller belongs to one of
 * its departments, OR the caller has head-department access), AND the
 * caller's single location is among the document's own locations — just
 * checked against the document directly rather than a chunk. Clearance and
 * location are both hard requirements; department only ever narrows,
 * never widens, who a clearance level already admits. This route and
 * every listing/retrieval path must always agree — a real reported bug
 * once had this route missing the department half entirely, and a second
 * one (found by actually clicking a public document's citation as a
 * logged-in employee, not anticipated) had it missing the isPublic bypass
 * entirely: a public document has empty departments/locations by design
 * (see Document.isPublic's comment), so `locationOk` below is
 * UNCONDITIONALLY false for one without this bypass — every employee,
 * admin included, got a bare 403 opening a citation chunk retrieval had
 * already deemed them authorized to see.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/documents/[id]/view'>) {
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
  let document;
  try {
    document = await getDocument(id);
  } catch {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const hasClearance = ctx.clearanceRank >= document.clearanceLevel;
  const departmentOk =
    document.departments.length === 0 ||
    document.departments.some((d) => ctx.departmentIds.includes(d.id)) ||
    ctx.hasHeadDepartmentAccess;
  const locationOk = document.locations.some((l) => l.id === ctx.locationId);
  if (!document.isPublic && (!hasClearance || !departmentOk || !locationOk)) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: id,
      metadata: { reason: 'view', userClearanceRank: ctx.clearanceRank, documentClearanceLevel: document.clearanceLevel },
    });
    return NextResponse.json({ error: 'Not authorized to view this document.' }, { status: 403 });
  }

  const storage = getStorageProvider();
  // Native PDFs are already the viewable file. Anything else serves its
  // generated preview rendition instead (see previewFileKey's schema doc
  // comment) — falling back to the original file itself only for a
  // document whose preview hasn't been generated (or failed to), in
  // which case this just streams the original in its native format, same
  // as before this feature existed; the citation modal already knows not
  // to attempt a paginated PDF render for that case (previewable: false).
  const usePreview = document.mimeType !== 'application/pdf' && document.previewFileKey;
  const servedMimeType = usePreview ? 'application/pdf' : document.mimeType;
  let buffer: Buffer;
  try {
    buffer = await storage.read(usePreview ? document.previewFileKey! : document.fileKey);
  } catch (err) {
    // See [id]/download/route.ts's matching comment — local-disk storage
    // can lose a file across a server restart; the chunk content/citation
    // text this route's caller already has is unaffected either way.
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
      'Content-Type': servedMimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.name)}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=0, must-revalidate',
      // This serves potentially sensitive, access-controlled documents
      // inline (unlike the admin-only download route) — explicitly refuse
      // to be framed by any other origin so a malicious page can't
      // clickjack a logged-in user into interacting with content it embeds.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}
