# Deployment setup checklist

This folder is a **code-only copy** of the "Ask Evon" project, made on
2026-09-11 as a starting point for a new, unrelated deployment (working
name: "Pollution Board"). Nothing here is connected to anything live yet:

- **No git remote.** The copy's `origin` (`github.com/Sarverjii/ask-evon`)
  was deliberately removed right after copying. `git remote -v` in this
  folder prints nothing. Add a new one yourself once you have a repo to
  push to:
  ```bash
  git remote add origin <your-new-repo-url>
  git push -u origin main
  ```
- **No `.env` file.** The original project's `.env` held real secrets for
  a *different, still-live* production deployment (its own Neon database,
  its own Vercel Blob store, its own Auth.js secret, its own AI provider
  credentials) — it was intentionally **not** copied here, and it must
  never be. Reusing those values here would mean this project's local dev
  and this project's eventual deployment are silently reading and writing
  the other project's live database. Every value below needs to be
  generated or obtained fresh, specifically for this project.
- **No linked Vercel project, no linked Neon database.** There was never
  a `.vercel/` folder in the source project (it was connected to Vercel
  through GitHub's integration, not the Vercel CLI), and nothing
  project-specific was copied — `vercel.json` here only sets a deploy
  region (`sin1`), it isn't a link to any project. Both need to be created
  from scratch for this project; see the walkthrough below.
- **No instance data.** The source project's uploaded documents, local
  document storage folder, demo document corpus, and a separate bulk-
  upload tool (with its own saved login credentials) were all deliberately
  excluded from the copy — see `PROJECT_CONTEXT.md`'s "What was
  deliberately left out of this copy" section for the full list and why.

Everything below is condensed from the original project's own `README.md`
(still present in this folder, and still accurate — read it for the full
picture, architecture notes, and local dev instructions) — this file is
just the specific "what do I need to go create/fill in" checklist for
turning this code into a *running* app again, locally and on Vercel.

## 1. Local dev environment

```bash
npm install                      # also runs `prisma generate` (postinstall)
cp .env.example .env
npx auth secret                  # generates AUTH_SECRET into .env for you
# ^ if this resolves to an unrelated npm package instead of Auth.js's own
# CLI (prints BETTER_AUTH_SECRET, doesn't touch .env), generate one by hand:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# and set AUTH_SECRET to it yourself.
docker compose up -d             # starts local Postgres + pgvector on :5434
```

`.env.example` in this folder documents every environment variable this
app reads (the authoritative list is `lib/config.ts`, which fails fast at
startup if something required is missing or malformed). At minimum for
local dev:

| Variable | Where it comes from | Required? |
|---|---|---|
| `DATABASE_URL` | `docker-compose.yml`'s defaults work as-is for local dev (`postgresql://ukpcb:ukpcb@localhost:5434/ukpcb`) | Yes |
| `DATABASE_URL_TEST` | Same pattern, a **separate** database — never point this at the same DB as `DATABASE_URL` (the authorization test suite truncates tables) | Yes, to run `npm test` |
| `AUTH_SECRET` | `npx auth secret` (writes it into `.env` for you) | Yes |
| `EMBEDDING_DIMENSIONS` | Defaults to `768` — leave it unless you have a specific reason to change it (see "The vector-dimension lock-in" note below) | No (has a default) |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Not required to boot the app, but required before anyone can save an API key through Admin → AI Models |
| `STORAGE_PROVIDER` | `local` for local dev (default); must be `vercel-blob` on Vercel (see step 4) | No (has a default) |
| `STORAGE_LOCAL_DIR` | Defaults to `./storage/documents` | No (has a default) |
| `UPLOAD_MAX_MB` | Defaults to `100` | No (has a default) |
| `GEMINI_API_KEY` | Only read by the **test suite** (`tests/setup.ts`), never the app itself — see the note below | No, unless you want `npm test`'s model-calling tests to run |

**Important nuance — the LLM and embedding provider are NOT env vars.**
Unlike most projects like this, there is no `LLM_PROVIDER=` or
`OPENAI_API_KEY=` env var the running app reads. Provider selection and
every API key are entirely **database-driven**, configured by logging in
as an admin and using the **Admin → AI Models** page — see
`lib/llm/index.ts` and `lib/embeddings/index.ts`. This was a deliberate
design choice in the source project (an admin can swap providers or
rotate a key without a redeploy). `GEMINI_API_KEY` is the one exception,
and only for `npm test`'s own convenience (`tests/setup.ts` reads it
directly to auto-provision a working provider so the test suite doesn't
need the admin UI driven first) — the deployed app itself never reads it.

