#!/usr/bin/env node
// Bulk-uploads every supported file in ./Documents to the UKPCB Assistant
// knowledge base, giving each one every clearance level and every
// department (see "Why fetched from the server?" below) so every
// employee can see it exactly the way a human uploader ticking every box
// in the real upload form would, then waits for the server's own
// extraction/OCR/embedding pipeline to finish before moving to the next
// file.
//
// Meant to be run over and over — by cron (Linux) or Task Scheduler
// (Windows) — against a folder that grows throughout the day. Every run:
//   1. Hashes every file in Documents/ (SHA-256 of its actual bytes, not
//      its name — a renamed file is still recognized as already uploaded,
//      and two different files that happen to be byte-identical are
//      correctly treated as one document, not two).
//   2. Looks that hash up in upload-state.json, a small local ledger this
//      script owns — but treats it only as a starting point, not the
//      final answer: any entry that reached a real Document row is
//      re-checked live against the server before being trusted (see
//      fetchDocumentStatus and processFile below), so a document deleted
//      by hand through the admin UI since the last run is correctly
//      re-uploaded instead of silently staying skipped forever.
//   3. Uploads everything that's genuinely still missing, one file at a
//      time, and records the outcome — success, a real processing
//      failure, or an infrastructure error — before moving on, so a
//      single bad file or a network blip never stops the rest of the
//      batch and never has to be re-uploaded once it has actually
//      succeeded.
//
// See README.md in this folder for setup and scheduling instructions on
// both Linux and Windows.
//
// ---------------------------------------------------------------------
// FAILURE MODEL — read this before changing the retry logic below.
// ---------------------------------------------------------------------
// A file's local ledger entry (see loadState/saveState) is one of:
//
//   'upload_error'        The file never made it to a Document row (blob
//                          upload failed, finalize-upload failed, login
//                          failed mid-run, network dropped, etc). Nothing
//                          was created server-side worth keeping, so the
//                          next run retries this file from scratch — this
//                          is the case the user asked for explicitly:
//                          "files that were not uploaded get uploaded
//                          properly" next time.
//
//   'pending_processing'  A Document row WAS created (we have a real
//                          documentId) but this run ended — crashed, was
//                          killed, or hit POLL_TIMEOUT_MS — before the
//                          server finished processing it. The next run
//                          does NOT re-upload the file (that would create
//                          a duplicate document); it re-checks the SAME
//                          documentId's status and picks up the wait
//                          where it left off. This state is written
//                          immediately after finalize-upload succeeds,
//                          before polling even starts, specifically so a
//                          hard crash mid-poll can never cause a
//                          duplicate.
//
//   'processing_failed'   The server accepted the file and genuinely
//                          tried to process it, but its own pipeline
//                          failed (corrupt/unreadable file, unsupported
//                          content, etc — see the recorded `error`).
//                          Deliberately NOT auto-retried: the file itself
//                          is the problem, and re-uploading it would just
//                          create another broken Document row every run
//                          forever. It's skipped on later runs with a
//                          loud reminder in the log until a human fixes
//                          it — replacing the file with a working version
//                          changes its hash, which this script then sees
//                          as a brand new file and uploads normally.
//
//   'uploaded'             Fully done — but even this is re-verified live
//                          against the server every run (a cheap status
//                          check, not a re-upload) rather than trusted
//                          blindly. If that check gets a 404, the
//                          document was deleted since the last run (most
//                          likely by hand, through the admin UI) — the
//                          local entry is discarded and the file is
//                          uploaded fresh, exactly as if it were new. If
//                          the check itself fails (network error, expired
//                          login, a 500 — NOT a 404) the file is left
//                          alone rather than guessed about either way,
//                          and is simply checked again next run.
//
// ---------------------------------------------------------------------

