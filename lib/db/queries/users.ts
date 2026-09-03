import { prisma } from '@/lib/db/prisma';
import type { UserStatus, CreationMethod } from '@prisma/client';

// Every listing below includes `departments` and `createdBy` — the
// provenance columns ("who added them, when, how") the live roster export
// (app/api/admin/employees/export) and the Employees table both need.
// createdAt is already a plain column, no include required for it.
const WITH_ROLE_AND_PROVENANCE = {
  role: true,
  departments: true,
  createdBy: { select: { id: true, name: true } },
} as const;

// Excludes REMOVED — a soft-removed employee is deliberately hidden from
// the main roster and only reachable via the dedicated "Removed employees"
// page (listRemovedUsersWithRole below), so this list only ever needs to
// distinguish ACTIVE from DISABLED.
export function listUsersWithRole() {
  return prisma.user.findMany({
    where: { status: { not: 'REMOVED' } },
    include: WITH_ROLE_AND_PROVENANCE,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Every active-or-disabled employee currently in ZERO departments — since
 * department membership is optional (see User.departments), this is a
 * real, expected state, not an error. Backs the admin "No department"
 * page (a lightweight companion to the real Departments — not a
 * Department row itself, just a worklist for assigning these people
 * somewhere) and the Evon Directory's own "No department" group.
 */
export function listUsersWithoutDepartment() {
  return prisma.user.findMany({
    where: { status: { not: 'REMOVED' }, departments: { none: {} } },
    include: { role: true },
    orderBy: { name: 'asc' },
  });
}

export function listRemovedUsersWithRole() {
  return prisma.user.findMany({
    where: { status: 'REMOVED' },
    include: WITH_ROLE_AND_PROVENANCE,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Every non-removed employee, for the live roster export
 * (app/api/admin/employees/export) — same shape as listUsersWithRole, kept
 * as a distinct export in case the two ever need to diverge (e.g. the
 * export wanting REMOVED employees included later), even though they're
 * identical today.
 */
export function listAllActiveUsersForExport() {
  return listUsersWithRole();
}

/**
 * Backs the Evon Directory — deliberately the narrowest possible shape:
 * name, email, role name, and department names only. No status, no
 * clearance rank, no provenance, nothing an ordinary employee shouldn't
 * see about a colleague. Excludes DISABLED and REMOVED the same way
 * listUsersWithRole does for the active roster, so the directory never
 * surfaces someone who can't currently log in as if they were a normal
 * colleague to reach out to.
 */
export function listDirectoryEntries() {
  return prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      email: true,
      role: { select: { name: true } },
      departments: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export function listRolesByRank() {
  return prisma.role.findMany({ orderBy: { hierarchyRank: 'desc' } });
}

export function getRoleById(id: string) {
  return prisma.role.findUniqueOrThrow({ where: { id } });
}

export type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  roleId: string;
  departmentIds?: string[];
  // Provenance — who created this account, and how. Omitting createdById
  // (e.g. a seed script) leaves it null, displayed as "System" on the
  // roster export. creationMethod defaults to MANUAL at the schema level;
  // bulk import always passes 'BULK_IMPORT' explicitly.
  createdById?: string;
  creationMethod?: CreationMethod;
  importBatchId?: string;
};

export function createUser(input: CreateUserInput) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      roleId: input.roleId,
      departments: input.departmentIds?.length
        ? { connect: input.departmentIds.map((id) => ({ id })) }
        : undefined,
      createdById: input.createdById,
      creationMethod: input.creationMethod,
      importBatchId: input.importBatchId,
    },
  });
}

export function updateUserDepartments(userId: string, departmentIds: string[]) {
  return prisma.user.update({
    where: { id: userId },
    data: { departments: { set: departmentIds.map((id) => ({ id })) } },
  });
}

/** Every non-removed employee whose email already exists — for bulk-import dedup. */
export async function getExistingEmailSet(): Promise<Set<string>> {
  const users = await prisma.user.findMany({ select: { email: true } });
  return new Set(users.map((u) => u.email));
}

export function updateUserRole(userId: string, roleId: string) {
  return prisma.user.update({ where: { id: userId }, data: { roleId } });
}

export function updateUserStatus(userId: string, status: UserStatus) {
  return prisma.user.update({ where: { id: userId }, data: { status } });
}

export function updateUserPasswordHash(userId: string, passwordHash: string) {
  return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

/**
 * Real, permanent deletion — only ever called on a REMOVED user, from
 * deleteEmployeePermanentlyAction, after the schema's onDelete rules
 * (Conversation: Cascade, Document.uploadedBy: SetNull, AuditLog.user:
 * SetNull) were set up specifically to make this safe. See that action for
 * the full write-up of what survives and what doesn't.
 */
export function deleteUser(userId: string) {
  return prisma.user.delete({ where: { id: userId } });
}

export function getUserById(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, departments: true } });
}

/** Same as getUserById, but returns null on a bad id instead of throwing —
 * for the admin employee-conversations pages, which need to notFound()
 * cleanly on an id from the URL rather than crash. */
export function getUserByIdOrNull(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: { role: true, departments: true } });
}
