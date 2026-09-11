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
  updateUserDepartments,
  updateUserMessageLimitOverride,
  getUserById,
  getRoleById,
  listRolesByRank,
  deleteUser,
  getExistingEmailSet,
} from '@/lib/db/queries/users';
import { listDepartments, requireNonEmptyDepartments } from '@/lib/db/queries/departments';
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
import { buildImportErrorReportXlsx } from '@/lib/employees/importErrorReport';
import { getStorageProvider } from '@/lib/documents/storage';
import { prisma as db } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';

export type ActionResult = { error?: string; email?: ComposedEmail };

export async function createEmployeeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleId = String(formData.get('roleId') ?? '');
  const departmentIds = formData.getAll('departmentIds').map(String).filter(Boolean);

  if (!name || !email || !roleId) {
    return { error: 'Name, email, and role are required.' };
  }
  const departmentError = requireNonEmptyDepartments(departmentIds, 'employee');
  if (departmentError) return { error: departmentError };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let roleName: string;
  try {
    const user = await createUser({
      name,
      email,
      passwordHash,
      roleId,
      departmentIds,
      createdById: ctx.userId,
      creationMethod: 'MANUAL',
    });
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
      metadata: { employeeName: name, email, roleName: role.name, departmentCount: departmentIds.length },
    });
  } catch {
    return { error: 'Could not create employee — is that email already in use?' };
  }

  revalidatePath('/admin/employees');
  return { email: composeWelcomeEmail({ name, email, tempPassword, roleName }) };
}

/**
 * Retags which departments an employee belongs to — same admin-only gate
 * as changeEmployeeRoleAction, but with no self-modification restriction
 * (department membership isn't a privilege escalation vector the way role/
 * clearance is, so an admin changing their own departments is harmless).
 */
export async function changeEmployeeDepartmentsAction(
  userId: string,
  departmentIds: string[],
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const departmentError = requireNonEmptyDepartments(departmentIds, 'employee');
  if (departmentError) return { error: departmentError };

  const before = await getUserById(userId);
  await updateUserDepartments(userId, departmentIds);
  await logAuditEvent({
    action: 'EMPLOYEE_DEPARTMENTS_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: { employeeName: before.name, employeeEmail: before.email, newDepartmentCount: departmentIds.length },
  });
  revalidatePath('/admin/employees');
  return {};
}

/**
 * Sets (or clears) one employee's individual daily-chat-message-limit
 * override — see User.dailyMessageLimitOverride's own schema comment. No
 * self-modification restriction, same reasoning as
 * changeEmployeeDepartmentsAction above: unlike role/clearance, this
 * isn't a privilege-escalation vector — an admin lowering or raising
 * their OWN message quota can't reach anything they weren't already
 * authorized to see.
 */
export async function changeEmployeeMessageLimitAction(userId: string, limit: number | null): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    return { error: 'Daily message limit must be a positive whole number, or blank to inherit the role default.' };
  }

  const before = await getUserById(userId);
  await updateUserMessageLimitOverride(userId, limit);
  await logAuditEvent({
    action: 'USAGE_LIMIT_CONFIG_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: {
      scope: 'USER',
      targetName: before.name,
      oldLimit: before.dailyMessageLimitOverride,
      newLimit: limit,
    },
  });
  revalidatePath('/admin/employees');
  return {};
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
  // 'skipped' is a harmless, expected outcome (the email already exists —
  // re-uploading a sheet with existing employees in it must never
  // duplicate them), distinct from 'error' (a genuine validation failure:
  // bad role, bad department, missing field, or a real create failure).
  status: 'created' | 'skipped' | 'error';
  message?: string;
};

export type BulkImportResult =
  | { error: string; results?: undefined; emailsDocument?: undefined; batchId?: undefined }
  | { error?: undefined; results: BulkImportRowResult[]; emailsDocument: string | null; batchId: string };

