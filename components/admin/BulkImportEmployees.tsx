'use client';

import { useRef, useState } from 'react';
import { bulkImportEmployeesAction, type BulkImportRowResult } from '@/app/(app)/admin/employees/actions';
import { ReauthDialog } from '@/components/admin/ReauthDialog';

type Role = { id: string; name: string };

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

export function BulkImportEmployees({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [showReauth, setShowReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkImportRowResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function confirmImport(password: string) {
    if (!file) return { error: 'Choose a file first.' };
    const formData = new FormData();
    formData.set('file', file);
    formData.set('password', password);

    const result = await bulkImportEmployeesAction(formData);
    if (result.error || !result.results) return { error: result.error ?? 'Import failed.' };

    setResults(result.results);
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
            Columns: <code className="font-mono">name, email, role, department</code> (department optional).
            Role must match an existing role name{roles.length > 0 ? ` — e.g. "${roles[0].name}"` : ''}.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
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
                        ) : (
                          <span className="text-red-600 dark:text-red-400">{r.message}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
