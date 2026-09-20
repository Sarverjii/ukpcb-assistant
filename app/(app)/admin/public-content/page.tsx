import { listPublicDocuments } from '@/lib/db/queries/documents';
import { listCrawlSites } from '@/lib/db/queries/crawlSites';
import { PublicContentManager } from '@/components/admin/PublicContentManager';

// Admin-only access is already enforced by the parent layout
// (app/(app)/admin/layout.tsx) — no separate check needed here, same as
// every other admin subpage.
export default async function PublicContentPage() {
  const [documents, crawlSites] = await Promise.all([listPublicDocuments(), listCrawlSites(true)]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The only documents and pages the unauthenticated public chat (the home page) can see — and,
        because every employee&apos;s own chat also always includes them, the one thing every visitor,
        logged in or not, is guaranteed to see regardless of their clearance, department, or location.
        Nothing added here needs any of those — it&apos;s public by design.
      </p>
      <PublicContentManager
        documents={documents.map((d) => ({
          id: d.id,
          name: d.name,
          sourceUrl: d.sourceUrl,
          status: d.status,
          fileSizeBytes: d.fileSizeBytes,
          createdAt: d.createdAt.toISOString(),
          processingError: d.processingError,
        }))}
        crawlSites={crawlSites.map((s) => ({
          id: s.id,
          domain: s.domain,
          depth: s.depth,
          lastCrawledAt: s.lastCrawledAt.toISOString(),
        }))}
      />
    </div>
  );
}
