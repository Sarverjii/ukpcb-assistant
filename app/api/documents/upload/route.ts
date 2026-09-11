import { NextResponse, after } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanUploadDocuments, ForbiddenError } from '@/lib/auth/rbac';
import { getStorageProvider } from '@/lib/documents/storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { createDocument } from '@/lib/db/queries/documents';
import { requireNonEmptyDepartments } from '@/lib/db/queries/departments';
import { processDocument } from '@/lib/documents/pipeline';
import { logAuditEvent } from '@/lib/audit/log';
import { config } from '@/lib/config';

// Document processing (extract → chunk → embed → insert) can take well
// past a serverless platform's default timeout on a cold instance,
// especially with a hosted embedding provider's own network latency
// stacked across every chunk. 60s is comfortably above what a warm
// instance needs and within Vercel Hobby's ceiling.
export const maxDuration = 60;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    throw err;
  }

  try {
    // Server-side role check — this endpoint is reachable via direct POST,
    // not only through the UI, so authorization must be enforced here
    // regardless of what the upload form does or doesn't render.
    await requireCanUploadDocuments(ctx);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || undefined;
  const clearanceLevelRaw = formData.get('clearanceLevel');
  const departmentIds = formData.getAll('departmentIds').map(String).filter(Boolean);
  const tagsRaw = String(formData.get('tags') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Document name is required.' }, { status: 400 });
  }
  const clearanceLevel = Number(clearanceLevelRaw);
  if (!Number.isFinite(clearanceLevel)) {
    return NextResponse.json({ error: 'Invalid clearance level.' }, { status: 400 });
  }
  // A user can only classify a document at or below their OWN clearance —
  // otherwise a low-clearance uploader could hand themselves a document
  // that later gets viewed by higher-clearance users but was never actually
  // vetted at that level. (Read access is enforced independently at query
  // time regardless; this is a separate, upload-time sanity check.)
  if (clearanceLevel > ctx.clearanceRank) {
    return NextResponse.json(
      { error: 'You cannot assign a clearance level above your own.' },
      { status: 403 },
    );
  }
  const departmentError = requireNonEmptyDepartments(departmentIds, 'document');
  if (departmentError) {
    return NextResponse.json({ error: departmentError }, { status: 400 });
  }
  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || 'unknown'}` },
      { status: 400 },
    );
  }
  const maxBytes = config.UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `File exceeds the ${config.UPLOAD_MAX_MB}MB limit.` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storage = getStorageProvider();
  const fileKey = await storage.save(file.name, buffer);

  const document = await createDocument({
    name,
    description,
    fileKey,
    mimeType: file.type,
    fileSizeBytes: file.size,
    clearanceLevel,
    departmentIds,
    tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [],
    uploadedById: ctx.userId,
  });

  await logAuditEvent({
    action: 'DOCUMENT_UPLOAD',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: document.id,
    metadata: { name, clearanceLevel },
  });

  // Fire-and-forget: MVP-scale synchronous processing without blocking the
  // HTTP response. The client polls the status endpoint until READY/FAILED.
  // Wrapped in after() rather than a bare, unawaited call — on Vercel, a
  // serverless function can be frozen/terminated the moment its response is
  // sent, with no guarantee an unawaited promise keeps running afterward.
  // Confirmed directly in production: uploads got stuck in PROCESSING
  // forever, never reaching READY or FAILED — the pipeline's own try/catch
  // (see lib/documents/pipeline.ts) never even got the chance to run.
  // after() (powered by Vercel's waitUntil()) keeps the instance alive
  // until the callback settles, without making the client wait for it in
  // the response.
  after(() =>
    processDocument(document.id).catch((err) => {
      console.error('[documents] processing failed', document.id, err);
    }),
  );

  return NextResponse.json({ id: document.id, status: document.status }, { status: 201 });
}
