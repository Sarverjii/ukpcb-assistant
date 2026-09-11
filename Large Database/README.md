# UKPCB Assistant bulk document upload

Uploads every file in `Documents/` to the UKPCB Assistant knowledge base, with
clearance set so **every employee can see it**, then waits for the
server's own processing (text extraction / OCR / embedding) to finish
before moving to the next file. Safe to run over and over — anything
already uploaded is skipped, and only genuinely new or previously-failed
files are attempted.

Put new documents into `Documents/` whenever you like during the day;
the next scheduled run picks them up automatically.

This is a standalone script — it talks to the live UKPCB Assistant site over the
same HTTP API the web app itself uses, exactly the way logging in and
clicking "Upload" in a browser would. It is **not** part of the Next.js
app and doesn't need the rest of the project's `node_modules`.

## One-time setup

1. **Install Node.js** if it isn't already (Linux: your package manager,
   e.g. `sudo dnf install nodejs`; Windows: https://nodejs.org — the LTS
   installer). Node 18 or newer works; this was built and tested on
   Node 22.
2. **Install this folder's one dependency** — open a terminal in this
   folder and run:
   ```
   npm install
   ```
   This creates a local `node_modules/` here (a few MB, just the Vercel
   Blob upload client) — it's separate from, and doesn't touch, the main
   UKPCB Assistant project's own `node_modules`.
