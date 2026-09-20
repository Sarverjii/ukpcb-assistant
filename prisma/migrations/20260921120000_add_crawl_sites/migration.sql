-- Tracks per-domain crawl config/state so "Process again" can re-run a
-- site's crawl without the admin re-pasting the URL, and so the Websites
-- view can show each site's configured depth and last-crawled time. See
-- CrawlSite's own schema.prisma comment for why this deliberately does
-- NOT persist a frontier/queue of undiscovered pages.

CREATE TABLE "CrawlSite" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "rootUrl" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "lastCrawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlSite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrawlSite_domain_isPublic_key" ON "CrawlSite"("domain", "isPublic");
CREATE INDEX "CrawlSite_isPublic_idx" ON "CrawlSite"("isPublic");

ALTER TABLE "CrawlSite" ADD CONSTRAINT "CrawlSite_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
