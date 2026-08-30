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
  base = base.replace(/^Copy of\s+/i, '').trim();
  return base;
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

async function main() {
  const classification = JSON.parse(readFileSync('/tmp/classification.json', 'utf-8'));
  const cookie = await login();
  console.log(`logged in, uploading ${classification.length} documents to ${BASE}`);

  const results = [];
  for (const { file, rank } of classification) {
    const ext = extname(file).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    const name = cleanName(file);
    const buffer = readFileSync(join(DOCS_DIR, file));
    const form = new FormData();
    form.set('file', new Blob([buffer], { type: mimeType }), file);
    form.set('name', name);
    form.set('clearanceLevel', String(rank));

    const res = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    const data = await res.json().catch(() => ({}));
    results.push({ file, name, rank, ok: res.ok, id: data.id, error: data.error });
    console.log(res.ok ? `OK   [rank ${rank}] ${name}` : `FAIL [rank ${rank}] ${name} -> ${res.status} ${JSON.stringify(data)}`);
  }

  console.log('\n--- summary ---');
  console.log('total:', results.length, 'ok:', results.filter((r) => r.ok).length, 'failed:', results.filter((r) => !r.ok).length);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('FAILURES:', JSON.stringify(failed, null, 2));

  writeFileSync('/tmp/upload-results-render.json', JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