**Practical implication for a fresh deployment:** after the app is up and
you've logged in as the seeded admin, your very first stop is **Admin →
AI Models** to add a real LLM + embedding provider and API key before
chat or document upload will do anything. Nothing about this is
pre-configured by an env var, on purpose.

### First migration — pgvector needs one hand-edited step

**This only matters if you are starting completely fresh** (a brand new,
never-migrated database). If you're pointing this at a database that
already has these tables — you won't be, since this is a fresh Neon
project — skip to "Applying an already-drafted migration set" below.

Prisma can't natively express the pgvector column type or the `hnsw`
index it needs, so the *very first* migration this schema ever produces
needs one manual edit. This repo's `prisma/migrations/` folder already
has 18 real, already-drafted migrations from the source project (the
`_init` one already has this hand-edit baked in) — so for a **fresh
database, you almost never need to do this again**, you just apply what's
already there:

```bash
npm run db:migrate    # applies every migration in prisma/migrations/
```

You'd only ever repeat the manual-edit dance below if you're adding a
*new* migration that touches `DocumentChunk`'s vector column or its index
for the first time in a schema that doesn't already have them (it won't,
for this copy — that's already done):

```bash
npx prisma migrate dev --create-only --name <whatever>
```

Then in the generated `migration.sql`, add near the top:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
and near the bottom:
```sql
CREATE INDEX document_chunks_embedding_idx
  ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
```
before running `npx prisma migrate dev` to apply it.

**A standing gotcha worth knowing about even though you won't hit it on
a fresh DB**: whenever `DocumentChunk` is touched by a *later* schema
change, Prisma's own migration-diffing has repeatedly tried to generate a
spurious `DROP INDEX "document_chunks_embedding_idx"` (it doesn't
recognize the hand-added HNSW index as something it created, so it
sometimes wants to drop and never recreate it). Every time a future
migration touches that table, open the generated SQL and check for that
line before applying it.

### Seed the database

```bash
npm run db:seed
```

Seeds **only** the role hierarchy (organizational configuration — see
`scripts/seed-authz-fixtures.ts`'s `ROLE_DEFS`) and one admin account, no
demo employees or documents:

| Email | Password | Role |
|---|---|---|
| `admin@ukpcb.gov.in` | `Password123!` | Member Secretary — full admin dashboard + document upload |

**Change this password (or the seed script itself) before this ever goes
anywhere someone else can reach it.** It's a known, documented default —
fine for local dev, not for anything live. The six seeded role names
(Member Secretary down to Junior Engineer) mirror a real state Pollution
Control Board's org structure — see `PROJECT_CONTEXT.md` for the full
rationale and the exact rank mapping.

```bash
npm run dev    # http://localhost:3000
```

## 2. A real Postgres database — Neon

1. Create a project at [neon.tech](https://neon.tech) (free tier, no card
   needed).
2. In Neon's SQL editor, run once:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   (pgvector isn't enabled by default on a fresh Neon project.)
3. Copy the **pooled** connection string Neon gives you — that's your
   production `DATABASE_URL`.
