'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadForm } from '@/components/documents/UploadForm';
import { UrlUploadForm } from '@/components/documents/UrlUploadForm';
import { WebsiteGroups } from '@/components/documents/WebsiteGroups';
import { DocumentsTable, type DocumentRow } from '@/components/documents/DocumentsTable';
import { useUploadQueue } from '@/components/documents/UploadQueueContext';
import type { PickableDepartment } from '@/components/shared/DepartmentPicker';

type Role = { hierarchyRank: number; name: string };

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

  useEffect(() => {
    if (!uploading) return;
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [uploading, router]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Upload documents</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every document needs a clearance level. You can only assign one at or below your own —
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
        <div className="mt-3">
          <UrlUploadForm roles={roles} />
        </div>
      </section>

      <WebsiteGroups documents={documents} />

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Your documents</h2>
          {uploading && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              Updating…
            </span>
          )}
        </div>
        <div className="mt-4">
          <DocumentsTable
            documents={documents}
            roles={roles}
            departments={departments}
            useClientUpload={useClientUpload}
          />
        </div>
      </section>
    </div>
  );
}
