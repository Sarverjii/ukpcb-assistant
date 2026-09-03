'use client';

import { useRef, useState } from 'react';
import { bulkImportEmployeesAction, type BulkImportRowResult } from '@/app/(app)/admin/employees/actions';
import { ReauthDialog } from '@/components/admin/ReauthDialog';
import { LocalTime } from '@/components/admin/LocalTime';

type Role = { id: string; name: string };

export type ImportBatchRow = {
  id: string;
  fileName: string;
  uploadedByName: string;
  uploadedAt: string;
  rowCount: number;
  successCount: number;
  failureCount: number;
  hasErrorReport: boolean;
};

// Same Blob + createObjectURL + synthetic <a download> pattern as
// components/chat/exportConversation.ts, just generic enough to not import
// chat-specific types into the admin surface.
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BulkImportEmployees({ roles, batches }: { roles: Role[]; batches: ImportBatchRow[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [showReauth, setShowReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkImportRowResult[] | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function confirmImport(password: string) {
    if (!file) return { error: 'Choose a file first.' };
    const formData = new FormData();
    formData.set('file', file);
    formData.set('password', password);

    const result = await bulkImportEmployeesAction(formData);
    if (result.error || !result.results) return { error: result.error ?? 'Import failed.' };

    setResults(result.results);
    setBatchId(result.batchId);
    if (result.emailsDocument) {
      downloadTextFile(`employee-welcome-emails-${new Date().toISOString().slice(0, 10)}.txt`, result.emailsDocument);
    }
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    return {};
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        {open ? '− Hide' : '+ Bulk import (CSV/XLSX)'}
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Columns: <code className="font-mono">name, email, role, departments</code> (departments
            optional — separate multiple with a semicolon, e.g. &quot;Engineering; QA&quot;). Role and
            each department must match an existing name
            {roles.length > 0 ? ` — e.g. "${roles[0].name}"` : ''}. An email that already exists is
            skipped, not an error — re-uploading a growing sheet only creates new employees. Every
            upload is saved and viewable again from Import history below.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-600 dark:text-zinc-300 file:mr-3 file:rounded-md file:border file:border-zinc-300 dark:file:border-zinc-700 file:bg-white dark:file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 dark:file:text-zinc-200 hover:file:bg-zinc-50 dark:hover:file:bg-zinc-700 file:cursor-pointer"
          />
          <div>
            <button
              type="button"
              disabled={!file}
              onClick={() => {
                setError(null);
                setShowReauth(true);
              }}
              className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
            >
              Import employees
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}

          {results && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {results.filter((r) => r.status === 'created').length} created,{' '}
                  {results.filter((r) => r.status === 'skipped').length} skipped (already existed),{' '}
                  {results.filter((r) => r.status === 'error').length} failed.
                </p>
                {batchId && results.some((r) => r.status !== 'created') && (
                  <a
                    href={`/api/admin/employee-imports/${batchId}/errors`}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Download failed-rows report (XLSX)
                  </a>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.email || '—'}</td>
                        <td className="px-3 py-2">
                          {r.status === 'created' ? (
                            <span className="text-emerald-700 dark:text-emerald-400">Created</span>
                          ) : r.status === 'skipped' ? (
                            <span className="text-zinc-500 dark:text-zinc-400">{r.message}</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">{r.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {batches.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Import history</p>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Uploaded by</th>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">Downloads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2">{b.fileName}</td>
                        <td className="px-3 py-2">{b.uploadedByName}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                          <LocalTime iso={b.uploadedAt} />
                        </td>
                        <td className="px-3 py-2">
                          {b.successCount} created
                          {b.failureCount > 0 && (
                            <span className="text-red-500"> · {b.failureCount} not added</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={`/api/admin/employee-imports/${b.id}/file`}
                              className="text-xs font-medium text-brand-600 hover:underline"
                            >
                              Original file
                            </a>
                            {b.hasErrorReport && (
                              <a
                                href={`/api/admin/employee-imports/${b.id}/errors`}
                                className="text-xs font-medium text-brand-600 hover:underline"
                              >
                                Failed rows
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showReauth && (
        <ReauthDialog
          title="Import employees"
          description="Creates one account per valid row and downloads a file with the welcome email for each."
          confirmLabel="Import"
          onConfirm={async (password) => {
            const result = await confirmImport(password);
            if (result.error) setError(result.error);
            return result;
          }}
          onClose={() => setShowReauth(false)}
        />
      )}
    </div>
  );
}
