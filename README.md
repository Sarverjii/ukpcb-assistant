# UKPCB Assistant

A role-based enterprise AI knowledge assistant for the Uttarakhand Pollution
Control Board. Employees log in and ask an AI chatbot questions about the
Board; the AI only ever answers Board questions from documents their role is
cleared to see, and can still answer
ordinary general questions (small talk, arithmetic, "what's the capital of
France") normally instead of refusing everything. See the top of
`prisma/schema.prisma` and the doc comments in `lib/db/queries/chunks.ts` /
`lib/rag/chat.ts` for how the authorization boundary is actually enforced (at
the database query, before retrieval — not by asking the LLM to keep a
secret). Every turn, the LLM call gets two clearance-filtered sources — the
retrieved document *content* (`contextChunks`, possibly empty) and a
clearance-filtered list of document *names/descriptions*
(`listAccessibleDocumentSummaries`, metadata only, never content) — and a
single system prompt (`CHAT_SYSTEM_PROMPT` in `lib/llm/promptTemplates.ts`)
that tells it which source answers which kind of question: content
questions from `contextChunks` only (falling back to the fixed refusal when
that's empty or insufficient), and meta-questions about the collection
itself ("how many documents", "name them all", "is there a document about
X") from the document-name list. Both sources are always clearance-filtered
before the model ever sees them, so there's nothing restricted in either one
for the model to leak regardless of how it behaves — the prompt is a
second-order mitigation, not the actual guarantee.

Covers the full MVP scope from the spec: auth + roles, document upload/
management with a live admin dashboard, permission-aware chat that provably
enforces the clearance boundary (`npm test`), employee management, and
access-controlled audit logging. MFA, SSO, self-service password reset (needs
an email provider — deliberately not wired up), and department-scoped ACLs
are the remaining deferred items — see "What's not built yet" below.

## Prerequisites

- Node.js 20.9+ (this project was built against Node 22)
- Docker + Docker Compose (for local Postgres/pgvector), **or** any
  Postgres 16+ instance with the `pgvector` extension installed
- A free Gemini API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))
  for chat — this is the default `LLM_PROVIDER`. No card required; just
  never attach billing to that Google Cloud project, or the free tier
  disappears for it entirely.

## Setup

```bash
npm install                      # also runs `prisma generate` (postinstall)
cp .env.example .env             # fill in GEMINI_API_KEY
npx auth secret                  # generates AUTH_SECRET into .env for you

docker compose up -d             # starts Postgres + pgvector on :5434
npm run db:migrate               # applies prisma/migrations/ (see note below)
npm run db:seed                  # seeds the role hierarchy + one Member Secretary account

npm run dev                      # http://localhost:3000
```

### Chat provider options

`LLM_PROVIDER` picks which `LLMProvider` implementation runs — see
`lib/llm/index.ts`. No other code changes needed to switch:

| Provider | Cost | Where it can run | Notes |
|---|---|---|---|
| `gemini` (default) | Free (Google's free API tier) | Anywhere — it's a hosted API call | `GEMINI_API_KEY` from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `ollama` | Free (local model) | Only where you can run a several-GB local model — **not** typical free hosting tiers (e.g. Render's free 512MB web service) | `ollama pull llama3.1:8b` first |
| `anthropic` | Paid (Claude Sonnet 5) | Anywhere | Best quality; ~$0.01/query. `ANTHROPIC_API_KEY` required |

### First migration (pgvector needs one hand-edited step)

Prisma can't natively express the pgvector column type or the `hnsw` index,
so the very first migration needs one manual edit:

```bash
npx prisma migrate dev --create-only --name init
```

Open the generated `prisma/migrations/<timestamp>_init/migration.sql` and add,
near the top and bottom respectively:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

```sql
CREATE INDEX document_chunks_embedding_idx
  ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
```

Then apply it:

```bash
npx prisma migrate dev
```

Subsequent schema changes only need `npm run db:migrate` as usual.

### The seeded account

`npm run db:seed` deliberately seeds only the role hierarchy (configuration,
not data) and one Member Secretary admin account — no demo employees, no documents. Add
your own real employees and documents through the admin dashboard.

| Email | Password | Role |
|---|---|---|
| `cxo@ukpcb.gov.in` | `Password123!` | Member Secretary — admin dashboard + document upload |

### Admin dashboard

Log in as the Member Secretary account and a profile menu (bottom-left of the sidebar)
gives access to:

- **`/admin`** — overview stats (employees, documents, documents by
  clearance, AI questions asked, recent activity)
- **`/admin/employees`** — add employees, change role/clearance, disable/
  enable accounts, reset passwords (shown once, since there's no email
  provider wired up to send it — share it with the employee out of band)
- **`/admin/documents`** — change a document's clearance (re-indexes every
  existing chunk immediately, no re-embedding needed), replace the file
  (reprocesses from scratch), delete, or download
- **`/admin/hierarchy`** — the configurable clearance hierarchy itself:
  reorder roles (shuffles `hierarchyRank`), add a new role (starts at the
  bottom, shuffle it into position), toggle a role's upload/admin
  capabilities. This is section 22 of the spec ("configurable hierarchy")
  made concrete as a UI, not just a DB column.
- **`/admin/audit-logs`** — paginated, access-controlled audit trail

All of this is gated server-side by `requireAdmin()` (`lib/auth/rbac.ts`),
independent of whether the nav link is visible — verified directly, not just
assumed: a non-admin hitting `/admin/employees` by URL gets redirected, and
calling the admin-only APIs directly (upload, download) returns 403.

### Chat UI

`/chat` is a ChatGPT-style shell (`app/(chat)/layout.tsx`): a collapsible
left sidebar with "New chat", a list of past conversations (auto-titled from
the first message, deletable via the hover trash icon — two clicks to
confirm), and a profile menu at the bottom (role/clearance, Admin and Upload
Documents links when applicable, sign out). Each conversation lives at
`/chat/[id]`, scoped to its owner at the query level — another user's
conversation ID simply 404s, it doesn't leak content, and deleting one you
don't own is a silent no-op rather than an error that would confirm it exists.

`/` and the bare `/chat` route are always a genuinely fresh, empty composer
— never auto-resuming your last conversation — and do it with zero database
writes: no row exists until you actually send a first message, at which
point `createConversationAndSendMessage` (`app/(chat)/chat/actions.ts`)
creates it and the URL updates to `/chat/[id]`. Opening the app repeatedly
never litters your history with empty conversations.

Assistant answers render as real markdown (`components/chat/Markdown.tsx`,
`react-markdown` + `remark-gfm`) — bold, lists, headings, tables, code blocks
— rather than raw text with literal `**`/`*` characters. User messages stay
plain text (exactly what was typed), which is the standard chat-UI
convention.

### Theme

Light by default — never tied to OS/browser `prefers-color-scheme` (Tailwind
v4's class-based `@custom-variant dark` in `app/globals.css`, not the
media-query default). Toggle it from the profile menu (chat sidebar) or the
theme icon (admin/upload header); the choice is saved to the user's account
(`User.themePreference`, not `localStorage`), so it follows them to any
browser or device, and is resolved server-side on every request
(`lib/theme.ts`) so there's no flash of the wrong theme on load. Dark mode
uses a true near-black surface (Tailwind's `zinc` scale, not `slate`, which
carries a blue-gray cast) with the brand navy reserved purely as an accent —
"black with blue", not "blue-black".

## Running the authorization tests

```bash
# Point DATABASE_URL_TEST (in .env) at a separate, migrated database — never
# reuse the dev database for tests.
npm test
```

`tests/authz.test.ts` is the actual proof of the spec's core requirement: it
seeds users at every clearance level plus a document containing a prompt
injection attempt, then asserts a lower-clearance user's retrieval never
surfaces a higher-clearance document — at the SQL layer directly (no LLM
required for this part), and through the full chat flow when a `LLM_PROVIDER`
is actually configured (Gemini, Ollama, or Anthropic).

## Provider swap points

Three interfaces are the intended extension points — see the doc comments on
each for what changing providers involves:

- `lib/llm/` — `LLMProvider`, three implementations (`geminiProvider.ts`,
  `ollamaProvider.ts`, `anthropicProvider.ts`) selected via `LLM_PROVIDER` —
  see the table above.
- `lib/embeddings/` — `EmbeddingProvider`. Default is `gemini`
  (`gemini-embedding-001`, 768-dim, reuses `GEMINI_API_KEY` — no local
  memory footprint). `local` (`Xenova/all-MiniLM-L6-v2`, 384-dim, no API
  key needed) is still available for local dev, but running it repeatedly
  is what crashed a real deployment on a memory-constrained host — see
  `lib/embeddings/geminiEmbeddingProvider.ts`'s doc comment. `openai` is a
  stub. Switching between any of them needs a schema migration
  (`vector(N)` in `prisma/schema.prisma`) and re-embedding every existing
  chunk — the vectors aren't interchangeable across models.
- `lib/documents/storage.ts` — `StorageProvider`, local disk (dev) or
  `vercel-blob` (`lib/documents/vercelBlobStorage.ts`) via `STORAGE_PROVIDER`.

## Deploying (Vercel + Neon)

This is the deployment path actually tested for this project. Both have
free tiers with no card required.

Note: `EMBEDDING_PROVIDER` defaults to `gemini` (hosted API, reuses
`GEMINI_API_KEY`) rather than `local` — the local model needs to run
in-process, which doesn't work well in a serverless function at all
(see the `EmbeddingProvider` note above). No extra setup needed here; it's
already the default.

1. **Database — [Neon](https://neon.tech)**: create a project, then in the
   SQL editor run `CREATE EXTENSION IF NOT EXISTS vector;` once (pgvector
   isn't enabled by default). Copy the pooled connection string for
   `DATABASE_URL`.
2. **Push this repo to GitHub**, then import it in
   [Vercel](https://vercel.com/new).
3. **Storage — Vercel Blob**: in the project's Storage tab, create a Blob
   store and connect it to the project. This injects `BLOB_READ_WRITE_TOKEN`
   automatically — nothing to copy by hand. Set `STORAGE_PROVIDER=vercel-blob`
   in the project's environment variables (it defaults to `local`, which does
   **not** work on Vercel — see the `StorageProvider` note above).
4. **Set the rest of the env vars** from `.env.example` in Vercel's project
   settings (`DATABASE_URL`, `AUTH_SECRET` — generate with `npx auth secret`
   — `GEMINI_API_KEY`, etc.).
5. **Run migrations against the Neon database** before or right after the
   first deploy: `DATABASE_URL="<neon-url>" npx prisma migrate deploy` from
   your machine (not `migrate dev` — that's for local schema iteration).
6. **Seed the role hierarchy + Member Secretary account**:
   `DATABASE_URL="<neon-url>" npm run db:seed`.
7. Deploy. Log in as the seeded Member Secretary account and upload real documents /
   create employees through the admin dashboard, same as local dev.

## What's not built yet

- **MFA** — spec marks this optional; no architecture beyond the standard
  Auth.js provider extension points has been built.
- **SSO / Google / Microsoft / Active Directory** — Auth.js supports adding
  OAuth providers alongside Credentials without restructuring; not wired up.
- **Self-service "forgot password" email flow** — the admin-initiated reset
  in `/admin/employees` covers the spec's password-reset requirement without
  needing an email provider decision; a self-service flow would need one.
- **Department-scoped / explicit per-document permissions, groups** — the
  schema already carries `department` on `User` and `Document` unused by
  retrieval filtering (see `prisma/schema.prisma`), so this is an additive
  `WHERE` clause later, not a redesign.
- **Streaming token-by-token chat responses, thumbs up/down feedback** —
  copy and regenerate are built; responses aren't streamed yet.
- **Multi-tenant isolation** — single-tenant only; no `Tenant` entity yet.
- **Deleting a role** — the hierarchy manager can add and reorder roles, but
  not delete one (undefined behavior for existing users/documents already
  assigned that clearance level — needs a deliberate migration policy, not
  a quick add).
