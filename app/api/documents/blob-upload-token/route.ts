import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanUploadDocuments, ForbiddenError } from '@/lib/auth/rbac';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { config } from '@/lib/config';

/**
 * First half of the client-direct-upload flow that exists specifically to
 * work around a Vercel platform ceiling: serverless functions reject
 * request bodies above ~4.5MB, confirmed directly (4 real corpus documents,
 * 8-25MB each, all failed with a raw 413 the moment the browser tried to
 * POST them to the old file-through-the-server route). Routing the file
 * bytes through this app's own function was always going to hit that wall
 * regardless of UPLOAD_MAX_MB or any Next.js config — the fix is having the
 * browser upload directly to Vercel Blob instead, bypassing this app's
 * server entirely for the file itself.
 *
 * This route's ONLY job is issuing a short-lived, scoped upload token —
 * @vercel/blob/client's `upload()` calls it automatically before doing the
 * actual (direct-to-Blob) upload. The file never passes through here.
 * Authorization happens here, before a token is ever handed out: an
 * unauthorized caller gets no token, not merely a document creation
 * rejected later. Document-row creation itself happens in a SEPARATE step
 * (app/api/documents/finalize-upload/route.ts), once the browser's own
 * upload has actually finished — not via Vercel Blob's onUploadCompleted
 * webhook, which needs to be independently reachable from Vercel's
 * infrastructure and adds a failure mode this app doesn't need.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // Explicit rather than relying on handleUpload()'s own default env-var
      // lookup. Root-caused via a temporary diagnostic in this route
      // (confirmed with real request/response data, not guessed): this
      // project's Blob store was connected via Vercel's newer flow, which
      // provisions BLOB_STORE_ID and BLOB_WEBHOOK_PUBLIC_KEY automatically
      // but does NOT auto-generate a classic BLOB_READ_WRITE_TOKEN — and
      // handleUpload()'s client-token derivation has no OIDC/BLOB_STORE_ID
      // fallback the way plain put()/get() do, so it hard-requires this
      // token to exist as an actual env var, added manually from the Blob
      // store's own settings page.
      token: config.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Mirrors the same self-clearance check the old route made against
        // the actual upload — enforced here too so a caller can't even get
        // a token for a clearance level above their own, not just get
        // rejected after uploading the bytes for nothing.
        let clearanceLevel: number | undefined;
        try {
          clearanceLevel = clientPayload ? Number(JSON.parse(clientPayload).clearanceLevel) : undefined;
        } catch {
          clearanceLevel = undefined;
        }
        if (!Number.isFinite(clearanceLevel) || (clearanceLevel as number) > ctx.clearanceRank) {
          throw new Error('You cannot assign a clearance level above your own.');
        }

        return {
          access: 'private',
          allowedContentTypes: SUPPORTED_MIME_TYPES,
          maximumSizeInBytes: config.UPLOAD_MAX_MB * 1024 * 1024,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
