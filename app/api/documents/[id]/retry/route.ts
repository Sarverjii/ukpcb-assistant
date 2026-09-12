import { NextResponse, after } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanManageDocument, ForbiddenError } from '@/lib/auth/rbac';
import { getDocument, resetDocumentForRetry } from '@/lib/db/queries/documents';
import { processDocument } from '@/lib/documents/pipeline';

// REST counterpart to retryDocumentAction (app/(app)/knowledge-base/actions.ts)
// — same underlying operation (resetDocumentForRetry + re-invoke
// processDocument), reachable over plain HTTP instead of the Next.js
// Server Action protocol, for tooling that talks to this app the same way
// Large Database/upload-documents.mjs already does (a logged-in session
// cookie + JSON fetches) rather than as a browser rendering React. Kept
// as a thin wrapper with no logic of its own so there is exactly one
// place ("how to retry a document") both the UI and external tooling
// share — see retryDocumentAction's own comment for why this is safe to
// call regardless of why the document failed, and why it RESUMES rather
// than restarts a partially-OCR'd scan.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: RouteContext<'/api/documents/[id]/retry'>) {
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

  if (document.status !== 'FAILED') {
    return NextResponse.json({ error: 'This document is not in a failed state.' }, { status: 400 });
  }

  await resetDocumentForRetry(id);

  after(() =>
    processDocument(id).catch((err) => {
      console.error('[documents] retry failed', id, err);
    }),
  );

  return NextResponse.json({ id, status: 'PENDING' });
}
