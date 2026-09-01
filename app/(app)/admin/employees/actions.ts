'use server';

import { randomBytes } from 'crypto';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { requireAdminReauth } from '@/lib/auth/reauth';
import { hashPassword } from '@/lib/auth/password';
import { logAuditEvent } from '@/lib/audit/log';
import {
  createUser,
  updateUserRole,
  updateUserStatus,
  updateUserPasswordHash,
  getUserById,
  getRoleById,
  listRolesByRank,
  deleteUser,
} from '@/lib/db/queries/users';
import { listDocumentsByUploader } from '@/lib/db/queries/documents';
import { countConversationsForUser } from '@/lib/db/queries/conversations';
import {
  composeWelcomeEmail,
  composePasswordResetEmail,
  composeAccountStatusEmail,
  formatEmailsAsDocument,
  type ComposedEmail,
} from '@/lib/employees/emailCompose';
import { parseBulkImportFile, type BulkImportRow } from '@/lib/employees/bulkImportParse';
import { revalidatePath } from 'next/cache';

export type ActionResult = { error?: string; email?: ComposedEmail };

export async function createEmployeeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleId = String(formData.get('roleId') ?? '');
  const department = String(formData.get('department') ?? '').trim() || undefined;

  if (!name || !email || !roleId) {
    return { error: 'Name, email, and role are required.' };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let roleName: string;
  try {
    const user = await createUser({ name, email, passwordHash, roleId, department });
    const role = await getRoleById(roleId);
    roleName = role.name;
    await logAuditEvent({
      action: 'EMPLOYEE_CREATED',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: user.id,
      // Names/emails captured directly, not just ids — this entry needs to
      // stay readable even after the employee is later renamed, moved to a
      // different role, or removed entirely.
      metadata: { employeeName: name, email, roleName: role.name, department },
    });
  } catch {
    return { error: 'Could not create employee — is that email already in use?' };
  }

  revalidatePath('/admin/employees');
  return { email: composeWelcomeEmail({ name, email, tempPassword, roleName }) };
}

export async function changeEmployeeRoleAction(userId: string, roleId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  // Spec: users must not be able to modify their own role or clearance —
  // applies even to an admin acting on their own account, to prevent
  // accidental self-demotion/lockout.
  if (userId === ctx.userId) {
    return { error: 'You cannot change your own role.' };
  }

  const before = await getUserById(userId);
  const newRole = await getRoleById(roleId);
  await updateUserRole(userId, roleId);
  await logAuditEvent({
    action: 'EMPLOYEE_ROLE_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: {
      employeeName: before.name,
      employeeEmail: before.email,
      previousRoleName: before.role.name,
      newRoleName: newRole.name,
    },
  });
  revalidatePath('/admin/employees');
  return {};
}

export async function toggleEmployeeStatusAction(userId: string, password: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (userId === ctx.userId) {
    return { error: 'You cannot disable your own account.' };
  }

  try {
    await requireAdminReauth(ctx, password, 'employees:toggleStatus');
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const user = await getUserById(userId);
  if (user.status === 'REMOVED') {
    return { error: 'This employee has been removed — restoring is not supported.' };
  }
  const nextStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  await updateUserStatus(userId, nextStatus);
  await logAuditEvent({
    action: 'EMPLOYEE_STATUS_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: {
      employeeName: user.name,
      employeeEmail: user.email,
      previousStatus: user.status,
      newStatus: nextStatus,
    },
  });
  revalidatePath('/admin/employees');
  return { email: composeAccountStatusEmail({ name: user.name, email: user.email, newStatus: nextStatus }) };
}

