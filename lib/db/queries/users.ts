import { prisma } from '@/lib/db/prisma';
import type { UserStatus } from '@prisma/client';

// Excludes REMOVED — a soft-removed employee is deliberately hidden from
// the main roster and only reachable via the dedicated "Removed employees"
// page (listRemovedUsersWithRole below), so this list only ever needs to
// distinguish ACTIVE from DISABLED.
export function listUsersWithRole() {
  return prisma.user.findMany({
    where: { status: { not: 'REMOVED' } },
    include: { role: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function listRemovedUsersWithRole() {
  return prisma.user.findMany({
    where: { status: 'REMOVED' },
    include: { role: true },
    orderBy: { createdAt: 'desc' },
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
  department?: string;
};

export function createUser(input: CreateUserInput) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      roleId: input.roleId,
      department: input.department,
    },
  });
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
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
}

/** Same as getUserById, but returns null on a bad id instead of throwing —
 * for the admin employee-conversations pages, which need to notFound()
 * cleanly on an id from the URL rather than crash. */
export function getUserByIdOrNull(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
}
