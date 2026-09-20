import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

// Fetches a public web page server-side for "add a document from a URL" —
// see app/(app)/knowledge-base/actions.ts::addDocumentFromUrlAction. A
// server fetching an admin-supplied URL is a classic SSRF vector (probing
// internal services, cloud metadata endpoints like 169.254.169.254, etc.),
// so every request here is resolved and range-checked BEFORE fetching,
// redirects are refused outright rather than followed, and the response is
// capped in both time and size. This is a reasonable, standard defense for
// a feature gated behind canUploadDocuments (a vetted employee, not the
// public internet) - it is NOT a hardened anti-SSRF gateway: `fetch()`
// re-resolves DNS internally for the actual connection, so a genuinely
// adversarial DNS server could still rebind between our check and the real
// request (TOCTOU). Pinning the connection to the exact IP we validated
// would close that gap but needs a custom Node http.Agent/dns resolver -
// deliberately out of scope here; this blocks the realistic threat
// (an employee accidentally or curiously pointing this at an internal
// address) rather than a determined attacker who already controls DNS for
// a domain they got a trusted employee to paste.
const MAX_BYTES = 10 * 1024 * 1024; // 10MB - a page far larger than that is not a reasonable knowledge-base document
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'UKPCBAssistant-DocumentFetcher/1.0 (+internal knowledge base import)';

// Real government/PSU sites (the exact kind of source this feature exists
// to ingest) not infrequently serve an HTTPS certificate that's expired,
// self-signed, or chained to a CA Node doesn't trust — confirmed directly:
// https://ukpcb.uk.gov.in/ itself, the Board's own site, failed with a
// bare "fetch failed" (a TLS handshake rejection, not a real network
// error) before this existed. Node's global fetch has no per-request way
// to relax certificate verification on its own; passing this undici Agent
// as `dispatcher` on the one fetch call below is the standard way to do
// that scoped to just this request — it does NOT touch Node's default TLS
// behavior, so every other outbound connection in this app (the LLM/
// embedding providers, Vercel Blob, Postgres, NextAuth) still verifies
// certificates normally. This does trade away MITM protection for this
// one fetch — acceptable here because the content being fetched is never
// treated as trusted/executable (it's extracted as plain text, chunked,
// and embedded — see lib/documents/textExtraction.ts), the DNS/private-IP
// SSRF checks above are unaffected, and the feature is already gated
// behind canUploadDocuments (a vetted employee deliberately pasting a URL
// they intend to trust), not open to arbitrary/anonymous input.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export class UrlFetchError extends Error {}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918 private
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 private
    if (a === 192 && b === 168) return true; // RFC1918 private
    if (a === 169 && b === 254) return true; // link-local, includes cloud metadata (169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice('::ffff:'.length);
      if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
    }
    return false;
  }
  return true; // not a recognizable literal - refuse rather than guess
}

export type FetchedPage = {
  html: string;
  title: string | null;
  contentType: 'text/html' | 'text/plain';
};

export async function fetchUrlForIngestion(rawUrl: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UrlFetchError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('Only http:// and https:// URLs are supported.');
  }

  let addresses: string[];
  try {
    addresses = (await dns.lookup(url.hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new UrlFetchError(`Could not resolve "${url.hostname}".`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw new UrlFetchError('This URL resolves to a private or internal address and cannot be imported.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      // @ts-expect-error — `dispatcher` is an undici-specific extension to
      // the standard fetch() options that Node's global fetch (itself
      // undici-backed) honors at runtime; the DOM lib's fetch types don't
      // know about it. See insecureAgent's own comment above.
      dispatcher: insecureAgent,
    });
  } catch (err) {
    throw new UrlFetchError(
      err instanceof Error && err.name === 'AbortError'
        ? 'Timed out waiting for a response.'
        : `Could not reach that URL: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new UrlFetchError(
      `This URL redirects elsewhere (${response.status}) — paste the final destination URL directly instead.`,
    );
  }
  if (!response.ok) {
    throw new UrlFetchError(`The server responded with ${response.status} ${response.statusText}.`);
  }

  const rawContentType = response.headers.get('content-type') ?? '';
  const isPlainText = rawContentType.includes('text/plain');
  if (!rawContentType.includes('text/html') && !isPlainText) {
    throw new UrlFetchError(
      `Unsupported content type: ${rawContentType || 'unknown'}. Only web pages (HTML) are supported — for a PDF or other file, download it and upload it directly instead.`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new UrlFetchError('Could not read the response body.');
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new UrlFetchError(`This page is too large to import (over ${MAX_BYTES / (1024 * 1024)}MB).`);
    }
    parts.push(value);
  }
  const html = Buffer.concat(parts).toString('utf-8');
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || null;

  return { html, title, contentType: isPlainText ? 'text/plain' : 'text/html' };
}

// Regex-based href extraction rather than a real HTML parser — this app
// has no DOM/HTML-parsing dependency yet (officeparser, used for text
// extraction, only ever hands back plain text, never the tag structure),
// and a full parser is more than link discovery needs. Good enough for
// typical marketing/content pages; a page relying entirely on JS-rendered
// navigation (no real <a href> in the served HTML) won't yield links here,
// same limitation any non-JS crawler has.
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
const NON_PAGE_EXTENSION_RE = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|css|js|ico|xml|woff2?|ttf)(\?|#|$)/i;

/**
 * Same-domain links found in `html`, resolved against `baseUrl` and
 * deduped — the candidate set for "and other pages of the same website"
 * (see addDocumentFromUrlAction's crawl mode). Deliberately narrow:
 * same hostname only (never follows off-site links), http/https only,
 * strips hash fragments (an in-page anchor isn't a distinct document),
 * and skips obvious non-page file links (images, stylesheets, PDFs —
 * a PDF is worth having but should be added as a real upload/its own URL,
 * not swept in implicitly by a page crawl).
 */
export function discoverSameDomainLinks(html: string, baseUrl: URL): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(HREF_RE)) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    if (resolved.hostname !== baseUrl.hostname) continue;
    if (NON_PAGE_EXTENSION_RE.test(resolved.pathname)) continue;
    resolved.hash = '';
    found.add(resolved.toString());
  }
  return [...found];
}
