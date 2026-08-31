// Shown instantly by Next.js while this segment's server component awaits
// its DB queries (getAuthContext() plus whatever the page itself fetches).
// Without this, the browser showed nothing at all between a nav click and
// full render — every click into /admin, /admin/employees,
// /admin/documents, or /settings read as a stall rather than "loading."
// Doesn't reduce the actual round-trip time (see vercel.json's region pin
// for that) — just gives instant feedback while it happens.
export default function Loading() {
  return (
    <div className="flex items-center gap-2 px-6 py-8 text-sm text-zinc-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600 dark:border-zinc-700 dark:border-t-brand-500" />
      Loading…
    </div>
  );
}
