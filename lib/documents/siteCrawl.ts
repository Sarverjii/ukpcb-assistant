import { fetchUrlForIngestion, discoverSameDomainLinks, type FetchedPage } from '@/lib/documents/urlFetch';
import { MAX_NEW_PAGES_PER_CRAWL } from '@/lib/documents/crawlConstants';

// Re-exported so existing server-side imports of these two constants FROM
// this file keep working — but a CLIENT component (UrlUploadForm.tsx,
// PublicContentManager.tsx) must import them from crawlConstants.ts
// directly instead, never from here: this file pulls in
// fetchUrlForIngestion/discoverSameDomainLinks (node:dns/promises,
// node:net), which crawlConstants.ts's own comment explains breaks the
// production build the moment a client component imports anything from
// this module, even an unused-at-runtime constant.
export { MAX_NEW_PAGES_PER_CRAWL, MAX_CRAWL_DEPTH } from '@/lib/documents/crawlConstants';

export type CrawlResult = {
  // Ids of every document actually created THIS run, in discovery order —
  // an empty array is a legitimate, non-error outcome (every reachable
  // page was already ingested).
  documentIds: string[];
};

/**
 * The shared breadth-first crawl engine behind both "Add from a URL" in
 * the main Knowledge Base and Admin -> Public Content's own URL form —
 * one implementation, reused via `saveDocument` for the one thing that
 * genuinely differs between the two callers (a Knowledge Base page is
 * tagged with clearance/department/location; a public page is tagged
 * `isPublic` with none of those — see their own action files).
 *
 * Always fetches `rootUrl` fresh (to discover its current outbound
 * links), regardless of whether it's already been ingested — but only
 * calls `saveDocument` for it when `alreadySeenUrls` doesn't already
 * contain it. From there, walks same-domain links breadth-first, hop by
 * hop, skipping anything already in `alreadySeenUrls` (a page already
 * ingested — by ANY previous run, not just this one — is never re-fetched
 * or re-saved), until either `depth` hops are exhausted, the frontier runs
 * dry, or `maxNewPages` new pages have been saved this run, whichever
 * comes first. A page that fails to fetch (dead link, blocked, non-HTML,
 * a bad TLS chain already handled upstream in fetchUrlForIngestion) is
 * just skipped — one bad link on a large site shouldn't fail the whole
 * crawl when most pages come through fine.
 *
 * Deliberately stateless beyond its arguments: it doesn't know about
 * CrawlSite, Document, or which pool (public/private) it's running
 * for — the caller owns persisting whatever bookkeeping (a CrawlSite row,
 * the saved Document rows themselves) it needs for next time.
 */
export async function crawlSite(params: {
  rootUrl: string;
  depth: number;
  alreadySeenUrls: ReadonlySet<string>;
  maxNewPages?: number;
  saveDocument: (page: FetchedPage, url: string) => Promise<string>;
}): Promise<CrawlResult> {
  const { rootUrl, depth, alreadySeenUrls, saveDocument } = params;
  const maxNewPages = params.maxNewPages ?? MAX_NEW_PAGES_PER_CRAWL;

  const rootUrlObj = new URL(rootUrl); // caller is expected to have already validated this once
  const rootPage = await fetchUrlForIngestion(rootUrl);

  const documentIds: string[] = [];
  const seen = new Set(alreadySeenUrls);
  seen.add(rootUrl);

  if (!alreadySeenUrls.has(rootUrl)) {
    documentIds.push(await saveDocument(rootPage, rootUrl));
  }

  if (rootPage.contentType === 'text/html' && depth > 0) {
    let frontier = discoverSameDomainLinks(rootPage.html, rootUrlObj).filter((l) => !seen.has(l));
    for (const l of frontier) seen.add(l);

    for (let hop = 0; hop < depth && frontier.length > 0 && documentIds.length < maxNewPages; hop++) {
      const nextFrontier: string[] = [];
      for (const link of frontier) {
        if (documentIds.length >= maxNewPages) break;
        try {
          const linkedPage = await fetchUrlForIngestion(link);
          documentIds.push(await saveDocument(linkedPage, link));
          if (linkedPage.contentType === 'text/html') {
            for (const deeper of discoverSameDomainLinks(linkedPage.html, rootUrlObj)) {
              if (!seen.has(deeper)) {
                seen.add(deeper);
                nextFrontier.push(deeper);
              }
            }
          }
        } catch (err) {
          console.warn('[crawl] skipped a page', link, err instanceof Error ? err.message : err);
        }
      }
      frontier = nextFrontier;
    }
  }

  return { documentIds };
}
