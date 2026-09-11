import { prisma } from '@/lib/db/prisma';

/**
 * Every employee and every document must belong to at least one
 * department — a deliberate policy decision (not the original design:
 * see PROJECT_CONTEXT.md for the "clearance alone governs a departmentless
 * document" model this replaces). Enforced here as one shared, reusable
 * check rather than duplicated per call site, so every creation/edit path
 * (employee create, employee department edit, bulk import, document
 * upload — both the plain and Blob-token routes — document department
 * edit) rejects an empty department list with the exact same message.
 * Pure and synchronous on purpose: every call site already has the
 * candidate id array in hand, so this never needs its own DB round trip.
 */
export function requireNonEmptyDepartments(departmentIds: string[], kind: 'employee' | 'document'): string | null {
  if (departmentIds.length > 0) return null;
  return `Select at least one department — every ${kind} must belong to at least one.`;
}

/**
 * The single source of truth for "what departments exist" — every
 * department picker/filter in the app (document upload/edit, the
 * employee-side DepartmentPicker, both tables' filter dropdowns) fetches
 * from this one query rather than each maintaining its own copy, so a
 * department added or renamed from the admin Departments tab is
 * immediately reflected everywhere with no risk of drift between the
 * document-side and employee-side pickers.
 */
export function listDepartments() {
  return prisma.department.findMany({ orderBy: { name: 'asc' } });
}

/**
 * Backs the admin Departments overview (card grid): name, description,
 * head, and member/document counts in one query — everything the list
 * view needs without a detail-page round trip per card.
 */
export function listDepartmentsWithStats() {
  return prisma.department.findMany({
    include: {
      head: { select: { id: true, name: true, email: true } },
      _count: { select: { users: { where: { status: { not: 'REMOVED' } } }, documents: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export function getDepartmentById(id: string) {
  return prisma.department.findUniqueOrThrow({ where: { id } });
}

/**
 * New departments start out empty — membership is managed separately from
 * the department's own detail page (see addDepartmentMemberAction /
 * removeDepartmentMemberAction).
 */
export function createDepartment(name: string) {
  return prisma.department.create({ data: { name } });
}

/**
 * Single update path for everything editable on a department's detail
 * page — name, description, head, and the head-department flag — so the
 * UI can save any subset of these in one round trip instead of several
 * separate actions.
 */
export function updateDepartment(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    headUserId?: string | null;
    isHeadDepartment?: boolean;
    // See Department.dailyMessageLimit's own schema comment — undefined
    // means "not part of this save", null means "explicitly clear the
    // cap" (back to no department-level limit), same convention as
    // headUserId above.
    dailyMessageLimit?: number | null;
  },
) {
  return prisma.department.update({ where: { id }, data });
}

/**
 * Permanently removes a department — see deleteDepartmentAction and the
 * schema.prisma comment on Department for the full contract: every
 * document that had this department just loses this one tag (the FK
 * cascade on the join table handles that automatically), every employee
 * in it just loses this one membership, same way. The one thing that
 * DOESN'T cascade on its own is DocumentChunk.departmentIds — that's a
 * plain text[] column, not a foreign key — so this recomputes it for
 * every affected document in the same transaction, from each document's
 * REMAINING departments (fetched before the delete runs), exactly
 * mirroring what updateChunksDepartmentsForDocument does for an ordinary
 * retag. Nothing about a document's or employee's OWN content, clearance,
 * or account is touched — only this one relationship disappears.
 */
export async function deleteDepartment(id: string): Promise<void> {
  const dept = await prisma.department.findUniqueOrThrow({
    where: { id },
    include: { documents: { select: { id: true, departments: { select: { id: true } } } } },
  });

  await prisma.$transaction([
    prisma.department.delete({ where: { id } }),
    ...dept.documents.map((doc) =>
      prisma.documentChunk.updateMany({
        where: { documentId: doc.id },
        data: { departmentIds: doc.departments.filter((d) => d.id !== id).map((d) => d.id) },
      }),
    ),
  ]);
}

/**
 * Everyone/everything for whom `departmentId` is their ONLY department —
 * i.e. who would be left with zero once it's gone. Used to block an
 * operation that would otherwise violate the "every employee and every
 * document belongs to at least one department" policy (see
 * requireNonEmptyDepartments above) rather than silently creating the
 * exact null state that policy exists to prevent. `some` + `every` on the
 * same relation together mean "has this department, AND every department
 * it has IS this one" — the precise "this is their only one" condition;
 * `every` alone would also match someone/something with ZERO departments
 * (vacuously true on an empty relation), which is a different, pre-
 * existing state this check has no business flagging.
 */
export async function findSoleDependents(departmentId: string): Promise<{ users: string[]; documents: string[] }> {
  const [users, documents] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: { not: 'REMOVED' },
        departments: { some: { id: departmentId }, every: { id: departmentId } },
      },
      select: { name: true },
    }),
    prisma.document.findMany({
      where: { departments: { some: { id: departmentId }, every: { id: departmentId } } },
      select: { name: true },
    }),
  ]);
  return { users: users.map((u) => u.name), documents: documents.map((d) => d.name) };
}

/** A department's current members and head, for the detail/membership page. */
export function getDepartmentWithMembers(id: string) {
  return prisma.department.findUniqueOrThrow({
    where: { id },
    include: {
      head: { select: { id: true, name: true, email: true } },
      users: {
        where: { status: { not: 'REMOVED' } },
        include: { role: true },
        orderBy: { name: 'asc' },
      },
    },
  });
}

export function addDepartmentMember(departmentId: string, userId: string) {
  return prisma.department.update({
    where: { id: departmentId },
    data: { users: { connect: { id: userId } } },
  });
}

export function removeDepartmentMember(departmentId: string, userId: string) {
  return prisma.department.update({
    where: { id: departmentId },
    data: { users: { disconnect: { id: userId } } },
  });
}
