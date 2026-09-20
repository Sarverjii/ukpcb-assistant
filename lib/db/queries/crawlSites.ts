import { prisma } from '@/lib/db/prisma';

/**
 * Every crawl-tracked site for one pool (the main Knowledge Base's own
 * URL adds, or Admin -> Public Content's — see CrawlSite's own schema.prisma
 * comment for why the two are independent). Backs the Websites view's
 * "depth / last crawled / Process again" row for each domain.
 */
export function listCrawlSites(isPublic: boolean) {
  return prisma.crawlSite.findMany({ where: { isPublic }, orderBy: { domain: 'asc' } });
}

export function getCrawlSite(id: string) {
  return prisma.crawlSite.findUniqueOrThrow({ where: { id } });
}

/**
 * Creates or updates the one CrawlSite row for (domain, isPublic) —
 * "Add from a URL" with crawl enabled calls this every time, including on
 * a domain it's already seen: a later add can legitimately change the
 * depth (and always refreshes rootUrl/lastCrawledAt to the just-run
 * crawl), and @@unique([domain, isPublic]) is exactly what makes this a
 * safe upsert rather than a duplicate-row risk.
 */
export function upsertCrawlSite(input: {
  domain: string;
  rootUrl: string;
  depth: number;
  isPublic: boolean;
  uploadedById: string;
}) {
  return prisma.crawlSite.upsert({
    where: { domain_isPublic: { domain: input.domain, isPublic: input.isPublic } },
    update: { rootUrl: input.rootUrl, depth: input.depth, lastCrawledAt: new Date(), uploadedById: input.uploadedById },
    create: {
      domain: input.domain,
      rootUrl: input.rootUrl,
      depth: input.depth,
      isPublic: input.isPublic,
      uploadedById: input.uploadedById,
    },
  });
}

/** Bumps lastCrawledAt on a "Process again" run — the depth/rootUrl it reused stay whatever they already were. */
export function touchCrawlSite(id: string) {
  return prisma.crawlSite.update({ where: { id }, data: { lastCrawledAt: new Date() } });
}

/** Lets the Websites view's inline depth editor change a site's crawl depth without re-pasting the URL. */
export function updateCrawlSiteDepth(id: string, depth: number) {
  return prisma.crawlSite.update({ where: { id }, data: { depth } });
}
