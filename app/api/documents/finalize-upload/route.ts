import { NextResponse, after } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanUploadDocuments, ForbiddenError } from '@/lib/auth/rbac';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { createDocument } from '@/lib/db/queries/documents';
import { processDocument } from '@/lib/documents/pipeline';
import { logAuditEvent } from '@/lib/audit/log';

// See app/api/documents/blob-upload-token/route.ts's doc comment for the
// full picture. This is step two: the browser has already uploaded the
// file directly to Vercel Blob by this point (bytes never touched this
// app's server) — this route only receives small JSON metadata (a
// pathname, not a file) to create the Document row and kick off
// processing, exactly like the old single-request route did after its own
// (now-bypassed) storage.save() call.
export const maxDuration = 60;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getAuthContext();
    await requireCanUploadDocuments(ctx);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const body = await request.json().catch(() => null);
  const pathname = typeof body?.pathname === 'string' ? body.pathname : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : '';
  const fileSizeBytes = Number(body?.fileSizeBytes);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() || undefined : undefined;
  const clearanceLevel = Number(body?.clearanceLevel);
  const department = typeof body?.department === 'string' ? body.department.trim() || undefined : undefined;
  const tags: string[] = Array.isArray(body?.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : [];

  if (!pathname || !name) {
    return NextResponse.json({ error: 'Missing document or file.' }, { status: 400 });
  }
  if (!Number.isFinite(clearanceLevel)) {
    return NextResponse.json({ error: 'Invalid clearance level.' }, { status: 400 });
  }
  // Re-checked here even though app/api/documents/blob-upload-token also
  // checked it before issuing the token — that check gates whether a token
  // was handed out at all; this one gates whether a Document row actually
  // gets created, the same defense-in-depth shape the old single-request
  // route had.
  if (clearanceLevel > ctx.clearanceRank) {
    return NextResponse.json(
      { error: 'You cannot assign a clearance level above your own.' },
      { status: 403 },
    );
  }
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: `Unsupported file type: ${mimeType || 'unknown'}` }, { status: 400 });
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return NextResponse.json({ error: 'Invalid file size.' }, { status: 400 });
  }

  const document = await createDocument({
    name,
    description,
    fileKey: pathname,
    mimeType,
    fileSizeBytes,
    clearanceLevel,
    department,
    tags,
    uploadedById: ctx.userId,
  });

  await logAuditEvent({
    action: 'DOCUMENT_UPLOAD',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: document.id,
    metadata: { name, clearanceLevel },
  });

  after(() =>
    processDocument(document.id).catch((err) => {
      console.error('[documents] processing failed', document.id, err);
    }),
  );

  return NextResponse.json({ id: document.id, status: document.status }, { status: 201 });
}
