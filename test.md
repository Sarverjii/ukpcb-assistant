# Ask Evon — test plan

A checklist to prove the whole app actually works as intended, not just
that it builds. Organized by feature area; each item is a concrete
setup → action → expected-result you can actually run, not a vague
assertion. Use it after any change that touches auth, retrieval,
document/department/role management, usage limits, or the admin UI — and
periodically end-to-end against production regardless.

Two accounts referenced throughout: **the seeded admin** (`cxo@evon.com`
/ `Password123!` locally — use whatever real admin account exists on
production) and **a low-clearance employee** you create during testing
specifically to prove the boundary from the *denied* side, not just the
*allowed* side. Testing only as an admin never proves authorization works
— it only proves nothing crashes.

## 0. Automated coverage — run this first

```bash
npm run build          # tsc + Next build — must be clean
npx eslint .            # must be clean
npm test                # tests/authz.test.ts — see below
```

`tests/authz.test.ts` is a real, automated proof of the authorization
boundary against a real database (`DATABASE_URL_TEST` — **must** be a
separate database from dev; the suite truncates tables). It already
covers, so don't bother re-proving these by hand:

- A chunk above the caller's clearance rank is never returned, for every
  seeded role rank.
- `listAccessibleDocumentSummaries` never names a document above the
  caller's clearance.
- `retrieveChunksForDocuments` (the "scope to document(s)" chat path)
  enforces the identical boundary as plain retrieval.
- **Clearance and department are an intersection (AND), not alternatives
  (OR)** for a document that has a department — see §9 below, this is
  the single most important thing in this app to keep correct and the
  automated test is the primary proof of it.
- `matchDocumentsByName`'s word-boundary matching (no false positives
  from a substring inside an unrelated word).

