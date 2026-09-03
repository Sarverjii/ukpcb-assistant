import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { listAllActiveUsersForExport } from '@/lib/db/queries/users';
import { logAuditEvent } from '@/lib/audit/log';

/**
 * "The sheet" — the live, always-current employee roster, generated fresh
 * from the database on every request (never a stored file, unlike a
 * bulk-import batch's own original sheet — see the sibling
 * /api/admin/employee-imports routes for those). This is what satisfies
 * "downloadable but not editable": nothing in this app writes back to the
 * User table from a spreadsheet — the only ways to change the roster are
 * the manual add form and bulk import, both of which feed the SAME
 * provenance columns (createdBy/createdAt/creationMethod) this export
 * reads.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await getAuthContext();
    await requireAdmin(ctx);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const users = await listAllActiveUsersForExport();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employees');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Departments', key: 'departments', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Added By', key: 'addedBy', width: 22 },
    { header: 'Added At', key: 'addedAt', width: 22 },
    { header: 'Added Via', key: 'addedVia', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const u of users) {
    sheet.addRow({
      name: u.name,
      email: u.email,
      role: u.role.name,
      departments: u.departments.map((d) => d.name).join('; '),
      status: u.status,
      addedBy: u.createdBy?.name ?? 'System',
      addedAt: u.createdAt.toISOString().slice(0, 10),
      addedVia: u.creationMethod === 'BULK_IMPORT' ? 'Bulk import' : 'Manual',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  await logAuditEvent({
    action: 'EMPLOYEE_ROSTER_EXPORTED',
    result: 'SUCCESS',
    userId: ctx.userId,
    metadata: { employeeCount: users.length },
  });

  return new NextResponse(new Uint8Array(Buffer.from(buffer)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="employee-roster-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
