// Split out from lib/documents/siteCrawl.ts specifically so client
// components (UrlUploadForm.tsx, PublicContentManager.tsx) can import
// MAX_CRAWL_DEPTH for their depth picker without pulling siteCrawl.ts's
// own import chain — fetchUrlForIngestion/discoverSameDomainLinks from
// lib/documents/urlFetch.ts, which uses node:dns/promises and node:net —
// into the browser bundle. Confirmed directly: Turbopack failed the whole
// production build ("the chunking context (unknown) does not support
// external modules (request: node:dns/promises)") the moment a client
// component imported a named export from siteCrawl.ts, even a plain
// number never touched at runtime beyond its value. This file has zero
// imports of its own, so it can never cause that.

// Hard per-request cap on how many NEW pages get fetched and saved in a
// single crawl invocation (a fresh "Add page" or a "Process again"
// click) — see siteCrawl.ts's own comment for the full reasoning (this is
// the real rate-limit/timeout control, not `depth`).
export const MAX_NEW_PAGES_PER_CRAWL = 10;

// How many link-hops a crawl is allowed to ask for — see siteCrawl.ts's
// own comment for why a generous ceiling here is safe.
export const MAX_CRAWL_DEPTH = 6;
