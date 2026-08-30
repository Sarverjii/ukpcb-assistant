import { readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

const BASE = 'https://ask-evon.onrender.com';
const DOCS_DIR = '/home/sarthverma/Evon/Ask Evon/EVON_Documents';

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function cleanName(file) {
  const ext = extname(file);
  let base = file.slice(0, -ext.length);
  return base.replace(/^Copy of\s+/i, '').trim();
}

function parseSetCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookies = parseSetCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email: 'cxo@evon.com', password: 'Password123!', redirect: 'false' });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookies }, body, redirect: 'manual',
  });
  const loginCookies = parseSetCookies(loginRes);
  const merged = new Map();
  for (const part of `${csrfCookies}; ${loginCookies}`.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) merged.set(k, v.join('='));
  }
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function uploadWithRetry(cookie, file, name, rank, attempt = 0) {
  const ext = extname(file).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  const buffer = readFileSync(join(DOCS_DIR, file));
  const form = new FormData();
  form.set('file', new Blob([buffer], { type: mimeType }), file);
  form.set('name', name);
  form.set('clearanceLevel', String(rank));

  const res = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  if (res.status === 429 && attempt < 5) {
    const wait = 5000 * (attempt + 1);
    console.log(`  429, backing off ${wait}ms...`);
    await new Promise((r) => setTimeout(r, wait));
    return uploadWithRetry(cookie, file, name, rank, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function waitForStatus(cookie, id, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/api/documents/${id}/status`, { headers: { Cookie: cookie } });
    const data = await res.json().catch(() => ({}));
    if (data.status === 'READY' || data.status === 'FAILED') return data.status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'TIMEOUT';
}

async function main() {
  const classification = JSON.parse(readFileSync('/tmp/classification.json', 'utf-8'));
  const cookie = await login();
  console.log(`logged in, uploading ${classification.length} documents to ${BASE} (throttled, one at a time)`);

  const results = [];
  for (const { file, rank } of classification) {
    const name = cleanName(file);
    const uploadResult = await uploadWithRetry(cookie, file, name, rank);
    if (!uploadResult.ok) {
      console.log(`FAIL [rank ${rank}] ${name} -> upload ${uploadResult.status} ${JSON.stringify(uploadResult.data)}`);
      results.push({ file, name, rank, ok: false, stage: 'upload', status: uploadResult.status });
      continue;
    }
    const id = uploadResult.data.id;
    const finalStatus = await waitForStatus(cookie, id);
    const ok = finalStatus === 'READY';
    console.log(`${ok ? 'OK  ' : 'FAIL'} [rank ${rank}] ${name} -> ${finalStatus}`);
    results.push({ file, name, rank, id, ok, status: finalStatus });
    // Small breather between documents regardless of outcome.
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n--- summary ---');
  console.log('total:', results.length, 'ok:', results.filter((r) => r.ok).length, 'failed:', results.filter((r) => !r.ok).length);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('FAILURES:', JSON.stringify(failed, null, 2));

  writeFileSync('/tmp/upload-results-render2.json', JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
