'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadForm } from '@/components/documents/UploadForm';
import { DocumentsTable, type DocumentRow } from '@/components/documents/DocumentsTable';

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
 * The only piece of state this owns itself is whether an upload is
 * currently running, so the document list below can refresh live while
 * one is — UploadForm already tracks its own per-file progress
 * internally; this just needs to know when to pull the server's document
 * list (router.refresh()) so a newly-created row (and its
 * PENDING → PROCESSING → READY progression) shows up here without a
 * manual reload.
 */
export function KnowledgeBase({
  roles,
  documents,
  useClientUpload,
  uploadMaxMb,
}: {
  roles: Role[];
  documents: DocumentRow[];
  useClientUpload: boolean;
  uploadMaxMb: number;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

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
          {roles.length > 0 ? ` up to ${roles[roles.length - 1]?.name ?? roles[0].name}.` : ' contact an admin for access.'}
        </p>
        <div className="mt-4">
          <UploadForm
            roles={roles}
            useClientUpload={useClientUpload}
            uploadMaxMb={uploadMaxMb}
            onUploadingChange={setUploading}
          />
        </div>
      </section>

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
          <DocumentsTable documents={documents} roles={roles} useClientUpload={useClientUpload} />
        </div>
      </section>
    </div>
  );
}