export async function resetEmployeePasswordAction(userId: string, password: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  try {
    await requireAdminReauth(ctx, password, 'employees:resetPassword');
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const user = await getUserById(userId);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await updateUserPasswordHash(userId, passwordHash);
  // Never log the plaintext password itself — only the fact of the reset,
  // and who it was for.
  await logAuditEvent({
    action: 'EMPLOYEE_PASSWORD_RESET',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: { employeeName: user.name, employeeEmail: user.email },
  });
  revalidatePath('/admin/employees');
  return { email: composePasswordResetEmail({ name: user.name, email: user.email, tempPassword }) };
}

/**
 * Stage 1 of removal: blocks login and moves the employee off the main
 * roster onto the dedicated "Removed employees" page, but touches nothing
 * else — their documents, conversations, and audit history are all
 * untouched. Reversible in the database (nothing here is destructive), but
 * no "restore" UI exists in this app; the only forward path from here is
 * review-then-deleteEmployeePermanentlyAction. See UserStatus.REMOVED's
 * schema comment for why a restore path was deliberately not built.
 */
export async function removeEmployeeAction(userId: string, password: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (userId === ctx.userId) {
    return { error: 'You cannot remove your own account.' };
  }

  try {
    await requireAdminReauth(ctx, password, 'employees:remove');
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const user = await getUserById(userId);
  if (user.status === 'REMOVED') return { error: 'This employee has already been removed.' };

  await updateUserStatus(userId, 'REMOVED');
  await logAuditEvent({
    action: 'EMPLOYEE_REMOVED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: { employeeName: user.name, employeeEmail: user.email, roleName: user.role.name },
  });
  revalidatePath('/admin/employees');
  revalidatePath('/admin/employees/removed');
  return {};
}

/**
 * Stage 2, real and permanent: only reachable from the removed-employee
 * review page (app/(app)/admin/employees/removed/[id]/page.tsx), which
 * itself only exists for a REMOVED employee and already shows their
 * uploaded documents before this button is ever visible — that page's own
 * existence is the "reviewed the documents first" gate, no extra check is
 * needed here beyond requiring the employee actually be REMOVED already
 * (never lets an ACTIVE/DISABLED employee be hard-deleted directly).
 *
 * Everything this cascades or nulls out is governed entirely by the schema
 * (prisma/schema.prisma's onDelete rules, set up specifically for this):
 * conversations + their messages are deleted with the employee; any
 * documents still attributed to them survive with uploadedById set to
 * null, displayed everywhere as "Removed employee"; every audit log entry
 * referencing them survives the same way. Nothing here force-deletes a
 * document — that's always a separate, explicit admin choice made on the
 * review page beforehand via the existing deleteDocumentAction.
 */
export async function deleteEmployeePermanentlyAction(userId: string, password: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (userId === ctx.userId) {
    return { error: 'You cannot delete your own account.' };
  }

  try {
    await requireAdminReauth(ctx, password, 'employees:deletePermanently');
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const user = await getUserById(userId);
  if (user.status !== 'REMOVED') {
    return { error: 'An employee must be removed before they can be permanently deleted.' };
  }

  // Captured before the row disappears — this is the last chance to know
  // any of it. Same "capture context at write time" discipline as every
  // other destructive action in this app.
  const [conversationCount, remainingDocuments] = await Promise.all([
    countConversationsForUser(userId),
    listDocumentsByUploader(userId),
  ]);

  await deleteUser(userId);
  await logAuditEvent({
    action: 'EMPLOYEE_DELETED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: {
      employeeName: user.name,
      employeeEmail: user.email,
      roleName: user.role.name,
      conversationCount,
      documentsKeptCount: remainingDocuments.length,
    },
  });
  revalidatePath('/admin/employees/removed');
  revalidatePath('/knowledge-base');
  return {};
}

export type BulkImportRowResult = {
  rowNumber: number;
  email: string;
  status: 'created' | 'error';
  message?: string;
};

export type BulkImportResult =
  | { error: string; results?: undefined; emailsDocument?: undefined }
  | { error?: undefined; results: BulkImportRowResult[]; emailsDocument: string | null };

/**
 * Bulk-creates employees from an uploaded CSV/XLSX file. A bad row is
 * reported per-row, not fatal to the rest of the batch — one typo'd role
 * name shouldn't block 50 correctly-formed rows. Every successfully
 * created row is otherwise indistinguishable in the audit log from a
 * manually created employee (same EMPLOYEE_CREATED shape), plus one
 * summary EMPLOYEE_BULK_IMPORTED entry for the operation itself.
 *
 * Returns the composed welcome emails as a single downloadable document
 * (see formatEmailsAsDocument) instead of ever showing a raw password list
 * — same "email preview, not raw credentials" rule as every other
 * credential-minting action in this file.
 */
export async function bulkImportEmployeesAction(formData: FormData): Promise<BulkImportResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const password = String(formData.get('password') ?? '');
  try {
    await requireAdminReauth(ctx, password, 'employees:bulkImport');
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV or XLSX file first.' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseBulkImportFile(file.name, buffer);
  if (parsed.error) return { error: parsed.error };

  const roles = await listRolesByRank();
  const roleByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const seenEmails = new Set<string>();

  const results: BulkImportRowResult[] = [];
  const createdEmails: ComposedEmail[] = [];

  for (const row of parsed.rows as BulkImportRow[]) {
    const result = await importOneRow(row, roleByName, seenEmails, ctx.userId);
    results.push(result.rowResult);
    if (result.email) createdEmails.push(result.email);
  }

  const successCount = results.filter((r) => r.status === 'created').length;
  await logAuditEvent({
    action: 'EMPLOYEE_BULK_IMPORTED',
    result: 'SUCCESS',
    userId: ctx.userId,
    metadata: { fileName: file.name, rowCount: results.length, successCount, failureCount: results.length - successCount },
  });

  revalidatePath('/admin/employees');
  return {
    results,
    emailsDocument: createdEmails.length > 0 ? formatEmailsAsDocument(createdEmails) : null,
  };
}

async function importOneRow(
  row: BulkImportRow,
  roleByName: Map<string, { id: string; name: string }>,
  seenEmails: Set<string>,
  actingAdminId: string,
): Promise<{ rowResult: BulkImportRowResult; email?: ComposedEmail }> {
  const fail = (message: string): { rowResult: BulkImportRowResult } => ({
    rowResult: { rowNumber: row.rowNumber, email: row.email, status: 'error', message },
  });

  if (!row.name || !row.email || !row.roleName) return fail('Missing name, email, or role.');
  if (seenEmails.has(row.email)) return fail('Duplicate email within this file.');
  seenEmails.add(row.email);

  const role = roleByName.get(row.roleName.toLowerCase());
  if (!role) return fail(`Unknown role "${row.roleName}".`);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await createUser({
      name: row.name,
      email: row.email,
      passwordHash,
      roleId: role.id,
      department: row.department,
    });
    await logAuditEvent({
      action: 'EMPLOYEE_CREATED',
      result: 'SUCCESS',
      userId: actingAdminId,
      resource: user.id,
      metadata: { employeeName: row.name, email: row.email, roleName: role.name, department: row.department, viaBulkImport: true },
    });
  } catch {
    return fail('Could not create — is that email already in use?');
  }

  return {
    rowResult: { rowNumber: row.rowNumber, email: row.email, status: 'created' },
    email: composeWelcomeEmail({ name: row.name, email: row.email, tempPassword, roleName: role.name }),
  };
}

function generateTempPassword(): string {
  return randomBytes(9).toString('base64url');
}
