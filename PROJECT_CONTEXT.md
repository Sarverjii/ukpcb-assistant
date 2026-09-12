## Update (2026-09-11): the rebrand described below is done

The "real decision for whoever works on this next" flagged in **This is
still "Ask Evon" in every way that shows** below has been made and
carried out: this app now targets the Uttarakhand Pollution Control Board
(UKPCB) instead of the fictional "Evon Technologies". Concretely —

- Every user-facing "Ask Evon" string (system prompt self-identification
  in `lib/llm/promptTemplates.ts`, page title in `app/layout.tsx`, chat
  header/placeholder, admin-email sign-offs, export labels, error/limit
  messages) now reads "UKPCB Assistant".
- "Evon Directory" / "Evon Knowledge Base" now read "UKPCB Directory" /
  "UKPCB Knowledge Base"; the `EvonDirectory` component was renamed to
  `UkpcbDirectory` (`components/directory/UkpcbDirectory.tsx`).
- The logo (`public/logo.svg` / `public/logo-mark.svg`) was replaced with
  the UKPCB seal (`public/logo.png`, also used for `app/icon.png`), and
  the brand accent color scale in `app/globals.css` was regenerated from
  that seal's green (`#3b7f51`) instead of the old navy.
- The seeded admin account's placeholder email moved from `cxo@evon.com`
  to `admin@ukpcb.gov.in`; the `package.json` name is now `ukpcb-assistant`;
  local dev's Postgres (`docker-compose.yml`, `.env.example`) moved from
  `evon`/`ask_evon` naming to `ukpcb`.
- A couple of historical engineering comments (`lib/rag/chat.ts`,
  `app/(app)/knowledge-base/actions.ts`) that document real empirical
  tuning work done against the old project's actual production data
  (`evontech.com`, a real crawled page) were left as-is — rewriting them
  to reference UKPCB would misrepresent what was actually measured.

## Update (2026-09-11, continued): the role hierarchy is now also renamed

The "deliberately left unchanged" role hierarchy from the first update
above was a decision for *that* session, not a permanent one — a later
request the same day explicitly asked for the hierarchy itself (and the
matching `EVON_Documents/` demo corpus, since re-pasted into this folder
for testing) to reflect a government agency. `scripts/seed-authz-fixtures.ts`'s
`ROLE_DEFS` now reads, lowest to highest clearance:

| Old (Evon Technologies) | New (UKPCB) | Rank |
|---|---|---|
| Software Engineer | Junior Engineer | 1 |
| HR | Administrative Officer | 2 |
| Architect | Scientific Officer | 3 |
| VP | Regional Officer | 4 |
| President | Additional Director | 5 |
| CXO | **Member Secretary** | 6 (admin + upload) |

"Member Secretary" for rank 6 is deliberate, not arbitrary — it's the
real title of a State Pollution Control Board's chief executive/
administrative officer in India (the Chairman role is more ceremonial/
political), so it's the authentic fit for the one role that gets
`isAdmin`/`canUploadDocuments`. The seeded admin account
(`admin@ukpcb.gov.in`) now holds this role; `prisma/seed.ts` was updated to
look it up by its new name.

**What did NOT change, on purpose**: `TEST_USERS`' email addresses/names
(`engineer@asktest.local` etc. — arbitrary test identifiers, not
branding) and every `FIXTURE_DOCS` document's `name`/`content` (only each
one's `roleName` field, to point at the renamed role). `tests/authz.test.ts`
hardcodes several of those document names and content fragments directly
in its assertions (`'Board Merger Plans'`, `'Engineering Handbook'`,
`'Northwind'`, etc.) — renaming the *role* each fixture document requires
didn't need touching any of that, so the automated suite needed zero
changes and still passes.