import { upload } from '@vercel/blob/client';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------
// Config — read from .env in this same folder (copy .env.example to get
// started), with environment variables taking priority so a scheduler can
// override without editing the file. No dependency on `dotenv` or Node's
// --env-file flag on purpose, so this runs unmodified on whatever Node
// version happens to be installed on either OS.
// --------------------------------------------------------------------
async function loadDotEnv() {
  const envPath = path.join(SCRIPT_DIR, '.env');
  let raw;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return; // no .env file — fine, rely on real environment variables
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
await loadDotEnv();

const BASE_URL = (process.env.UKPCB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.UKPCB_EMAIL || '';
const PASSWORD = process.env.UKPCB_PASSWORD || '';
// CLEARANCE_LEVEL is normally left unset: the real value is fetched fresh
// from the server every run (see fetchUploadDefaults) as "the lowest role
// that currently exists," matching exactly what the app's own admin UI
// shows as every clearance pill checked — not a guessed constant that
// could drift from the real hierarchy or, worse, fail to exactly match
// any real role and show as nothing selected (see README.md's "Why
// fetched from the server?" section for the concrete bug that caused).
// Only set this env var to deliberately override that with something
// more restrictive.
const CLEARANCE_LEVEL_OVERRIDE =
  process.env.CLEARANCE_LEVEL !== undefined ? Number(process.env.CLEARANCE_LEVEL) : null;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 10 * 60 * 1000);
const LOCK_STALE_MS = Number(process.env.LOCK_STALE_MS ?? 6 * 60 * 60 * 1000);

const DOCUMENTS_DIR = path.join(SCRIPT_DIR, 'Documents');
const STATE_PATH = path.join(SCRIPT_DIR, 'upload-state.json');
const LOCK_PATH = path.join(SCRIPT_DIR, '.upload.lock');
const LOGS_DIR = path.join(SCRIPT_DIR, 'logs');

// Matches lib/documents/textExtraction.ts's SUPPORTED_MIME_TYPES /
// components/documents/uploadClient.ts's ACCEPTED_EXTENSIONS on the
// server this talks to. Kept as a plain map here (this script has no
// access to the app's own source at run time on a machine that only has
// this folder) — if the server ever adds a new supported format, add its
// extension here too, or this script will just skip it as unsupported.
const EXTENSION_TO_MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.rtf': 'application/rtf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.epub': 'application/epub+zip',
};

// Files no one ever means to upload as a knowledge-base document —
// skipped silently (not logged as a failure) rather than reported as an
// unsupported type every single run.
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripExtension(fileName) {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

// --------------------------------------------------------------------
// Logging — every line goes to the console AND to today's log file, so a
// run kicked off unattended by a scheduler still leaves a full, dated
// record behind (see README.md for where these end up).
// --------------------------------------------------------------------
let logFilePath = null;
async function initLog() {
  await mkdir(LOGS_DIR, { recursive: true });
  const stamp = new Date();
  const dateStr = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
  logFilePath = path.join(LOGS_DIR, `upload-${dateStr}.log`);
}
async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (logFilePath) {
    await writeFile(logFilePath, line + '\n', { flag: 'a' });
  }
}

// --------------------------------------------------------------------
// State ledger — the dedup/resume source of truth. Written atomically
// (temp file + rename) so a crash or power loss mid-write can never leave
// upload-state.json half-written and unreadable — the OS-level rename is
// what actually makes this safe, not the write itself.
// --------------------------------------------------------------------
async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.files) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      await log(`WARN  upload-state.json exists but could not be read/parsed (${err.message}) — starting a fresh ledger. The old file was left in place as upload-state.json — inspect it manually if this is unexpected.`);
    }
  }
  return { version: 1, files: {} };
}
async function saveState(state) {
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2));
  await rename(tmpPath, STATE_PATH);
}

