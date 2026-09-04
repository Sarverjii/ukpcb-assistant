import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { processDocument } from '@/lib/documents/pipeline';

// A document mid-multi-pass OCR (see pipeline.ts's own comment) sits in
// PROCESSING between passes with no active work running — nothing else in
// this app re-triggers processDocument() once one pass's after() finishes,
// so without this nudge a long scan would stall forever at, say, "page 3
// of 9" the moment nobody happens to be polling it. Firing the nudge from
// this GET handler (rather than a separate action the client has to know
// to call) means every existing poller — pollUntilSettled, and
// KnowledgeBase.tsx's own page-load poll for any already-PROCESSING
// document — resumes a stalled scan for free, with zero client changes.
//
// Gated on having gone idle for a bit (not "any PROCESSING doc") so this
// never collides with a pass that's still actively running — updatedAt
// moves forward on every single page's setOcrProgress() call mid-pass, so
// a genuinely active pass never looks idle here.
const OCR_IDLE_NUDGE_MS = 5000;

// Matches every other route that can end up running processDocument() via
// after() (see app/api/documents/upload/route.ts's own comment) — the
// nudge above can kick off up to PASS_BUDGET_MS (pipeline.ts) of real
// background work, which needs the same budget to actually finish a pass
// rather than getting silently killed mid-write.
export const maxDuration = 60;

// Next.js 16: route params are always async.
export async function GET(_request: Request, { params }: RouteContext<'/api/documents/[id]/status'>) {
  try {
    await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    throw err;
  }

  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      processingError: true,
      ocrPagesTotal: true,
      ocrPagesDone: true,
      updatedAt: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (
    document.status === 'PROCESSING' &&
    document.ocrPagesTotal !== null &&
    (document.ocrPagesDone ?? 0) < document.ocrPagesTotal &&
    Date.now() - document.updatedAt.getTime() > OCR_IDLE_NUDGE_MS
  ) {
    after(() =>
      processDocument(id).catch((err) => {
        console.error('[documents] OCR continuation failed', id, err);
      }),
    );
  }

  return NextResponse.json({
    id: document.id,
    status: document.status,
    processingError: document.processingError,
    ocrPagesTotal: document.ocrPagesTotal,
    ocrPagesDone: document.ocrPagesDone,
  });
}