If `GEMINI_API_KEY` isn't set, the one end-to-end `answerQuestion` test
that needs a real model call is skipped — the DB-layer security tests
above still run regardless (they're what actually matters here).

Everything below this line is what `npm test` does **not** cover —
UI behavior, multi-step admin flows, timing/race conditions, and anything
that needs a real browser session.

## 1. Auth & sessions

- [ ] Log in with valid credentials → lands on `/chat`.
- [ ] Log in with a wrong password → rejected, no session created, and an
      `LOGIN_FAILED` audit entry is recorded (check Admin → Audit Log).
- [ ] Log in as a `DISABLED` or `REMOVED` status account → rejected the
      same way as a wrong password (not a different error that leaks
      account existence/status).
- [ ] Settings → Active sessions lists the current session (and any other
      real concurrent logins); clicking sign-out on a session ends it —
      confirm that session's next request actually gets redirected to
      login, not just removed from the list.
- [ ] Settings → change password with the wrong current password →
      rejected; with the right one → succeeds, and the new password
      actually works on the next login.

## 2. Role hierarchy (Admin → Hierarchy)

- [ ] Create a new role → it starts at the **bottom** of the hierarchy
      (lowest clearance), not inserted at an arbitrary position.
- [ ] Move a role up/down → its `hierarchyRank` actually changes relative
      to its neighbors (verify by then testing document visibility at
      that rank, not just that the UI reordered visually).
- [ ] Rename a role → the new name shows immediately everywhere it's
      referenced (clearance picker, employee role dropdown, directory).
- [ ] Click a role in the hierarchy list → expands to show every member
      currently holding that role, with a working link to each one's
      employee detail page.
- [ ] Numbering/rank is NOT shown in front of role names in the list (a
      past regression this session fixed — confirm it stays fixed).
- [ ] Set a role's default daily message limit → new employees assigned
      that role inherit it (see §10).

## 3. Employees (Admin → Employees)

- [ ] Add an employee manually → they can log in with the credentials
      shown, land in the right role, and (if assigned) the right
      department(s).
- [ ] Edit an employee's role → their document access changes
      immediately on their very next request (no re-login needed — the
      app re-reads role/clearance from the DB every request, never trusts
      a cached session value).
- [ ] Toggle an employee's status (disable/enable) → **requires
      re-entering the admin's own password** (a modal, not just a click);
      wrong password rejects the action and logs `ADMIN_REAUTH_FAILED`.
      A disabled employee can no longer log in.
- [ ] Reset an employee's password → same re-auth requirement; the new
      temporary password actually works for that employee.
- [ ] Set a per-employee daily message limit override → confirm in §10
      that it actually overrides the role/department default rather than
      just displaying.
- [ ] **Two-stage removal**: remove an employee (re-auth required) → they
      move to the Removed Employees list, can no longer log in, but their
      uploaded documents are NOT deleted (reassigned to "Removed
      employee" as uploader) and their conversations are still visible
      under Admin review. Then permanently delete (re-auth required
      again, separate confirmation) → their conversations are actually
      gone; their documents still survive.
- [ ] Bulk import (CSV/XLSX): upload a file with (a) a genuinely new
      valid row, (b) a row whose email already exists, (c) a row with an
      unresolvable role name, (d) a row with an unresolvable department
      name → confirm per-row outcome is correct (created / skipped as
      duplicate / failed with a specific reason), a downloadable XLSX
      error report is offered for the failures, and re-uploading the
      *same* file a second time creates **zero** new employees (dedup by
      email).
- [ ] Export the live roster (XLSX) → columns include who added each
      employee and how (manual vs. bulk import) and are actually correct
      for one of each kind.
- [ ] Employees table: kebab action menu doesn't get clipped by the table
      wrapper at any reasonable viewport width (a past regression this
      session fixed). Note: the Employees table itself has **no**
      column-header sorting — that feature exists only on the Knowledge
      Base's Documents table (§5, §15); don't expect it here.

## 4. Departments (Admin → Departments)

- [ ] Create a department → appears immediately in every department
      picker app-wide (document upload, employee assignment) — there is
      supposed to be exactly one source of truth for the department list
      (`listDepartments()`), so confirm a newly created one shows up
      everywhere without a page reload race.
- [ ] Add/remove a member from a department via the department detail
      page.
- [ ] Toggle a department's "head department" flag → confirm this
      actually changes document access per §9 (this flag is NOT the
      same thing as a department's designated "head" *person* —
      `headUserId` — don't confuse the two while testing; a department
      can have a head person with zero effect on access, and can be
      flagged `isHeadDepartment` with no head person set at all).
- [ ] Rename a department → old name is gone everywhere, no orphaned
      references.
- [ ] A department card shows correct member count, document count, and
      (if set) message-budget indicator.

## 5. Document upload & management (Knowledge Base)

- [ ] Upload each supported file type at least once (PDF, DOCX, PPTX,
      XLSX, TXT, MD, DOC, RTF, HTML, CSV, JSON, ODT, ODP, ODS, EPUB) →
      all reach `READY`, none silently stuck at `PROCESSING`/`PENDING`.
- [ ] Upload an unsupported type → rejected with a clear error, not a
      silent failure or a stuck PENDING row.
- [ ] Try to set a document's clearance above your own account's rank →
      rejected (both the plain-upload route and the Vercel Blob
      client-direct-upload token route enforce this independently —
      worth testing via the actual UI, which only exercises whichever
      path `STORAGE_PROVIDER` selects).
- [ ] Upload a **scanned** (image-only) PDF → OCR kicks in
      (`ocrPagesTotal`/`ocrPagesDone` progress visible), and the final
      document is actually queryable in chat (proves the transcribed text
      really made it into embedded chunks, not just that processing
      "finished"). Test this against whichever LLM provider is currently
      active in Admin → AI Models — OCR is implemented per-provider
      (`transcribeImage`), so a provider switch is worth re-testing this
      specifically for.
- [ ] Upload a large scanned PDF (several pages) and confirm the
      **multi-pass** resumability actually works — it shouldn't need to
      finish in one HTTP request; polling should show progress advancing
      pass over pass with no duplicated chunks for the same page (a past
      race condition this session found and fixed twice — see the
      `Document.processingClaimedAt` lock).
- [ ] Add content from a URL, single page → succeeds, and the resulting
      document is **always visible to everyone regardless of clearance or
      department** (this path deliberately bypasses the normal access
      model — verify it actually does, not just that it says it does).
- [ ] Add content from a URL with crawl enabled at depth 1, 2, and 3 →
      confirm deeper settings reach further same-domain links, capped at
      3 total pages added regardless of depth; re-adding the same root
      URL a second time adds nothing new (already-ingested pages are
      skipped).
- [ ] Change a document's clearance or department tags after upload →
      takes effect for **retrieval** immediately (the denormalized
      `DocumentChunk.clearanceRank`/`departmentIds` must be updated in
      the same action, not just the `Document` row — if you only see the
      `Document` row change but chat access doesn't follow, that's the
      exact bug this pairing exists to prevent).
- [ ] Replace a document's file → old content stops being retrievable,
      new content becomes retrievable, clearance/department tags are
      preserved from before the replace.
- [ ] Delete a document → its chunks are gone (cascade), and it's no
      longer citable in chat even for previously-generated messages that
      cited it (citation preview re-checks authorization/existence at
      read time, not just at send time).
- [ ] Search/filter (name, clearance, status, department) all narrow the
      table correctly, including in combination.
- [ ] Click every column header (Document, Uploaded by, Clearance,
      Department, Status, Updated) → sorts ascending, click again →
      descending, click a different column → switches to that one
      ascending (see §15).
- [ ] After the clearance/department picker fix this session shipped:
      uploading with "everyone" access shows the **actual lowest role**
      checked (e.g. Trainee) with every more-senior role highlighted too
      — not a blank/unselected picker. If this ever shows nothing
      selected for a document meant to be universally visible, the
      picker is receiving a clearance value that doesn't exactly match a
      real `Role.hierarchyRank` — a regression of a real bug found and
      fixed this session.

## 6. Document Library (employee-facing, `/documents`)

- [ ] An employee sees only documents their clearance-and-department
      combination actually authorizes (cross-check against §9's matrix,
      not just "some documents show up").
- [ ] Documents tab and Websites tab are actually separate and each
      shows the right content (a URL-sourced page should never appear in
      the plain Documents tab, and vice versa).
- [ ] Clicking a website entry opens the real live URL, not an internal
      PDF rendition.
- [ ] Search narrows results correctly in both tabs.

## 7. Directory (`/directory`)

- [ ] Every active employee is listed, searchable by name/email/
      department.
- [ ] Department head (the `headUserId` person, if set) is indicated
      correctly — and again, don't confuse this with `isHeadDepartment`.

## 8. Chat / RAG

- [ ] Ask a question answerable from an authorized document → answer
      includes a citation chip; clicking it shows the actual cited
      excerpt.
- [ ] Ask a question about content that exists but the current user is
      **not** authorized to see → the app does not answer from it and
      does not reveal that such content exists (this is the actual
      point of the whole security model — test it as the low-clearance
      account, not the admin).
- [ ] Ask a general/small-talk question ("what's 2+2", "hello") → answered
      normally, not refused just because it's not company content.
- [ ] Ask a meta-question ("how many documents do you have", "list your
      documents", "is there a document about X") → answered from the
      clearance-filtered document **name/description** list, correctly
      excluding documents the user isn't authorized to know exist.
- [ ] "Scope to document(s)" picker: search box actually filters the
      list (not just visually — confirm scoping to a filtered-then-
      selected document changes the answer); selecting specific documents
      restricts the answer to only those, still honoring the
      clearance-and-department check independently (§9's automated test
      covers this at the query layer — confirm it holds through the UI
      too).
- [ ] Regenerate an existing assistant message → produces a new answer in
      place; the page does **not** jump to the bottom of the chat during
      or after (a past scroll bug this session fixed — regenerating an
      older message especially).
- [ ] Edit a previous user message → truncates the conversation from
      there and re-answers; same scroll-position expectation as above.
- [ ] Delete a conversation → it's gone from the sidebar and from Admin's
      per-employee conversation view.
- [ ] Send messages fast enough to see streaming in action → tokens
      appear incrementally, not as one block dump at the end.

## 9. Authorization boundary — the exact access model (test this directly, don't assume)

**Current model** (see `lib/db/queries/chunks.ts`'s own doc comment,
which is the single most authoritative description in this repo):

> A chunk is authorized if the caller's clearance rank covers it **AND**
> (the document has no department at all, **OR** the caller belongs to at
> least one of the document's departments, **OR** the caller has
> head-department access). Clearance is a hard requirement, never
> optional — department membership only ever **narrows** what clearance
> already admits, it never widens it. A document with no department at
> all is governed by clearance alone.

This replaced an earlier, simpler "clearance OR department" model
partway through development — if you find documentation anywhere
(including comments in this very codebase, e.g.
`app/(app)/settings/page.tsx`'s and `app/(app)/admin/employees/actions.ts`'s
own comments) still describing plain OR, that documentation is stale;
trust `lib/db/queries/chunks.ts` and `tests/authz.test.ts` over any
comment or README that disagrees with them.

Test matrix — create one document, tag it with a specific clearance rank
and ONE specific department, and confirm all six of these hold:

| Caller | Clearance | In the document's department? | Head-department access? | Expected |
|---|---|---|---|---|
| A | Sufficient | Yes | — | **Visible** |
| B | Sufficient | No | No | **Not visible** (the actual behavior change from the old model — sufficient clearance alone is no longer enough once a document has a department) |
| C | Sufficient | No (different dept) | Yes | **Visible** (head-department counts as belonging to every department) |
| D | Insufficient | Yes | — | **Not visible** (department membership never substitutes for missing clearance) |
| E | Insufficient | No | Yes | **Not visible** (head-department only ever satisfies the department half) |
| F | Sufficient | (document has no department at all) | — | **Visible** (departmentless documents are governed by clearance alone, exactly as if departments didn't exist) |

Test this both through `tests/authz.test.ts` (already does exactly this,
run it) and manually through the actual chat UI with real test accounts
for at least rows B and D — those are the two rows most likely to
silently regress back toward the old OR model without anyone noticing,
since a regression there fails *open* (over-shares) rather than failing
closed.

## 10. Usage limits

- [ ] Set an employee's daily message limit very low (e.g. 2) → the 3rd
      message that day is blocked with a clear, visible error in the
      chat UI itself (not a silently-empty assistant bubble — a real bug
      this session found and fixed: a blocked request must speak the
      same NDJSON stream contract as every other chat response).
- [ ] Confirm this is **three independent ceilings checked together, not
      a priority fallback chain** — a message is blocked if it would
      exceed *any* applicable one: (1) the employee's own effective limit
      (their personal override if set, else their role's default), (2)
      an aggregate budget across every member combined, for *each*
      department they're in that has one configured (optional — a
      department with no limit set contributes no check at all), and (3)
      the org-wide ceiling, regardless of what any individual or
      department limit allows. Prove this isn't secretly a fallback:
      set a generous personal limit but a tight department limit, and
      confirm the tight one still blocks — then the reverse (tight
      personal limit, generous department limit) and confirm the
      personal one still blocks.
- [ ] Change the org-wide daily limit from Admin → Usage Limits → takes
      effect for employees with no more specific override.
- [ ] **No-leakage under concurrency**: fire many simultaneous requests
      from an account right at its limit → the count of requests that
      actually succeed never exceeds the limit, even under a burst (this
      was verified once this session with a real 20-concurrent-at-
      limit-5 stress test — exactly 5 succeeded, 0 leaked; worth
      re-running that shape of test after any change to
      `lib/usage/limits.ts` or `atomicCheckAndIncrement`).
- [ ] Both chat entry points enforce this — the streaming route AND
      `regenerateMessage`/`editMessage` in the server actions — a limit
      that only blocks new messages but not regenerate/edit is a real gap
      to check for.

## 11. Audit logging

- [ ] Every action in this list actually produces a log entry when
      performed, visible in Admin → Audit Log with a correct,
      human-readable description (not a raw enum name): `LOGIN`,
      `LOGIN_FAILED`, `LOGOUT`, `DOCUMENT_UPLOAD`,
      `DOCUMENT_ADDED_FROM_URL`, `DOCUMENT_PROCESSED`,
      `DOCUMENT_CLEARANCE_CHANGED`, `DOCUMENT_DEPARTMENTS_CHANGED`,
      `DOCUMENT_REPLACED`, `DOCUMENT_DELETED`, `DOCUMENT_DOWNLOADED`,
      `CHAT_QUERY`, `CITATION_PREVIEWED`, `CONVERSATION_DELETED`,
      `EMPLOYEE_CREATED`, `EMPLOYEE_ROLE_CHANGED`,
      `EMPLOYEE_STATUS_CHANGED`, `EMPLOYEE_PASSWORD_RESET`,
      `EMPLOYEE_CONVERSATIONS_VIEWED`, `EMPLOYEE_REMOVED`,
      `EMPLOYEE_DELETED`, `EMPLOYEE_BULK_IMPORTED`,
      `EMPLOYEE_ROSTER_EXPORTED`, `EMPLOYEE_DEPARTMENTS_CHANGED`,
      `DEPARTMENT_CREATED`, `DEPARTMENT_RENAMED`, `DEPARTMENT_DELETED`,
      `DEPARTMENT_HEAD_FLAG_CHANGED`, `DEPARTMENT_MEMBER_ADDED`,
      `DEPARTMENT_MEMBER_REMOVED`, `AI_PROVIDER_ACTIVATED`,
      `AI_PROVIDER_DEACTIVATED`, `DOCUMENTS_REEMBEDDED`,
      `ADMIN_REAUTH_FAILED`, `PASSWORD_CHANGED`,
      `PASSWORD_CHANGE_FAILED`, `ROLE_CREATED`,
      `ROLE_HIERARCHY_CHANGED`, `ACCESS_DENIED`, `USAGE_LIMIT_EXCEEDED`,
      `USAGE_LIMIT_CONFIG_CHANGED`.
- [ ] Timestamps shown throughout the admin UI (Audit Log, Admin overview
      recent-activity, employee-removed list) reflect **the viewer's own
      browser timezone**, not the server's UTC runtime — check this
      specifically on a production deploy, not just local dev, where
      it's easy for this to look correct by coincidence if your dev
      machine happens to also be in UTC-offset-matches-your-real-
      timezone. This was a real, twice-fixed bug this session: a naive
      `suppressHydrationWarning` fix looked correct locally but was still
      wrong in production, because it doesn't do what it looks like it
      does (see `components/admin/LocalTime.tsx`'s own doc comment for
      the mechanism — it now uses `useSyncExternalStore`, not hydration-
      mismatch suppression).
- [ ] Failed re-auth attempts (§3, §12) are logged with which specific
      action was being attempted, not a generic "reauth failed."

## 12. AI Models (Admin → AI Models)

- [ ] Add and activate a credential for each of the 4 LLM providers
      (Gemini, OpenAI, Anthropic, Ollama) one at a time → chat actually
      uses whichever is currently active (ask something that would
      plausibly differ in phrasing/model behavior, or just confirm no
      error, per provider).
- [ ] Add and activate a credential for each of the 3 embedding providers
      (Gemini, OpenAI, Ollama — **not** Anthropic, which has no public
      embeddings API and should not even be offered as an option here) →
      confirm document upload and chat retrieval both work under each.
- [ ] Saving any provider credential requires admin re-auth (password
      re-entry).
- [ ] An API key, once saved, is never shown again in plaintext anywhere
      in the UI (check the network tab too, not just the rendered page)
      — it's encrypted at rest (`AI_CREDENTIALS_ENCRYPTION_KEY`) and only
      ever decrypted server-side at the moment of use.
- [ ] Switching the active LLM or embedding provider takes effect on the
      very next request — no caching, no restart needed.
- [ ] "Re-embed all documents" (after switching embedding provider or
      `EMBEDDING_DIMENSIONS`) requires re-auth, actually re-embeds every
      chunk, and chat retrieval works correctly afterward under the new
      provider (a stale mix of old- and new-provider embeddings in the
      same vector column would silently corrupt similarity search — this
      is worth actually verifying end-to-end, not just watching the
      progress indicator finish).

## 13. Settings

- [ ] Theme toggle (light/dark/system) persists across reload and across
      devices (it's a DB-stored preference, not just `localStorage`).
- [ ] Profile fields shown are correctly read-only with a pointer to
      admin for changes — no client-side way to edit them directly.

## 14. Admin overview dashboard

- [ ] All 4 stat cards (total employees, active users, total documents,
      AI questions asked) show numbers that actually match reality —
      spot-check at least one against a direct count.
- [ ] "Recent unanswered questions" actually reflects questions the app
      genuinely couldn't answer (refusals), not just any question.
- [ ] "Recent activity" feed matches the tail of the full Audit Log.
- [ ] `/admin/documents` (an old URL) redirects cleanly to
      `/knowledge-base` rather than 404ing.

## 15. UI / visual regressions worth re-checking after any styling change

- [ ] No page has excessive unused side margin at a normal desktop
      width (`max-w-[100rem]` on the admin/knowledge-base/documents/
      directory layouts — a past regression this session fixed; the
      chat message column and the Settings form are the two
      deliberately-narrow exceptions, don't "fix" those).
- [ ] The Employees table's Actions kebab menu is never clipped by the
      table's horizontal scroll container at any reasonable viewport
      width.
- [ ] Sortable column headers show a direction indicator only on the
      active sort column, a neutral icon on the rest.
- [ ] Dark mode and light mode both render every page above correctly —
      spot check at least the tables, pickers, and status pills, which
      carry the most color-dependent state.

## 16. The bulk-upload tool (`Large Database/`) — separate from the app itself

Not part of the deployed app; a standalone script. If it's touched:

- [ ] Fresh upload of a folder of documents → all succeed, and each gets
      **every** clearance level and **every** department checked (the
      real lowest role's rank, fetched live from
      `GET /api/documents/upload-defaults` — not a hardcoded sentinel
      value, which was a real bug this session found via exactly this
      check failing to render as "selected" in the admin UI).
- [ ] Re-running immediately after → everything skips as already
      uploaded, zero duplicates.
- [ ] Delete one of those documents through the admin UI, then re-run →
      the script detects the deletion (a live status check, not blind
      trust in its local ledger) and re-uploads only that one file.
- [ ] Kill the script mid-upload (before a document finishes processing),
      then re-run → it resumes checking that same document rather than
      creating a duplicate.

## Known gaps — not bugs, don't file these

MFA, SSO/OAuth providers, and a self-service "forgot password" email flow
are documented as not built (see `README.md`'s "What's not built yet").
Password reset is admin-initiated only, by design.