// --------------------------------------------------------------------
// Single-instance lock — a scheduler firing this while a previous, unusually
// slow run is still going (a very large backlog, a slow network) would
// otherwise have two processes writing upload-state.json at once and
// racing each other's uploads. A lock older than LOCK_STALE_MS is assumed
// to belong to a process that died without cleaning up (crash, killed,
// machine restart) and is taken over rather than blocking forever.
// --------------------------------------------------------------------
async function acquireLock() {
  try {
    const raw = await readFile(LOCK_PATH, 'utf8');
    const info = JSON.parse(raw);
    const age = Date.now() - info.startedAt;
    if (age < LOCK_STALE_MS) {
      throw new Error(
        `Another run appears to still be in progress (pid ${info.pid}, started ${new Date(info.startedAt).toISOString()}, ${Math.round(age / 1000)}s ago). ` +
          `If that run really has died without cleaning up, delete "${LOCK_PATH}" and try again.`,
      );
    }
    await log(`WARN  Found a stale lock from pid ${info.pid} (${Math.round(age / 1000)}s old, older than LOCK_STALE_MS) — assuming it crashed and taking over.`);
  } catch (err) {
    if (err.code !== 'ENOENT' && !err.message?.startsWith('Another run')) {
      // Unreadable/corrupt lock file — treat like a stale one rather than
      // blocking forever on something we can't parse.
    } else if (err.message?.startsWith('Another run')) {
      throw err;
    }
  }
  await writeFile(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
}
async function releaseLock() {
  try {
    await unlink(LOCK_PATH);
  } catch {
    // already gone — fine
  }
}

// --------------------------------------------------------------------
// File discovery
// --------------------------------------------------------------------
async function listFilesRecursively(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // hidden files/folders (incl. our own .upload.lock if it were ever nested here)
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursively(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  const hash = createHash('sha256').update(buffer).digest('hex');
  return { buffer, hash };
}

// --------------------------------------------------------------------
// Auth — replicates exactly what the real login page does (Auth.js
// Credentials provider, CSRF-protected): fetch a CSRF token, POST
// credentials against it, and keep whatever cookies come back. Verified
// directly against production before this script was written; see the
// module doc comment for the shape of the actual HTTP exchange.
// --------------------------------------------------------------------
function absorbCookies(jar, res) {
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeaderFrom(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('UKPCB_EMAIL / UKPCB_PASSWORD are not set — copy .env.example to .env in this folder and fill them in.');
  }
  const jar = new Map();

  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  absorbCookies(jar, csrfRes);
  if (!csrfRes.ok) {
    throw new Error(`Could not reach ${BASE_URL} (GET /api/auth/csrf → HTTP ${csrfRes.status}). Check UKPCB_BASE_URL and your network connection.`);
  }
  const { csrfToken } = await csrfRes.json();
  if (!csrfToken) {
    throw new Error('Login endpoint did not return a CSRF token — is UKPCB_BASE_URL pointed at the right site?');
  }

  const body = new URLSearchParams({
    email: EMAIL,
    password: PASSWORD,
    csrfToken,
    callbackUrl: `${BASE_URL}/chat`,
    json: 'true',
  });
  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeaderFrom(jar) },
    body,
  });
  absorbCookies(jar, loginRes);

  const hasSession = [...jar.keys()].some((k) => k.endsWith('session-token'));
  if (!hasSession) {
    throw new Error('Login failed — check UKPCB_EMAIL and UKPCB_PASSWORD in .env. (The account also needs "can upload documents" permission on its role.)');
  }
  return cookieHeaderFrom(jar);
}

// --------------------------------------------------------------------
// "Everyone" defaults — fetched fresh every run from the server's own
// GET /api/documents/upload-defaults (see that route's doc comment) so
// this script always uses the CURRENT real hierarchy and department list,
// exactly the values a human uploader would get by ticking every pill in
// the real upload form's ClearanceLevelPicker/DepartmentCheckboxList —
// not a value this script guesses or hardcodes.
//
// Why fetched from the server? An earlier version of this script used a
// hardcoded sentinel clearance level (-1000000) chosen to sit below any
// real role. That was functionally fine for access control — the
// server's own visibility check is a plain `<=` comparison, so any
// sufficiently low number grants access to everyone — but it broke the
// admin UI: ClearanceLevelPicker only highlights a clearance pill on an
// EXACT match against a real Role.hierarchyRank, so a value matching no
// real role rendered as nothing selected at all, not "everyone selected."
// Using the real lowest role's actual rank (whatever it is today) fixes
// that display and matches this app's own existing convention for
// "everyone" — see lib/db/queries/roles.ts's getLowestRole(), also used
// by the built-in URL-upload feature for the exact same purpose.
// --------------------------------------------------------------------
async function fetchUploadDefaults(cookieHeader) {
  const res = await fetch(`${BASE_URL}/api/documents/upload-defaults`, {
    headers: { Cookie: cookieHeader },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not fetch upload defaults: HTTP ${res.status}`);
  }
  const data = await res.json();
  const everyoneClearanceLevel = CLEARANCE_LEVEL_OVERRIDE ?? data.everyoneClearanceLevel;
  if (!Number.isFinite(everyoneClearanceLevel)) {
    throw new Error('Server did not return a usable clearance level.');
  }
  const departmentIds = Array.isArray(data.departmentIds) ? data.departmentIds : [];
  return { clearanceLevel: everyoneClearanceLevel, departmentIds };
}

// --------------------------------------------------------------------
// Live document status — the single place this script ever asks the
// server "does this document still actually exist, and what's its real
// status right now." Used both to poll a freshly-uploaded document until
// it's done, AND (see processFile) to re-verify every ALREADY-uploaded
// file against the real knowledge base before trusting the local ledger
// and skipping it — upload-state.json records what THIS SCRIPT did, but
// it has no way to know about a document someone deleted by hand through
// the admin UI in between runs. A 404 here means exactly that: the
// document this file's hash points to no longer exists server-side, so
// it needs to be treated as not-yet-uploaded again, not skipped.
//
// Returns null for a confirmed 404 (deleted). Throws for anything else
// that goes wrong (network error, auth expiring mid-run, a 500) — those
// are transient/unknown, and deliberately NOT treated the same as a
// confirmed deletion; see processFile's try/catch around this.
// --------------------------------------------------------------------
async function fetchDocumentStatus(documentId, cookieHeader) {
  const res = await fetch(`${BASE_URL}/api/documents/${documentId}/status`, {
    headers: { Cookie: cookieHeader },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Status check failed: HTTP ${res.status}`);
  }
  return res.json();
}

