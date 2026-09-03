'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Files, Globe } from 'lucide-react';
import { UploadForm } from '@/components/documents/UploadForm';
import { UrlUploadForm } from '@/components/documents/UrlUploadForm';
import { WebsiteGroups } from '@/components/documents/WebsiteGroups';
import { DocumentsTable, type DocumentRow } from '@/components/documents/DocumentsTable';
import { useUploadQueue } from '@/components/documents/UploadQueueContext';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

type Role = { hierarchyRank: number; name: string };
type TabId = 'upload' | 'documents' | 'websites';

/**
 * Combines uploading and managing documents into one page (previously
 * split across a standalone "Upload Documents" page and the admin
 * dashboard's separate "Documents" tab) — a non-admin document manager now
 * has one place for the whole job, and a document's processing status
 * stays visible here (backed by the real Document row, not local upload-
 * session state) no matter when you come back to look, including after
 * navigating away mid-upload and back.
 *
 * "Is an upload currently running" itself comes from two places: bulk
 * batches live in the shared upload queue (UploadQueueContext, mounted at
 * the app root so it survives navigating away and back), while a single
 * upload's progress stays local to UploadForm and is reported up via
 * onUploadingChange. Either one running should keep the document list
 * below refreshing live (router.refresh()) so a newly-created row (and
 * its PENDING → PROCESSING → READY progression) shows up here without a
 * manual reload.
 *
 * Three tabs — Upload / Documents / Websites — styled after AdminNav's
 * underlined tab bar, but client-side (`useState`, not `usePathname`):
 * everything here lives under one URL and shares one server-fetched
 * `documents` prop, so there's no route to switch on the way admin's
 * sections each have their own page. Uploaded files and pasted URLs are a
 * clean split of the same `documents` array (by `sourceUrl`), not two
 * separate fetches — a website page is never a row in the file table
 * (explicit request: it has no clearance/department controls to show
 * there anyway, since it's always public — see UrlUploadForm's comment),
 * and a real upload never shows up under Websites.
 */
export function KnowledgeBase({
  roles,
  documents,
  departments,
  useClientUpload,
  uploadMaxMb,
}: {
  roles: Role[];
  documents: DocumentRow[];
  departments: PickableDepartment[];
  useClientUpload: boolean;
  uploadMaxMb: number;
}) {
  const router = useRouter();
  const queue = useUploadQueue();
  const [singleUploading, setSingleUploading] = useState(false);
  const uploading = queue.isRunning || singleUploading;
  const [tab, setTab] = useState<TabId>('upload');

  const { fileDocuments, websiteDocuments } = useMemo(() => {
    const files: DocumentRow[] = [];
    const sites: DocumentRow[] = [];
    for (const d of documents) (d.sourceUrl ? sites : files).push(d);
    return { fileDocuments: files, websiteDocuments: sites };
  }, [documents]);

  useEffect(() => {
    if (!uploading) return;
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [uploading, router]);

  const tabs: { id: TabId; label: string; icon: typeof Upload; count?: number }[] = [
    { id: 'upload', label: 'Add content', icon: Upload },
    { id: 'documents', label: 'Documents', icon: Files, count: fileDocuments.length },
    { id: 'websites', label: 'Websites', icon: Globe, count: websiteDocuments.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((t) => {
            const isActive = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-400'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <t.icon size={15} />
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      isActive
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {uploading && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            Updating…
          </span>
        )}
      </div>

      {tab === 'upload' && (
        <section className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Upload a file</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Every uploaded document needs a clearance level. You can only assign one at or below
              your own —
              {/* `roles` is availableRoles from the page, sourced from listRolesByRank()'s
                  DESCENDING hierarchyRank order — roles[0] is the highest-ranked (i.e. the
                  viewer's own) role still in the filtered list, not roles[roles.length - 1]. */}
              {roles.length > 0 ? ` up to ${roles[0].name}.` : ' contact an admin for access.'}
            </p>
            <div className="mt-4">
              <UploadForm
                roles={roles}
                departments={departments}
                useClientUpload={useClientUpload}
                uploadMaxMb={uploadMaxMb}
                onUploadingChange={setSingleUploading}
              />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Add from a website</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Paste a page&apos;s URL instead of a file. It&apos;s always visible to everyone,
              regardless of clearance or department — see the Websites tab.
            </p>
            <div className="mt-4">
              <UrlUploadForm />
            </div>
          </div>
        </section>
      )}

      {tab === 'documents' && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Your documents</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Uploaded files only — pages added from a website live in the Websites tab, always
            public and with nothing to configure here.
          </p>
          <div className="mt-4">
            <DocumentsTable
              documents={fileDocuments}
              roles={roles}
              departments={departments}
              useClientUpload={useClientUpload}
            />
          </div>
        </section>
      )}

      {tab === 'websites' && (
        <section>
          {websiteDocuments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-10 text-center">
              <Globe size={22} className="mx-auto text-zinc-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                No websites added yet. Use the Add content tab to paste a URL.
              </p>
            </div>
          ) : (
            <WebsiteGroups documents={websiteDocuments} />
          )}
        </section>
      )}
    </div>
  );
}
