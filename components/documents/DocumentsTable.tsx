'use client';

import { useRef, useState, useTransition } from 'react';
import { upload } from '@vercel/blob/client';
import {
  changeDocumentClearanceAction,
  changeDocumentDepartmentsAction,
  deleteDocumentAction,
  replaceDocumentAction,
  finalizeReplaceDocumentAction,
} from '@/app/(app)/knowledge-base/actions';
import { Link2 } from 'lucide-react';
import { LocalTime } from '@/components/admin/LocalTime';
import { ACCEPTED_EXTENSIONS } from '@/lib/documents/uploadClient';
import { DepartmentCheckboxList } from '@/components/shared/DepartmentCheckboxList';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

export type DocumentRow = {
  id: string;
  name: string;
  uploadedByName: string;
  clearanceLevel: number;
  departments: PickableDepartment[];
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  // Set only for a document added by pasting a URL — see
  // addDocumentFromUrlAction's own comment.
  sourceUrl: string | null;
};
type Role = { hierarchyRank: number; name: string };

export function DocumentsTable({
  documents,
  roles,
  departments,
  useClientUpload,
}: {
  documents: DocumentRow[];
  roles: Role[];
  departments: PickableDepartment[];
  useClientUpload: boolean;
}) {
  const [search, setSearch] = useState('');
  const [clearanceFilter, setClearanceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');

  // Filtered client-side for the same reason as EmployeesTable: the corpus
  // (dozens to low hundreds of documents) is already fetched for this page,
  // and every extra DB round trip on this deployment costs real cross-
  // region latency — see vercel.json.
  const q = search.trim().toLowerCase();
  const filtered = documents.filter((d) => {
    if (clearanceFilter !== 'ALL' && String(d.clearanceLevel) !== clearanceFilter) return false;
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (departmentFilter !== 'ALL' && !d.departments.some((dept) => dept.id === departmentFilter)) return false;
    if (q && !d.name.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by document name…"
          className="w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={clearanceFilter}
          onChange={(e) => setClearanceFilter(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All clearances</option>
          {roles.map((r) => (
            <option key={r.hierarchyRank} value={r.hierarchyRank}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PROCESSING">Processing</option>
          <option value="READY">Ready</option>
          <option value="FAILED">Failed</option>
        </select>
        {departments.length > 0 && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
          >
            <option value="ALL">All departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-zinc-400">
          {filtered.length} of {documents.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Document</th>
              <th className="px-3 py-2">Uploaded by</th>
              <th className="px-3 py-2">Clearance</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                roles={roles}
                departments={departments}
                useClientUpload={useClientUpload}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-zinc-400">
                  {documents.length === 0 ? 'No documents yet.' : 'No documents match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  roles,
  departments,
  useClientUpload,
}: {
  doc: DocumentRow;
  roles: Role[];
  departments: PickableDepartment[];
  useClientUpload: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [departmentIds, setDepartmentIds] = useState(doc.departments.map((d) => d.id));
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClearanceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const level = Number(e.target.value);
    setError(null);
    startTransition(async () => {
      const result = await changeDocumentClearanceAction(doc.id, level);
      if (result.error) setError(result.error);
    });
  }

  function handleDepartmentsChange(ids: string[]) {
    setDepartmentIds(ids);
    setError(null);
    startTransition(async () => {
      const result = await changeDocumentDepartmentsAction(doc.id, ids);
      if (result.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteDocumentAction(doc.id);
      if (result.error) setError(result.error);
    });
  }

  function handleReplacePick() {
    fileInputRef.current?.click();
  }

  async function replaceViaBlob(file: File): Promise<{ error?: string }> {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const pathname = `documents/${crypto.randomUUID()}${ext}`;
    try {
      const blob = await upload(pathname, file, {
        access: 'private',
        handleUploadUrl: '/api/documents/blob-upload-token',
        clientPayload: JSON.stringify({ clearanceLevel: doc.clearanceLevel }),
      });
      return finalizeReplaceDocumentAction(doc.id, blob.pathname, file.type, file.size);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Upload failed.' };
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    startTransition(async () => {
      // See UploadForm.tsx's uploadViaBlob for why this branch exists:
      // Vercel rejects request bodies above ~4.5MB, so a large replacement
      // file has to go straight from the browser to Vercel Blob rather
      // than through this app's own server.
      let result: { error?: string };
      if (useClientUpload) {
        result = await replaceViaBlob(file);
      } else {
        const formData = new FormData();
        formData.set('documentId', doc.id);
        formData.set('file', file);
        result = await replaceDocumentAction(formData);
      }
      if (result.error) setError(result.error);
      e.target.value = '';
    });
  }

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800 align-top">
      <td className="px-3 py-2">
        {doc.name}
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={doc.sourceUrl}
            className="ml-1.5 inline-flex items-center align-middle text-zinc-400 hover:text-brand-600"
          >
            <Link2 size={12} />
          </a>
        )}
      </td>
      <td className="px-3 py-2">{doc.uploadedByName}</td>
      <td className="px-3 py-2">
        <select
          defaultValue={doc.clearanceLevel}
          disabled={pending}
          onChange={handleClearanceChange}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs disabled:opacity-50"
        >
          {roles.map((r) => (
            <option key={r.hierarchyRank} value={r.hierarchyRank}>
              {r.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 min-w-[26rem]">
        <DepartmentCheckboxList
          departments={departments}
          selectedIds={departmentIds}
          onChange={handleDepartmentsChange}
          disabled={pending}
        />
      </td>
      <td className="px-3 py-2">
        <StatusPill status={doc.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
        <LocalTime iso={doc.updatedAt} />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/documents/${doc.id}/download`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Download
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={handleReplacePick}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Replace
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
              confirmingDelete
                ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {confirmingDelete ? 'Confirm delete?' : 'Delete'}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-zinc-100 text-zinc-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}>
      {status}
    </span>
  );
}
