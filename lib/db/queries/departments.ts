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
 * removeDepartmentMemberAction). No delete action exists in this app,
 * mirroring Role (also add/rename-only, never deletable) — see
 * Department's schema.prisma comment for why.
 */
export function createDepartment(name: string) {
  return prisma.department.create({ data: { name } });
}

/**
 * Single update path for everything editable on a department's detail
 * page — name, description, and head — so the UI can save any subset of
 * these in one round trip instead of three separate actions.
 */
export function updateDepartment(
  id: string,
  data: { name?: string; description?: string | null; headUserId?: string | null },
) {
  return prisma.department.update({ where: { id }, data });
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
