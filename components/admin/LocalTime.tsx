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
export function LocalTime({ iso }: { iso: string }) {
  return <span suppressHydrationWarning>{new Date(iso).toLocaleString()}</span>;
}
