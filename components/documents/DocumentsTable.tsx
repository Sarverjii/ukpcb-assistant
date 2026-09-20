'use client';

import { useRef, useState, useTransition } from 'react';
import { upload } from '@vercel/blob/client';
import {
  changeDocumentClearanceAction,
  changeDocumentDepartmentsAction,
  changeDocumentLocationsAction,
  deleteDocumentAction,
  replaceDocumentAction,
  finalizeReplaceDocumentAction,
  retryDocumentAction,
} from '@/app/(app)/knowledge-base/actions';
import { Link2, ChevronUp, ChevronDown, ChevronsUpDown, RotateCw } from 'lucide-react';
import { LocalTime } from '@/components/admin/LocalTime';
import { ACCEPTED_EXTENSIONS } from '@/lib/documents/uploadClient';
import { DepartmentCheckboxList } from '@/components/shared/DepartmentCheckboxList';
import { LocationCheckboxList } from '@/components/shared/LocationCheckboxList';
import type { PickableLocation } from '@/components/shared/LocationPicker';
import { ClearanceLevelPicker } from '@/components/shared/ClearanceLevelPicker';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';
import { SingleSelect } from '@/components/shared/SingleSelect';
import { isDailyQuotaError, isRateLimitError } from '@/lib/ai/errors';

export type DocumentRow = {
  id: string;
  name: string;
  uploadedByName: string;
  clearanceLevel: number;
  departments: PickableDepartment[];
  locations: PickableLocation[];
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
  // Null unless status is FAILED — the raw message setDocumentStatus
  // recorded. Checked against isRateLimitError (lib/ai/errors.ts) to
  // decide whether this row's Retry button gets the "provider rate
  // limit" framing or a generic one.
  processingError: string | null;
};
type Role = { hierarchyRank: number; name: string };

type SortKey = 'name' | 'uploadedByName' | 'clearanceLevel' | 'department' | 'location' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';

// Comparable string for the Department column — there's no single scalar
// to sort a multi-department document by, so this uses every assigned
// department's name joined in the same left-to-right order the pills
// themselves render in, which sorts documents sharing a first department
// together the same way visually scanning the column already groups them.
function departmentSortValue(doc: DocumentRow): string {
  return doc.departments.map((d) => d.name).join(', ').toLowerCase();
}

// Same reasoning as departmentSortValue, applied to the Location column.
function locationSortValue(doc: DocumentRow): string {
  return doc.locations.map((l) => l.name).join(', ').toLowerCase();
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
    case 'location':
      return locationSortValue(a).localeCompare(locationSortValue(b));
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
  locations,
  useClientUpload,
}: {
  documents: DocumentRow[];
  roles: Role[];
  departments: PickableDepartment[];
  locations: PickableLocation[];
  useClientUpload: boolean;
}) {
  const [search, setSearch] = useState('');
  const [clearanceFilter, setClearanceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
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
    if (locationFilter !== 'ALL' && !d.locations.some((loc) => loc.id === locationFilter)) return false;
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
        <SingleSelect
          value={clearanceFilter}
          onChange={setClearanceFilter}
          options={[{ value: 'ALL', label: 'All clearances' }, ...roles.map((r) => ({ value: String(r.hierarchyRank), label: r.name }))]}
        />
        <SingleSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'ALL', label: 'All statuses' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'PROCESSING', label: 'Processing' },
            { value: 'READY', label: 'Ready' },
            { value: 'FAILED', label: 'Failed' },
          ]}
        />
        {departments.length > 0 && (
          <SingleSelect
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={[{ value: 'ALL', label: 'All departments' }, ...departments.map((dept) => ({ value: dept.id, label: dept.name }))]}
          />
        )}
        {locations.length > 0 && (
          <SingleSelect
            value={locationFilter}
            onChange={setLocationFilter}
            options={[{ value: 'ALL', label: 'All locations' }, ...locations.map((loc) => ({ value: loc.id, label: loc.name }))]}
          />
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
              <SortableTh label="Location" sortKey="location" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
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
                locations={locations}
                useClientUpload={useClientUpload}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-zinc-400">
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
  locations,
  useClientUpload,
}: {
  doc: DocumentRow;
  roles: Role[];
  departments: PickableDepartment[];
  locations: PickableLocation[];
  useClientUpload: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [departmentIds, setDepartmentIds] = useState(doc.departments.map((d) => d.id));
  const [locationIds, setLocationIds] = useState(doc.locations.map((l) => l.id));
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
    const previous = departmentIds;
    setDepartmentIds(ids);
    setError(null);
    startTransition(async () => {
      const result = await changeDocumentDepartmentsAction(doc.id, ids);
      if (result.error) {
        setError(result.error);
        // Revert the optimistic update — every document must keep at
        // least one department, so a rejected "Clear all" would otherwise
        // leave the picker showing none selected despite the real row
        // still having its old ones, until the next full page load.
        setDepartmentIds(previous);
      }
    });
  }

  function handleLocationsChange(ids: string[]) {
    const previous = locationIds;
    setLocationIds(ids);
    setError(null);
    startTransition(async () => {
      const result = await changeDocumentLocationsAction(doc.id, ids);
      if (result.error) {
        setError(result.error);
        // Revert the optimistic update — every document must keep at
        // least one location, mirroring handleDepartmentsChange above.
        setLocationIds(previous);
      }
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

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const result = await retryDocumentAction(doc.id);
      if (result.error) setError(result.error);
    });
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
      <td className="px-3 py-2 min-w-[16rem]">
        <LocationCheckboxList
          locations={locations}
          selectedIds={locationIds}
          onChange={handleLocationsChange}
          disabled={pending}
        />
      </td>
      <td className="px-3 py-2">
        <StatusPill status={doc.status} ocrPagesTotal={doc.ocrPagesTotal} ocrPagesDone={doc.ocrPagesDone} />
        {doc.status === 'FAILED' && doc.processingError && (
          <p
            className={`mt-1 max-w-[16rem] text-xs ${
              isRateLimitError(doc.processingError)
                ? 'text-amber-600 dark:text-amber-500'
                : 'text-zinc-400 dark:text-zinc-500'
            }`}
            title={doc.processingError}
          >
            {isDailyQuotaError(doc.processingError)
              ? "The AI provider's DAILY quota is exhausted — retrying (even with a new key from the same account) won't help until it resets in ~24h; use a key from a different Google Cloud project to continue now."
              : isRateLimitError(doc.processingError)
                ? 'The AI provider hit a short per-minute limit — retry should work again shortly.'
                : doc.processingError}
          </p>
        )}
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
          {doc.status === 'FAILED' && (
            <button
              type="button"
              disabled={pending}
              onClick={handleRetry}
              className="flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <RotateCw size={11} />
              Retry
            </button>
          )}
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
  // See UploadForm.tsx's matching StatusPill comment — a large document
  // (scanned or not) can take multiple processing passes, so "PROCESSING"
  // alone would look stuck for however long that takes. Deliberately
  // generic ("Page", not "OCR") since these fields now track ordinary
  // text-page progress too, not just OCR'd pages.
  const label =
    status === 'PROCESSING' && ocrPagesTotal
      ? `Page ${Math.min((ocrPagesDone ?? 0) + 1, ocrPagesTotal)}/${ocrPagesTotal}`
      : status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}>
      {label}
    </span>
  );
}
