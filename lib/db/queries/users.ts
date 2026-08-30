import { prisma } from '@/lib/db/prisma';
import type { UserStatus } from '@prisma/client';

export function listUsersWithRole() {
  return prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function listRolesByRank() {
  return prisma.role.findMany({ orderBy: { hierarchyRank: 'desc' } });
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

export function getUserById(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
}