/**
 * Bulk-creates employees from an uploaded CSV/XLSX file — versioned and
 * audited, not a fire-and-forget parse:
 *
 *  1. The raw file is persisted via getStorageProvider() and recorded as a
 *     new EmployeeImportBatch BEFORE any row is processed, so every
 *     created employee can carry a real importBatchId, and the sheet
 *     itself stays viewable/downloadable later (see
 *     app/api/admin/employee-imports/[id]/file).
 *  2. Each row is validated against the LIVE role and department lists —
 *     an unresolved role or department name fails that row (not the whole
 *     batch); an email that already exists anywhere in the system is
 *     SKIPPED, not an error, so re-uploading a sheet with new employees
 *     added to it only ever creates the new ones.
 *  3. Every row that didn't result in a new employee (skipped OR error) is
 *     collected into a downloadable XLSX error report with a Reason column
 *     (see buildImportErrorReportXlsx), stored on the batch alongside the
 *     original file.
 *  4. One summary EMPLOYEE_BULK_IMPORTED audit event is logged for the
 *     operation; every successfully created row also gets its own
 *     EMPLOYEE_CREATED entry, identical in shape to a manually created
 *     employee.
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
  const rows = parsed.rows as BulkImportRow[];

  // Persist the sheet and create the batch record BEFORE processing any
  // row, so every user created below can carry a real importBatchId from
  // the start rather than being patched afterward.
  const storage = getStorageProvider();
  const fileKey = await storage.save(file.name, buffer);
  const batch = await db.employeeImportBatch.create({
    data: { fileKey, fileName: file.name, uploadedById: ctx.userId, rowCount: rows.length, successCount: 0, failureCount: 0 },
  });

  const [roles, departments, existingEmails] = await Promise.all([
    listRolesByRank(),
    listDepartments(),
    getExistingEmailSet(),
  ]);
  const roleByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
  const seenEmails = new Set<string>();

  const results: BulkImportRowResult[] = [];
  const createdEmails: ComposedEmail[] = [];
  const failedRows: { rowNumber: number; name: string; email: string; roleName: string; departmentNames: string[]; reason: string }[] = [];

  for (const row of rows) {
    const result = await importOneRow(row, roleByName, departmentByName, existingEmails, seenEmails, ctx.userId, batch.id);
    results.push(result.rowResult);
    if (result.email) createdEmails.push(result.email);
    if (result.rowResult.status !== 'created') {
      failedRows.push({
        rowNumber: row.rowNumber,
        name: row.name,
        email: row.email,
        roleName: row.roleName,
        departmentNames: row.departmentNames,
        reason: result.rowResult.message ?? 'Unknown error',
      });
    }
  }

  const successCount = results.filter((r) => r.status === 'created').length;

  let errorReportFileKey: string | null = null;
  if (failedRows.length > 0) {
    const reportBuffer = await buildImportErrorReportXlsx(failedRows);
    errorReportFileKey = await storage.save(`${file.name}-errors.xlsx`, reportBuffer);
  }

  await db.employeeImportBatch.update({
    where: { id: batch.id },
    data: { successCount, failureCount: results.length - successCount, errorReportFileKey },
  });

  await logAuditEvent({
    action: 'EMPLOYEE_BULK_IMPORTED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: batch.id,
    metadata: { fileName: file.name, rowCount: results.length, successCount, failureCount: results.length - successCount },
  });

  revalidatePath('/admin/employees');
  return {
    results,
    emailsDocument: createdEmails.length > 0 ? formatEmailsAsDocument(createdEmails) : null,
    batchId: batch.id,
  };
}

async function importOneRow(
  row: BulkImportRow,
  roleByName: Map<string, { id: string; name: string }>,
  departmentByName: Map<string, { id: string; name: string }>,
  existingEmails: Set<string>,
  seenEmails: Set<string>,
  actingAdminId: string,
  importBatchId: string,
): Promise<{ rowResult: BulkImportRowResult; email?: ComposedEmail }> {
  const fail = (message: string): { rowResult: BulkImportRowResult } => ({
    rowResult: { rowNumber: row.rowNumber, email: row.email, status: 'error', message },
  });

  if (!row.name || !row.email || !row.roleName) return fail('Missing name, email, or role.');
  if (row.departmentNames.length === 0) return fail('Missing department — every employee must belong to at least one.');
  if (seenEmails.has(row.email)) return fail('Duplicate email within this file.');
  seenEmails.add(row.email);

  // Already exists anywhere in the system (a prior upload, a manual add,
  // or an earlier row already created in THIS run) — skipped, not an
  // error, so re-uploading a growing sheet never duplicates anyone.
  if (existingEmails.has(row.email)) {
    return { rowResult: { rowNumber: row.rowNumber, email: row.email, status: 'skipped', message: 'Already exists' } };
  }

  const role = roleByName.get(row.roleName.toLowerCase());
  if (!role) return fail(`Unknown role "${row.roleName}".`);

  const departmentIds: string[] = [];
  const unknownDepartments: string[] = [];
  for (const name of row.departmentNames) {
    const dept = departmentByName.get(name.toLowerCase());
    if (dept) departmentIds.push(dept.id);
    else unknownDepartments.push(name);
  }
  if (unknownDepartments.length > 0) {
    return fail(`Unknown department${unknownDepartments.length === 1 ? '' : 's'}: ${unknownDepartments.join(', ')}.`);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await createUser({
      name: row.name,
      email: row.email,
      passwordHash,
      roleId: role.id,
      departmentIds,
      createdById: actingAdminId,
      creationMethod: 'BULK_IMPORT',
      importBatchId,
    });
    existingEmails.add(row.email); // guards a duplicate later in the SAME file even if seenEmails somehow missed it
    await logAuditEvent({
      action: 'EMPLOYEE_CREATED',
      result: 'SUCCESS',
      userId: actingAdminId,
      resource: user.id,
      metadata: {
        employeeName: row.name,
        email: row.email,
        roleName: role.name,
        departmentCount: departmentIds.length,
        viaBulkImport: true,
      },
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