4. Apply this repo's already-drafted migrations against it:
   ```bash
   DATABASE_URL="<your-neon-url>" npx prisma migrate deploy
   ```
   (`migrate deploy`, not `migrate dev` — `dev` is for local schema
   iteration and will ask interactive questions; `deploy` just applies
   what's already committed in `prisma/migrations/`.)
5. Seed it the same way:
   ```bash
   DATABASE_URL="<your-neon-url>" npm run db:seed
   ```

## 3. Push to a new GitHub repo

```bash
git remote add origin <your-new-repo-url>
git push -u origin main
```

(This repo's git *history* was kept — see `PROJECT_CONTEXT.md` for what
that means and why — but it has never been pushed anywhere since the copy
was made; you're pushing it fresh.)

## 4. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → import the GitHub repo from
   step 3.
2. **Storage — Vercel Blob**: in the new project's Storage tab, create a
   Blob store and connect it. This auto-injects `BLOB_STORE_ID`, but
   **not** `BLOB_READ_WRITE_TOKEN` — confirmed directly in the source
   project: that token is genuinely absent from `process.env` even after
   connecting a store this way, and the client-direct-upload flow
   (`app/api/documents/blob-upload-token/route.ts`) hard-requires it with
   no fallback. Get it from the Blob store's own settings/quickstart page
   and add it as an env var by hand.
3. In the Vercel project's Environment Variables settings, set:
   - `DATABASE_URL` — the Neon pooled connection string from step 2.
   - `AUTH_SECRET` — generate a **new** one for this deployment (don't
     reuse your local dev one): `npx auth secret`, or
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   - `STORAGE_PROVIDER` = `vercel-blob` — **this is not the default**
     (the default is `local`, which does not work on Vercel — serverless
     functions have no persistent shared filesystem).
   - `BLOB_READ_WRITE_TOKEN` — from step 2.
   - `AI_CREDENTIALS_ENCRYPTION_KEY` — generate a **new** one for this
     deployment: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
     Required before Admin → AI Models can save any provider credential.
   - `EMBEDDING_DIMENSIONS` — only set this if you're deliberately
     deviating from the default of `768`; otherwise leave it unset.
4. Deploy.
5. Log in as the seeded Member Secretary account (step 1's table — **after** changing
   that password if this is going anywhere real), go to **Admin → AI
   Models**, and add a real LLM + embedding provider and API key. Nothing
   works for chat or document upload until this step is done — see the
   "Important nuance" callout above.
6. Add real employees and documents through the admin dashboard.

## Things worth double-checking before calling this "done"

- **The vector-dimension lock-in**: `EMBEDDING_DIMENSIONS` (768 by
  default) is a fixed Postgres `vector(N)` column width, set once at
  schema-migration time — not a per-provider setting you can casually
  change later. Whatever embedding provider/model you configure in Admin
  → AI Models must produce vectors of exactly this size (Gemini and
  OpenAI can both be asked for 768; a local Ollama model must natively
  produce that size). Changing it later requires a new migration *and*
  re-embedding every existing chunk.
- **The seeded password.** `Password123!` is a known value, documented in
  this very repo's `README.md` and `scripts/seed-authz-fixtures.ts`. Treat
  it as a placeholder to change immediately, not a real credential.
- **Region**: `vercel.json` pins deploys to `sin1` (Singapore) — the
  source project's own choice, presumably to sit close to its Neon
  region. Reconsider this for wherever this project's actual users and
  Neon project are.
- **App identity**: rebranded from the source "Ask Evon" project to the
  Uttarakhand Pollution Control Board — the running app now introduces
  itself as "UKPCB Assistant" (system prompt in
  `lib/llm/promptTemplates.ts`, page title in `app/layout.tsx`), uses the
  UKPCB seal (`public/logo.png`, `app/icon.png`) and a green accent
  palette (`app/globals.css`) matching it, and the seeded admin account
  uses `ukpcb.gov.in`-style naming, and the seeded role hierarchy itself
  was renamed to a Pollution Control Board org structure (Member
  Secretary down to Junior Engineer). See `PROJECT_CONTEXT.md` for the
  exact rank mapping and what was deliberately left unchanged (the
  fixture document names/content the automated test suite asserts on).
