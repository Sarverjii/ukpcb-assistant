import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireCanUploadDocuments, ForbiddenError } from '@/lib/auth/rbac';
import { getLowestRole } from '@/lib/db/queries/roles';
import { listDepartments } from '@/lib/db/queries/departments';

/**
 * Small read-only endpoint for upload tooling that runs outside the app
 * itself (see Large Database/upload-documents.mjs) and needs "the
 * clearance level and department set that means literally everyone"
 * without hardcoding a guessed value that could silently drift from the
 * real hierarchy. Mirrors the exact same getLowestRole() lookup
 * addDocumentFromUrlAction already uses for the same "everyone"
 * guarantee (see that action's own comment) — so external tooling and the
 * app's own URL-upload feature can never disagree about what "everyone"
 * means, and both keep meaning it even if the hierarchy is later
 * restructured or a new, even-lower role is added.
 *
 * Gated by the same requireCanUploadDocuments check every upload route
 * already enforces — this only ever hands out data an uploader-capable
 * account could already see in the Knowledge Base's own clearance/
 * department pickers.
 */
export async function GET() {
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

  const [lowestRole, departments] = await Promise.all([getLowestRole(), listDepartments()]);

  return NextResponse.json({
    // The clearance level to assign a document so every role — including
    // any role more junior than today's lowest — can see it.
    everyoneClearanceLevel: lowestRole?.hierarchyRank ?? 0,
    // Every department that currently exists, for tooling that wants a
    // document tagged into all of them (in addition to, not instead of,
    // the clearance level above).
    departmentIds: departments.map((d) => d.id),
  });
}