// Poll until the server's own status endpoint reaches READY or FAILED, or
// we give up after POLL_TIMEOUT_MS. This endpoint also self-heals a
// stalled multi-pass OCR scan every time it's polled (see the server's
// own app/api/documents/[id]/status/route.ts), so polling here isn't just
// observing progress — for a scanned/OCR'd document it's what keeps that
// document's processing actually moving forward pass by pass.
async function waitForProcessing(documentId, cookieHeader) {
  const start = Date.now();
  let lastProgress = '';
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const data = await fetchDocumentStatus(documentId, cookieHeader);
    if (data === null) {
      // Deleted by someone else while this run was mid-poll — rare, but
      // handled the same way as a pre-run deletion: not a failure of
      // this file, just nothing left to wait for.
      return { ok: false, deleted: true };
    }
    if (data.status === 'READY') return { ok: true, data };
    if (data.status === 'FAILED') return { ok: false, data };
    if (data.ocrPagesTotal) {
      const progress = `OCR ${data.ocrPagesDone ?? 0}/${data.ocrPagesTotal}`;
      if (progress !== lastProgress) {
        lastProgress = progress;
        await log(`   … ${documentId} — ${progress}`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { ok: false, timedOut: true };
}

async function recordOutcome(state, hash, documentId, relPath, baseName, attempts, result) {
  if (result.ok) {
    await log(`DONE   ${relPath} — processed successfully (documentId=${documentId})`);
    state.files[hash] = {
      status: 'uploaded',
      documentId,
      fileName: baseName,
      filePath: relPath,
      attempts,
      completedAt: new Date().toISOString(),
    };
    await saveState(state);
    return 'uploaded';
  }
  if (result.timedOut) {
    await log(
      `WAIT   ${relPath} — still processing after ${Math.round(POLL_TIMEOUT_MS / 1000)}s (documentId=${documentId}). Leaving it as pending — the next run will check on this same document instead of re-uploading it.`,
    );
    return 'timed-out'; // state stays 'pending_processing', already saved before polling started
  }
  if (result.deleted) {
    await log(`WARN   ${relPath} — was deleted from the knowledge base while still processing (documentId=${documentId}). Forgetting it locally; the next run will treat this file as new.`);
    delete state.files[hash];
    await saveState(state);
    return 'deleted-mid-run';
  }
  const reason = result.data?.processingError || 'The server marked this document FAILED with no error message recorded.';
  await log(`FAIL   ${relPath} — server-side processing failed: ${reason}`);
  state.files[hash] = {
    status: 'processing_failed',
    documentId,
    fileName: baseName,
    filePath: relPath,
    error: reason,
    attempts,
    failedAt: new Date().toISOString(),
  };
  await saveState(state);
  return 'processing-failed';
}

async function processFile(filePath, cookieHeader, defaults, state) {
  const relPath = path.relative(SCRIPT_DIR, filePath);
  const baseName = path.basename(filePath);

  if (IGNORED_BASENAMES.has(baseName)) {
    return 'skip-ignored';
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXTENSION_TO_MIME[ext];
  if (!mimeType) {
    await log(`SKIP   ${relPath} — unsupported file type "${ext || '(no extension)'}"`);
    return 'skip-unsupported';
  }

  let buffer, hash;
  try {
    ({ buffer, hash } = await sha256File(filePath));
  } catch (err) {
    await log(`FAIL   ${relPath} — could not read the file: ${err.message}`);
    return 'skip-unreadable';
  }

  // The local ledger only ever records what THIS script did — it has no
  // way to know about a document deleted by hand through the admin UI in
  // between runs. So for any entry that got as far as actually creating a
  // Document row (has a documentId), always re-verify against the live
  // server before trusting it, rather than skipping on the local record
  // alone. Only 'upload_error' entries (never got a documentId at all)
  // skip this check — there's nothing server-side to verify yet.
  const existing = state.files[hash];
  if (existing?.documentId) {
    let serverState;
    try {
      serverState = await fetchDocumentStatus(existing.documentId, cookieHeader);
    } catch (err) {
      await log(
        `WARN   ${relPath} — could not verify the existing upload (documentId=${existing.documentId}) against the knowledge base this run: ${err.message}. ` +
          `Leaving it as-is rather than guessing; it will be checked again next run.`,
      );
      return 'skip-check-failed';
    }

    if (serverState?.status === 'READY') {
      await log(`SKIP   ${relPath} — already uploaded and confirmed still present in the knowledge base (documentId=${existing.documentId})`);
      return 'skip-duplicate';
    }
    if (serverState?.status === 'FAILED') {
      const reason = serverState.processingError || existing.error || 'The server marked this document FAILED with no error message recorded.';
      await log(
        `SKIP   ${relPath} — confirmed still present but failed processing on the server (documentId=${existing.documentId}, reason: ${reason}). ` +
          `Replace this file with a working version to retry it (a changed file gets a new hash and is treated as new); it will otherwise be skipped every run.`,
      );
      state.files[hash] = { ...existing, status: 'processing_failed', error: reason };
      await saveState(state);
      return 'skip-known-failure';
    }
    if (serverState?.status === 'PENDING' || serverState?.status === 'PROCESSING') {
      await log(`RESUME ${relPath} — a previous run uploaded this file (documentId=${existing.documentId}) and it's still being processed. Re-checking instead of re-uploading.`);
      const result = await waitForProcessing(existing.documentId, cookieHeader);
      return recordOutcome(state, hash, existing.documentId, relPath, baseName, existing.attempts ?? 1, result);
    }
    // serverState === null: a 404 — this document no longer exists (most
    // likely deleted through the admin UI since the last run). Forget the
    // stale local record and fall through to the fresh-upload path below
    // (which logs its own UPLOAD line right after this one).
    await log(`GONE   ${relPath} — was previously uploaded (documentId=${existing.documentId}) but that document no longer exists in the knowledge base (deleted since the last run) — re-uploading.`);
    delete state.files[hash];
  }
  // No local record at all, a past 'upload_error' with nothing to verify
  // yet, or the previous upload was confirmed deleted above — fresh upload.

  const attempts = (existing?.attempts ?? 0) + 1;
  await log(`UPLOAD ${relPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB, attempt ${attempts})`);

  let documentId;
  try {
    const pathname = `documents/${randomUUID()}${ext}`;
    const blob = await upload(pathname, buffer, {
      access: 'private',
      handleUploadUrl: `${BASE_URL}/api/documents/blob-upload-token`,
      clientPayload: JSON.stringify({ clearanceLevel: defaults.clearanceLevel }),
      headers: { Cookie: cookieHeader },
    });

    const finalizeRes = await fetch(`${BASE_URL}/api/documents/finalize-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        pathname: blob.pathname,
        mimeType,
        fileSizeBytes: buffer.length,
        name: stripExtension(baseName),
        clearanceLevel: defaults.clearanceLevel,
        departmentIds: defaults.departmentIds,
        tags: [],
      }),
    });
    const finalizeData = await finalizeRes.json().catch(() => ({}));
    if (!finalizeRes.ok) {
      throw new Error(finalizeData.error || `finalize-upload failed: HTTP ${finalizeRes.status}`);
    }
    documentId = finalizeData.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`FAIL   ${relPath} — upload failed: ${message}`);
    state.files[hash] = {
      status: 'upload_error',
      fileName: baseName,
      filePath: relPath,
      error: message,
      attempts,
      lastAttemptAt: new Date().toISOString(),
    };
    await saveState(state);
    return 'upload-error';
  }

  // Persisted BEFORE polling starts, deliberately — see the FAILURE MODEL
  // comment at the top of this file for why.
  state.files[hash] = {
    status: 'pending_processing',
    documentId,
    fileName: baseName,
    filePath: relPath,
    attempts,
    uploadedAt: new Date().toISOString(),
  };
  await saveState(state);

  const result = await waitForProcessing(documentId, cookieHeader);
  return recordOutcome(state, hash, documentId, relPath, baseName, attempts, result);
}

// --------------------------------------------------------------------
// Main
// --------------------------------------------------------------------
async function main() {
  await initLog();
  await log('==================== UKPCB Assistant bulk upload — run started ====================');
  await log(`Base URL: ${BASE_URL}`);
  await log(`Documents folder: ${DOCUMENTS_DIR}`);

  await acquireLock();
  try {
    const files = await listFilesRecursively(DOCUMENTS_DIR);
    if (files.length === 0) {
      await log(`No files found in ${DOCUMENTS_DIR} — nothing to do.`);
      return;
    }
    await log(`Found ${files.length} file(s) in the Documents folder.`);

    let cookieHeader;
    try {
      cookieHeader = await login();
      await log(`Logged in as ${EMAIL}.`);
    } catch (err) {
      await log(`FATAL  Could not log in — no files will be attempted this run: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    let defaults;
    try {
      defaults = await fetchUploadDefaults(cookieHeader);
      await log(
        `Every upload this run gets clearance level ${defaults.clearanceLevel} (the current lowest role — visible to everyone) ` +
          `and all ${defaults.departmentIds.length} current department(s).`,
      );
    } catch (err) {
      await log(`FATAL  Could not fetch upload defaults — no files will be attempted this run: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const state = await loadState();
    const counts = {
      uploaded: 0,
      'skip-duplicate': 0,
      'skip-unsupported': 0,
      'skip-known-failure': 0,
      'skip-unreadable': 0,
      'skip-ignored': 0,
      'skip-check-failed': 0,
      'upload-error': 0,
      'processing-failed': 0,
      'timed-out': 0,
      'deleted-mid-run': 0,
    };

    for (const filePath of files) {
      const outcome = await processFile(filePath, cookieHeader, defaults, state);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }

    await log('---------------------------- summary ----------------------------');
    await log(`Uploaded and processed successfully : ${counts.uploaded}`);
    await log(`Already uploaded (skipped)          : ${counts['skip-duplicate']}`);
    await log(`Still processing (check next run)   : ${counts['timed-out']}`);
    await log(`Upload/network errors (will retry)  : ${counts['upload-error']}`);
    await log(`Server-side processing failures     : ${counts['processing-failed']}`);
    await log(`Known past failures (skipped)       : ${counts['skip-known-failure']}`);
    await log(`Unsupported file type (skipped)     : ${counts['skip-unsupported']}`);
    await log(`Unreadable file (skipped)           : ${counts['skip-unreadable']}`);
    await log(`Could not verify (checked next run) : ${counts['skip-check-failed']}`);
    await log(`Deleted while still processing      : ${counts['deleted-mid-run']}`);
    if (counts['upload-error'] > 0 || counts['processing-failed'] > 0 || counts['skip-check-failed'] > 0) {
      await log(`ATTENTION: ${counts['upload-error']} upload error(s), ${counts['processing-failed']} processing failure(s), and ${counts['skip-check-failed']} unverifiable existing upload(s) this run — see the WARN/FAIL lines above for reasons. Upload errors and unverifiable checks are retried automatically next run; processing failures need a human look (see the reason logged for each).`);
      process.exitCode = 1;
    }
    await log('==================== run finished ====================');
  } finally {
    await releaseLock();
  }
}

main().catch(async (err) => {
  const message = err instanceof Error ? (err.stack || err.message) : String(err);
  await log(`FATAL  Unexpected error — run aborted: ${message}`);
  await releaseLock();
  process.exitCode = 1;
});
