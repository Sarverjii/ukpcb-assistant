'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { getUserById } from '@/lib/db/queries/users';
import {
  createDepartment,
  updateDepartment,
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

/**
 * Single save path for a department's name, description, and head — the
 * detail page's edit form submits whichever of these actually changed;
 * unpassed fields are left untouched (undefined, not null, so "no change"
 * and "clear this field" stay distinguishable — headUserId: null explicitly
 * clears the head, headUserId: undefined leaves it as-is).
 */
export async function updateDepartmentAction(
  departmentId: string,
  changes: { name?: string; description?: string | null; headUserId?: string | null },
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const before = await getDepartmentById(departmentId);
  if (changes.name !== undefined && !changes.name.trim()) {
    return { error: 'Department name is required.' };
  }

  try {
    await updateDepartment(departmentId, {
      ...changes,
      name: changes.name?.trim(),
    });
  } catch {
    return { error: 'Could not save — is that name already in use?' };
  }

  if (changes.name !== undefined && changes.name.trim() !== before.name) {
    await logAuditEvent({
      action: 'DEPARTMENT_RENAMED',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: departmentId,
      metadata: { previousName: before.name, newName: changes.name.trim() },
    });
  }
  revalidatePath('/admin/departments');
  revalidatePath(`/admin/departments/${departmentId}`);
  revalidatePath('/directory');
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
  revalidatePath('/directory');
  return {};
}

export async function removeDepartmentMemberAction(departmentId: string, userId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const [dept, employee] = await Promise.all([getDepartmentById(departmentId), getUserById(userId)]);
  await removeDepartmentMember(departmentId, userId);
  // A department's head must also be a member — if the employee being
  // removed was the head, the head designation is cleared along with
  // their membership rather than left pointing at a non-member.
  if (dept.headUserId === userId) {
    await updateDepartment(departmentId, { headUserId: null });
  }
  await logAuditEvent({
    action: 'DEPARTMENT_MEMBER_REMOVED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: departmentId,
    metadata: { departmentName: dept.name, employeeName: employee.name, employeeEmail: employee.email },
  });
  revalidatePath(`/admin/departments/${departmentId}`);
  revalidatePath('/admin/employees');
  revalidatePath('/directory');
  return {};
}
