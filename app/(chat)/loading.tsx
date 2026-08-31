// See app/(app)/loading.tsx for why this exists — same instant-feedback
// fix, here for switching between conversations in the sidebar (each
// /chat/[id] page fetches that conversation's messages from the DB).
export default function Loading() {
  return (
    <div className="flex items-center gap-2 px-6 py-8 text-sm text-zinc-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600 dark:border-zinc-700 dark:border-t-brand-500" />
      Loading…
    </div>
  );
}
