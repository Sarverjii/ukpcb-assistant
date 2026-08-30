import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

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
    select: { id: true, status: true, processingError: true },
  });

  if (!document) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(document);
}
