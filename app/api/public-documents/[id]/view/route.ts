import { NextResponse } from 'next/server';
import { getPublicDocument } from '@/lib/db/queries/documents';
import { getStorageProvider } from '@/lib/documents/storage';

/**
 * Public counterpart of app/api/documents/[id]/view/route.ts — serves a
 * public document's rendered bytes for a citation in the unauthenticated
 * public chat to link to. No getAuthContext call at all: getPublicDocument
 * only ever returns a row when isPublic is true (see that query's own
 * comment), which IS the entire authorization boundary here — the same
 * flag that makes this content visible to every employee too, via the
 * OR-bypass in lib/db/queries/chunks.ts.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/public-documents/[id]/view'>) {
  const { id } = await params;
  const document = await getPublicDocument(id);
  if (!document) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const storage = getStorageProvider();
  // Same preview-vs-original choice as the authenticated view route — see
  // its matching comment.
  const usePreview = document.mimeType !== 'application/pdf' && document.previewFileKey;
  const servedMimeType = usePreview ? 'application/pdf' : document.mimeType;
  let buffer: Buffer;
  try {
    buffer = await storage.read(usePreview ? document.previewFileKey! : document.fileKey);
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
      'Content-Type': servedMimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.name)}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=300',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}
