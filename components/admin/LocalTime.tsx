'use client';

// Vercel's server functions render in UTC while a browser formats
// toLocaleString() in the viewer's own locale/timezone — the two rarely
// agree, so rendering this directly produced a real hydration mismatch
// here (confirmed locally: server sent "30/08/2026, 19:01:54", the browser
// then discarded it and re-rendered "30/8/2026, 7:01:54 pm"), forcing
// React to redo the whole row on every load — one more thing making admin
// pages feel laggy. suppressHydrationWarning is React's own documented
// fix for exactly this case (a value that's expected, not a bug, to
// render differently server vs. client) — it accepts the client's version
// for this one text node instead of discarding and re-rendering the tree
// around it. See https://react.dev/link/hydration-mismatch.
//
// The explicit 'use client' directive matters beyond hydration: without
// it, a page that imports this directly as a Server Component (no client
// ancestor to pull it into the client bundle transitively) renders
// toLocaleString() on the SERVER instead — using Vercel's runtime
// timezone (UTC) rather than the viewer's browser timezone. That bug was
// invisible in local dev (this machine's own OS timezone happens to be
// IST, so a server-rendered timestamp looked "correct" by coincidence)
// but showed real UTC timestamps on production. Forcing this to always be
// a client component, regardless of what imports it, is what actually
// guarantees browser-timezone formatting everywhere it's used.
export function LocalTime({ iso }: { iso: string }) {
  return <span suppressHydrationWarning>{new Date(iso).toLocaleString()}</span>;
}