3. **Set your credentials**: copy `.env.example` to `.env` in this same
   folder, then open `.env` and fill in:
   ```
   UKPCB_EMAIL=admin@ukpcb.gov.in
   UKPCB_PASSWORD=<the real password>
   ```
   The account needs "can upload documents" permission on its role — any
   admin account qualifies. `.env` is already excluded from git (see the
   main project's `.gitignore`) so this password is never committed.
4. **Put your documents in `Documents/`** (already created, already
   containing whatever's there now). Subfolders are fine — every file
   inside them is picked up too.
5. **Try one run by hand** before scheduling anything:
   - Linux: `./run-upload.sh`
   - Windows: double-click `run-upload.bat`

   Watch the output. It logs every file as UPLOAD → DONE (or a clear
   reason if something failed), then a summary. A second run right after
   should show everything as `SKIP … already uploaded`.

## What "clearance to everyone" actually means here

Every document this script uploads is given every clearance level and
every department — exactly what you'd see if you opened the real upload
form and ticked every pill by hand. Concretely: at the start of each run,
after logging in, the script calls the app's own
`GET /api/documents/upload-defaults` to ask "what's the lowest role that
currently exists, and what departments currently exist," and uses
whatever comes back. So in the admin Knowledge Base table, an uploaded
document shows every clearance pill checked (down to the current lowest
role, e.g. Trainee) and every department pill checked — not a placeholder
or a magic number, the same real values a person editing that document by
hand would see and could then deselect individual ones from, exactly like
you'd expect.

### Why fetched from the server?

An earlier version of this script hardcoded a clearance level of
`-1000000` — a number chosen to sit below any real role, which is fine
for the actual access check (a document is visible to anyone whose role
rank is **at or above** its clearance level, so any sufficiently low
number passes for everyone) but looked broken in the admin UI: the
clearance picker there only highlights a pill on an **exact match**
against a real role's rank, so a value matching no real role rendered as
nothing selected at all, instead of "every role selected." Fetching the
real lowest role's actual rank every run — the same lookup the app's own
built-in "add from a URL" feature already uses for the same "everyone"
guarantee — fixes that display and keeps working correctly even if the
hierarchy changes later (a new, even more junior role added below
today's lowest one is picked up automatically on the next run).

If you ever want new uploads to be more restricted than "everyone,"
override it manually with `CLEARANCE_LEVEL=<a real role's rank>` in
`.env` — otherwise leave it unset.

## Scheduling a daily 12:00 PM run

### Linux (cron)

Open your crontab:
```
crontab -e
```
Add a line (adjust the path if this folder ever moves):
```
0 12 * * * "/home/sarthverma/Evon/Pollution Board/Large Database/run-upload.sh" >> "/home/sarthverma/Evon/Pollution Board/Large Database/logs/cron.out" 2>&1
```
That runs it every day at 12:00 PM. The script keeps its own detailed,
dated logs in `logs/upload-YYYY-MM-DD.log` regardless — the `cron.out`
redirect above is just a catch-all for anything printed before the
script's own logger starts (e.g. "node not found").

Run `crontab -l` afterward to confirm the line is there.

### Windows (Task Scheduler)

1. Open **Task Scheduler** → **Create Task…** (not "Basic Task" — the
   full dialog gives you more control).
2. **General** tab: name it (e.g. "UKPCB Assistant bulk upload"). Tick "Run
   whether user is logged on or not" if you want it to run even when
   you're logged out.
3. **Triggers** tab → **New…** → Daily, start time **12:00:00 PM**,
   recur every 1 day.
4. **Actions** tab → **New…** → Action "Start a program":
   - Program/script: `"C:\path\to\Large Database\run-upload.bat"`
   - Start in: `C:\path\to\Large Database`

   (Prefer PowerShell? Use `run-upload.ps1` instead: Program/script
   `powershell.exe`, Arguments
   `-ExecutionPolicy Bypass -File "C:\path\to\Large Database\run-upload.ps1"`.)
5. **Conditions**/**Settings** tabs: defaults are fine. Under Settings you
   may want to tick "Run task as soon as possible after a scheduled start
   is missed" so a run isn't silently lost if the PC was asleep at noon.
6. Save. Right-click the task → **Run** once to confirm it works, then
   check `logs\` for today's log file.

## How it stays "failure proof"

- **Dedup is by file content, not filename.** Every file is hashed
  (SHA-256); the hash is looked up in `upload-state.json` (created here
  automatically — don't delete it, that's what makes skip-if-already-
  uploaded work). Renaming a file doesn't cause a re-upload; it's still
  recognized as the same document.
- **The local ledger is never trusted blindly — it's re-checked against
  the real knowledge base every run.** `upload-state.json` only records
  what this script itself did; it has no way to know about a document
  someone deleted by hand through the admin UI in between runs. So every
  file this script previously uploaded gets a fresh, live status check
  before being skipped. If that document is gone, it's uploaded again,
  automatically — you never need to touch `upload-state.json` by hand
  after deleting something in the app. This costs one extra quick request
  per already-uploaded file per run, which is the trade-off for never
  skipping something that isn't actually there anymore.
- **A crash or killed process never causes a duplicate.** The moment a
  file's Document row is actually created on the server, that fact is
  saved to `upload-state.json` immediately — before this script even
  starts waiting for the server to finish processing it. If the script
  dies right after (power loss, killed process, network drop), the next
  run sees that in-flight record and checks on the *same* document
  instead of uploading the file again.
- **A file that fails to upload (network/auth error) is retried
  automatically** on the next run — nothing was created for it, so
  there's nothing to duplicate.
- **A file the server genuinely couldn't process** (corrupt/unreadable
  content, etc.) is *not* retried automatically — retrying a broken file
  would just create another broken entry every single run. It's skipped
  on later runs with a loud reminder of the reason in the log, until you
  either fix the file or replace it (a changed file gets a new hash and
  is treated as brand new).
- **Two runs can't collide.** A lock file (`.upload.lock`) stops a second
  run from starting while one is still in progress; a lock older than 6
  hours is assumed to belong to a crashed process and is taken over
  automatically rather than blocking forever.
- **Every outcome is logged with a reason** — see `logs/upload-YYYY-MM-DD.log`
  for a full, timestamped, human-readable record of every file this
  script has ever looked at: uploaded, skipped (and why), or failed (and
  why).

## Files in this folder

| File | Purpose |
|---|---|
| `Documents/` | Put the files you want uploaded here. |
| `upload-documents.mjs` | The actual script — reads `Documents/`, uploads, polls, logs. Identical logic on Linux and Windows; only the two wrapper scripts below differ per OS. |
| `run-upload.sh` | Linux entry point (cron target). |
| `run-upload.bat` / `run-upload.ps1` | Windows entry points (Task Scheduler target) — two equivalent options, .bat and PowerShell. |
| `.env` | Your real credentials (create from `.env.example`; git-ignored). |
| `upload-state.json` | The dedup/resume ledger — don't delete or hand-edit this. |
| `.upload.lock` | Exists only while a run is in progress; safe to delete if you're certain nothing is running. |
| `logs/` | One dated log file per day this has run. |

## Troubleshooting

- **"Login did not return a session cookie"** — wrong email/password in
  `.env`, or the account doesn't have upload permission.
- **A file is stuck at `WAIT … still processing`** every run — a very
  large or slow scanned document can legitimately take a while; it'll
  keep being picked back up (see `POLL_TIMEOUT_MS` in `.env.example` if
  you want to wait longer per run before moving on).
- **Want to force a re-upload of one specific file** — delete it from the
  knowledge base itself (Documents tab → Delete). The next run detects
  that on its own and re-uploads it — you don't need to touch
  `upload-state.json`. (Editing `upload-state.json` alone, without also
  deleting the document from the app, would just create a duplicate: the
  old document is still there, and this script would upload a second copy
  alongside it.)
