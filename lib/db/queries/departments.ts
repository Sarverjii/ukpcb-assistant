import { prisma } from '@/lib/db/prisma';

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
  data: { name?: string; description?: string | null; headUserId?: string | null; isHeadDepartment?: boolean },
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