`EVON_Documents/` (the demo corpus for manual/bulk-upload testing, organized
into one folder per role) was renamed to `UKPCB_Documents/` with each
role-named subfolder renamed to match the table above (same numeric
prefixes, same files). `Large Database/` (the standalone bulk-upload
script) had its own "Ask Evon" branding, env var names
(`ASK_EVON_EMAIL`→`UKPCB_EMAIL` etc.), and default base URL
(now `http://localhost:3000`, since there's no live UKPCB deployment yet)
updated the same way the main app was in the first update — see its own
README.md.

The rest of this file is the **original, unmodified snapshot** written at
copy time, before any of the above happened — kept for its explanation of
what this folder is and what was excluded from the copy, both still
accurate.

# What this folder is

This is a **verbatim code copy** of a different, still-live project
called "Ask Evon," made on 2026-09-11 to serve as the starting point for
a new, separate deployment (working name at copy time: "Pollution
Board"). If you are an AI (or a person) picking this up for the first
time, read this whole file before changing anything — it tells you what
you're actually looking at, what's already been done to make this a safe
clean start, and what almost certainly still needs deciding before this
becomes its own thing.

**Read `README.md` next.** It's the original project's own technical
documentation — setup, architecture, the authorization model, provider
swap points, deployment steps, what's not built. It is still fully
accurate for the *code* in this folder (nothing here has been modified
from the source project yet) and is the right place for implementation
detail this file doesn't repeat. **Read `DEPLOYMENT_SETUP.md`** for the
concrete checklist of what needs to be created/generated (Neon database,
Vercel project, every env var, a new git remote) before this runs
anywhere again — none of that infrastructure carried over in the copy, on
purpose.

## What the app actually does

A role-based enterprise RAG chatbot: employees log in and ask an AI
questions about "their company"; the AI only ever answers from documents
the employee's role is cleared to see, enforced **at the database query**
(not by asking the LLM to keep a secret — see the top of
`prisma/schema.prisma` and `lib/db/queries/chunks.ts`). Built out over one
long iterative session as a practice/portfolio exercise modeled on a
fictional company ("Evon Technologies"), covering:

- Auth (Auth.js, Credentials provider, session-backed) + a configurable
  role hierarchy with numeric clearance ranks (Admin → Hierarchy tab —
  ranks can be added/reordered, never hardcoded).
- Document upload/management (PDF, Word, PowerPoint, Excel, plain text,
  HTML, and more) with per-document clearance + **department** tagging
  (additive: visible if clearance covers it *or* the viewer is in one of
  its departments) — see `lib/db/queries/chunks.ts`'s retrieval queries
  for the actual `clearanceRank <= X OR departmentIds && Y` boundary.
  There's also a website/URL-ingestion path (crawls same-domain links) and
  an OCR pipeline for scanned PDFs (rasterizes pages, transcribes via
  whichever vision-capable LLM provider is active).
- Permission-aware chat: every turn gets a clearance-filtered
  retrieved-content source and a separate clearance-filtered
  document-name/description list, with a system prompt
  (`lib/llm/promptTemplates.ts`'s `CHAT_SYSTEM_PROMPT`) telling the model
  which source answers which kind of question. `npm test`
  (`tests/authz.test.ts`) is a real, automated proof of the access
  boundary, not just a manual check.
- Swappable LLM and embedding providers (Gemini, OpenAI, Anthropic,
  Ollama) — configured **through the admin UI, stored encrypted in the
  database**, not env vars. See `lib/llm/index.ts`, `lib/embeddings/
  index.ts`, and the "Important nuance" in `DEPLOYMENT_SETUP.md`.
- Employee management, department management, org hierarchy management,
  bulk employee import (CSV/XLSX, versioned, deduped, downloadable error
  reports), a three-tier usage-limiting system (per-employee/per-
  department/org-wide daily message caps, atomic and leak-proof — see
  `lib/usage/limits.ts`), and access-controlled audit logging
  (`lib/audit/`) covering essentially every admin action.
- A polished, from-scratch UI (not a template) — Employees/Departments/
  Hierarchy/Documents admin pages, a chat interface with regenerate/edit/
  scroll-preserving streaming, document search, sortable admin tables.

The `prisma/schema.prisma` file's own header comment and the doc comments
throughout `lib/db/queries/chunks.ts` and `lib/rag/chat.ts` are the most
authoritative in-repo explanation of the security model — read those
before touching anything retrieval- or authorization-related.

A few comments in the codebase refer to "the spec" (e.g.
`scripts/seed-authz-fixtures.ts`'s "the spec's own worked examples").
That's an external assignment/exercise brief the source project was
originally built against — it is **not** a file that exists anywhere in
this repo, so don't go looking for it; those comments are just historical
context for *why* certain role names or examples were chosen.

## This is still "Ask Evon" in every way that shows

Nothing has been renamed. The app still:
- Introduces itself as **"Ask Evon"** literally inside the system prompt
  the LLM receives every turn (`lib/llm/promptTemplates.ts`).
- Titles every page **"Ask Evon"** (`app/layout.tsx`'s metadata).
- Seeds a role hierarchy and one admin account styled after "Evon
  Technologies" (`cxo@evon.com` — see `scripts/seed-authz-fixtures.ts`
  and `prisma/seed.ts`).
- Uses `ask-evon` as the `package.json` project name.
- Ships the original project's logo (`logo.svg`) and its own `README.md`
  title/description.

`grep -rl "Evon" app components lib prisma scripts` turns up roughly two
dozen files. **Deciding how much of this to rename — and to what — is a
real decision for whoever works on this next, not something this copy
made for you.** Depending on how "Pollution Board" is actually meant to
work (is it a real pollution-control-board-themed RAG assistant? a
differently-themed reuse of the same architecture?), the honest scope of
that rename ranges from "just the display name and logo" to "the system
prompt's self-identification, every seeded role/example, and the whole
document-domain framing." Don't guess at that scope — ask, if it isn't
already obvious from whatever brought you to this folder.

## What was deliberately left out of this copy, and why

The copy was made with `rsync`, excluding everything below. None of it
exists anywhere in this folder — this isn't a "look elsewhere for it"
note, it's a record of what was intentionally not brought over:

| Excluded | Why |
|---|---|
| `.env` | Held **real, live secrets** for the source project's own production deployment (its Neon `DATABASE_URL`, `AUTH_SECRET`, `AI_CREDENTIALS_ENCRYPTION_KEY`, Blob token). Copying it would mean this project's local dev silently talks to a different, live project's database. `.env.example` (a values-free template) *was* copied — start from that. |
| `node_modules/`, `.next/`, `*.tsbuildinfo`, `next-env.d.ts` | Build artifacts / dependency installs — regenerate with `npm install` and `npm run dev`/`build`. Copying them would have made this a multi-gigabyte copy for no benefit. |
| `storage/` | The source project's **local-disk-stored uploaded documents** (its `STORAGE_PROVIDER=local` dev data) — real uploaded file bytes belonging to that project's own document library. |
| `EVON_Documents/` | The source project's demo document corpus (~109MB of PDFs/DOCX/PPTX already ingested into *its* database) — not relevant here. |
| `Scanned Documents/` | Real personal scanned documents (e.g. ID-style scans) used to test the source project's OCR pipeline — sensitive, and specific to that testing, not project source. |
| `Large Database/`, `Large Database.zip` | A separate standalone tool (and its zipped backup) built alongside the source project: a script that bulk-uploads a folder of documents to *that* project's live knowledge base, hardcoded to `https://ask-evon.vercel.app` and holding that deployment's actual admin login in its own `.env`. Entirely specific to that other, still-live deployment. |
| `.claude/` | Empty local Claude Code tooling state directory — nothing was in it to copy. |
| `scratch-*` | One-off local debug scripts/screenshots from past work sessions on the source project — explicitly documented in its own `.gitignore` as "never part of the app itself." |

If any of the above turns out to actually be wanted here after all (for
example, the bulk-upload tool, generalized to a new deployment instead of
hardcoded to the old one) — that's straightforward to rebuild from
scratch against this project's own knowledge base once it exists; it
doesn't need to be resurrected from the old copy.

## Git state

- The full commit history from the source project **was** kept (this
  wasn't a fresh `git init` — it's the same `.git`, same history, same
  branch). That history is clean: checked directly before the copy was
  made, no real secret, API key, or connection string was ever committed
  anywhere in it (only the documented, known-placeholder seed password
  `Password123!`, and `.env.example` — a template with no real values).
- `origin` (pointing at the source project's own GitHub repo) was removed
  immediately after copying. `git remote -v` here prints nothing. This
  repo has never been pushed anywhere since the copy — the first push
  you do will be to wherever you add as a new remote.
- The working tree was clean at copy time except for the untracked items
  in the exclusion table above (which is why they were easy to leave
  out cleanly rather than needing to be un-committed).

## Practical starting point

1. Read `DEPLOYMENT_SETUP.md` and get a local dev environment running
   first (`npm install`, `.env` from the template, local Postgres via
   `docker compose up -d`, migrate, seed, `npm run dev`) — confirm the
   *copy* actually works before deciding what to change.
2. Decide the renaming/rebranding scope described above, if that's part
   of this task.
3. Only then move on to real infrastructure (new GitHub repo, new Neon
   project, new Vercel project) — `DEPLOYMENT_SETUP.md` walks through
   each piece.
