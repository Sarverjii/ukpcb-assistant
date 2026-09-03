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

export function renameDepartment(id: string, name: string) {
  return prisma.department.update({ where: { id }, data: { name } });
}

/** A department's current members, for the department detail/membership page. */
export function getDepartmentWithMembers(id: string) {
  return prisma.department.findUniqueOrThrow({
    where: { id },
    include: {
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
