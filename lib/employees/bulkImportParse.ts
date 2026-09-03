import Papa from 'papaparse';
import ExcelJS from 'exceljs';

// Fixed column template — case-insensitive header match. "role" is the
// role's NAME (e.g. "Manager"), not an id, since a spreadsheet author has
// no reason to know internal role ids. "departments" is semicolon-
// separated (e.g. "Engineering; QA") so a flat spreadsheet cell can name
// more than one — an employee may belong to any number of departments.
const REQUIRED_HEADERS = ['name', 'email', 'role'] as const;

export type BulkImportRow = {
  rowNumber: number; // 1-based, matches what a spreadsheet author would count (header excluded)
  name: string;
  email: string;
  roleName: string;
  departmentNames: string[];
};

export type BulkImportParseResult =
  | { rows: BulkImportRow[]; error?: undefined }
  | { rows?: undefined; error: string };

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function rowsFromRecords(records: Record<string, string>[]): BulkImportParseResult {
  if (records.length === 0) return { error: 'The file has no data rows.' };

  const headerKeys = Object.keys(records[0]).map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !headerKeys.includes(h));
  if (missing.length > 0) {
    return { error: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.` };
  }

  const rows: BulkImportRow[] = records.map((record, i) => {
    const byKey = (want: string) => {
      const key = Object.keys(record).find((k) => normalizeHeader(k) === want);
      return key ? String(record[key] ?? '').trim() : '';
    };
    return {
      rowNumber: i + 1,
      name: byKey('name'),
      email: byKey('email').toLowerCase(),
      roleName: byKey('role'),
      departmentNames: byKey('department') || byKey('departments')
        ? (byKey('department') || byKey('departments')).split(';').map((d) => d.trim()).filter(Boolean)
        : [],
    };
  });

  return { rows };
}

function parseCsv(text: string): BulkImportParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    return { error: `Could not parse CSV: ${parsed.errors[0].message}` };
  }
  return rowsFromRecords(parsed.data);
}

async function parseXlsx(buffer: Buffer): Promise<BulkImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: 'The workbook has no sheets.' };

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map((v) => (v == null ? '' : String(v)));
    if (rowNumber === 1) {
      headers = values;
      return;
    }
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? '';
    });
    // Skip a fully blank row (trailing empty rows are common in exported sheets).
    if (Object.values(record).some((v) => v !== '')) rows.push(record);
  });

  return rowsFromRecords(rows);
}

/**
 * Parses an uploaded CSV or XLSX file into structured rows for bulk
 * employee import. Per-row validation (does the role name resolve, is the
 * email already taken) happens in bulkImportEmployeesAction, not here —
 * this only handles "can the file even be read into rows".
 */
export async function parseBulkImportFile(fileName: string, buffer: Buffer): Promise<BulkImportParseResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseCsv(buffer.toString('utf-8'));
  }
  if (lower.endsWith('.xlsx')) {
    return parseXlsx(buffer);
  }
  return { error: 'Unsupported file type — upload a .csv or .xlsx file.' };
}
