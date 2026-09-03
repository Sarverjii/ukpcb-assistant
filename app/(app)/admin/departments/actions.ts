'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { getUserById } from '@/lib/db/queries/users';
import {
  createDepartment,
  renameDepartment,
  getDepartmentById,
  addDepartmentMember,
  removeDepartmentMember,
} from '@/lib/db/queries/departments';

export type ActionResult = { error?: string };

export async function createDepartmentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Department name is required.' };

  try {
    const dept = await createDepartment(name);
    await logAuditEvent({
      action: 'DEPARTMENT_CREATED',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: dept.id,
      metadata: { name },
    });
  } catch {
    return { error: 'Could not create department — is that name already in use?' };
  }

  revalidatePath('/admin/departments');
  return {};
}

export async function renameDepartmentAction(departmentId: string, name: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const trimmed = name.trim();
  if (!trimmed) return { error: 'Department name is required.' };

  const before = await getDepartmentById(departmentId);
  try {
    await renameDepartment(departmentId, trimmed);
  } catch {
    return { error: 'Could not rename — is that name already in use?' };
  }
  await logAuditEvent({
    action: 'DEPARTMENT_RENAMED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: departmentId,
    metadata: { previousName: before.name, newName: trimmed },
  });
  revalidatePath('/admin/departments');
  revalidatePath(`/admin/departments/${departmentId}`);
  return {};
}

export async function addDepartmentMemberAction(departmentId: string, userId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const [dept, employee] = await Promise.all([getDepartmentById(departmentId), getUserById(userId)]);
  await addDepartmentMember(departmentId, userId);
  await logAuditEvent({
    action: 'DEPARTMENT_MEMBER_ADDED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: departmentId,
    metadata: { departmentName: dept.name, employeeName: employee.name, employeeEmail: employee.email },
  });
  revalidatePath(`/admin/departments/${departmentId}`);
  revalidatePath('/admin/employees');
  return {};
}

export async function removeDepartmentMemberAction(departmentId: string, userId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const [dept, employee] = await Promise.all([getDepartmentById(departmentId), getUserById(userId)]);
  await removeDepartmentMember(departmentId, userId);
  await logAuditEvent({
    action: 'DEPARTMENT_MEMBER_REMOVED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: departmentId,
    metadata: { departmentName: dept.name, employeeName: employee.name, employeeEmail: employee.email },
  });
  revalidatePath(`/admin/departments/${departmentId}`);
  revalidatePath('/admin/employees');
  return {};
}
