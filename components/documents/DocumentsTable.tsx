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
import { Link2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { LocalTime } from '@/components/admin/LocalTime';
import { ACCEPTED_EXTENSIONS } from '@/lib/documents/uploadClient';
import { DepartmentCheckboxList } from '@/components/shared/DepartmentCheckboxList';
import { ClearanceLevelPicker } from '@/components/shared/ClearanceLevelPicker';
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
  // Set only for a scanned PDF mid-OCR — see Document.ocrPagesTotal's own
  // schema comment. Both null for every ordinary document.
  ocrPagesTotal: number | null;
  ocrPagesDone: number | null;
};
type Role = { hierarchyRank: number; name: string };

type SortKey = 'name' | 'uploadedByName' | 'clearanceLevel' | 'department' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';

// Comparable string for the Department column — there's no single scalar
// to sort a multi-department document by, so this uses every assigned
// department's name joined in the same left-to-right order the pills
// themselves render in, which sorts documents sharing a first department
// together the same way visually scanning the column already groups them.
function departmentSortValue(doc: DocumentRow): string {
  return doc.departments.map((d) => d.name).join(', ').toLowerCase();
}

function compareDocuments(a: DocumentRow, b: DocumentRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'uploadedByName':
      return a.uploadedByName.localeCompare(b.uploadedByName);
    case 'clearanceLevel':
      return a.clearanceLevel - b.clearanceLevel;
    case 'department':
      return departmentSortValue(a).localeCompare(departmentSortValue(b));
    case 'status':
      return a.status.localeCompare(b.status);
    case 'updatedAt':
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  }
}

/**
 * One clickable column header — click cycles ascending → descending
 * (clicking a different column starts it fresh at ascending). Modeled
 * as a plain button rather than making the whole <th> clickable so the
 * larger hit target and focus outline both land where the click actually
 * does something.
 */
function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = sortKey === activeKey;
  return (
    <th className={`px-3 py-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 uppercase tracking-wide hover:text-zinc-700 dark:hover:text-zinc-300 ${
          isActive ? 'text-zinc-700 dark:text-zinc-200' : ''
        }`}
      >
        {label}
        {isActive ? (
          dir === 'asc' ? (
            <ChevronUp size={12} className="shrink-0" />
          ) : (
            <ChevronDown size={12} className="shrink-0" />
          )
        ) : (
          <ChevronsUpDown size={12} className="shrink-0 opacity-40" />
        )}
      </button>
    </th>
  );
}

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
  // Defaults to most-recently-updated first — the same order the table
  // effectively had before sorting existed (documents arrive newest-first
  // from the server), so adding this doesn't change what a first-time
  // visit to this page looks like.
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

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
  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareDocuments(a, b, sortKey);
    return sortDir === 'asc' ? cmp : -cmp;
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
              <SortableTh label="Document" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh label="Uploaded by" sortKey="uploadedByName" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh label="Clearance" sortKey="clearanceLevel" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh label="Department" sortKey="department" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh label="Updated" sortKey="updatedAt" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <th className="sticky right-0 bg-zinc-50 px-3 py-2 shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.15)] dark:bg-zinc-900">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
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

  const [clearanceLevel, setClearanceLevelState] = useState(doc.clearanceLevel);

  function handleClearanceChange(level: number) {
    setClearanceLevelState(level);
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
      <td className="px-3 py-2 min-w-[14rem]">
        <ClearanceLevelPicker roles={roles} value={clearanceLevel} onChange={handleClearanceChange} disabled={pending} />
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
        <StatusPill status={doc.status} ocrPagesTotal={doc.ocrPagesTotal} ocrPagesDone={doc.ocrPagesDone} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
        <LocalTime iso={doc.updatedAt} />
      </td>
      <td className="sticky right-0 bg-white px-3 py-2 shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.15)] dark:bg-zinc-900">
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

function StatusPill({
  status,
  ocrPagesTotal,
  ocrPagesDone,
}: {
  status: string;
  ocrPagesTotal?: number | null;
  ocrPagesDone?: number | null;
}) {
  // See UploadForm.tsx's matching StatusPill comment — a scanned PDF can
  // take multiple processing passes, so "PROCESSING" alone would look
  // stuck for however long that takes.
  const label =
    status === 'PROCESSING' && ocrPagesTotal
      ? `OCR ${Math.min((ocrPagesDone ?? 0) + 1, ocrPagesTotal)}/${ocrPagesTotal}`
      : status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}>
      {label}
    </span>
  );
}
