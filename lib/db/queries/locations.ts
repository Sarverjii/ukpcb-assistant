import { prisma } from '@/lib/db/prisma';

/**
 * Every employee and every document must belong to at least one location —
 * same policy, and same reasoning, as requireNonEmptyDepartments in
 * lib/db/queries/departments.ts, applied to the separate location axis
 * (see Location's schema.prisma comment for how the two axes differ).
 * Enforced here as one shared, reusable check rather than duplicated per
 * call site: employee create, employee location edit, document upload
 * (plain and Blob-token routes), document location edit. Pure and
 * synchronous on purpose — every call site already has the candidate id
 * array (or, for an employee, the single chosen id) in hand.
 */
export function requireNonEmptyLocations(locationIds: string[], kind: 'employee' | 'document'): string | null {
  if (locationIds.length > 0) return null;
  return `Select at least one location — every ${kind} must have at least one.`;
}

/**
 * The single source of truth for "what locations exist" — every location
 * picker/filter in the app fetches from this one query, the same reason
 * listDepartments in lib/db/queries/departments.ts exists. There's no
 * admin UI to add/rename/remove a location (unlike departments) — the
 * five canonical locations are seeded once, in the migration that
 * introduced this model, and are expected to stay fixed.
 */
export function listLocations() {
  return prisma.location.findMany({ orderBy: { name: 'asc' } });
}

export function getLocationById(id: string) {
  return prisma.location.findUniqueOrThrow({ where: { id } });
}
