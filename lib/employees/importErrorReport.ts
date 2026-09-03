import ExcelJS from 'exceljs';

export type ImportErrorRow = {
  rowNumber: number;
  name: string;
  email: string;
  roleName: string;
  departmentNames: string[];
  reason: string;
};

/**
 * Builds the downloadable "what failed and why" sheet for a bulk import —
 * the user's explicit requirement that a row rejected for a bad
 * department/role/duplicate never silently vanish, but come back as a real
 * spreadsheet with a Reason column, in the same shape the row was
 * originally submitted in so it can be corrected and re-uploaded directly.
 * Uses exceljs, the same library bulkImportParse.ts already reads XLSX
 * files with.
 */
export async function buildImportErrorReportXlsx(rows: ImportErrorRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Failed rows');
  sheet.columns = [
    { header: 'Row', key: 'row', width: 8 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Departments', key: 'departments', width: 30 },
    { header: 'Reason', key: 'reason', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow({
      row: row.rowNumber,
      name: row.name,
      email: row.email,
      role: row.roleName,
      departments: row.departmentNames.join('; '),
      reason: row.reason,
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
