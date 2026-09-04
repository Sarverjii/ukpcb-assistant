'use client';

import { useSyncExternalStore } from 'react';

// Vercel's server functions render in UTC while a browser formats
// toLocaleString() in the viewer's own locale/timezone — the two rarely
// agree. The first version of this component rendered the formatted
// string directly with suppressHydrationWarning, on the assumption that a
// server/client text mismatch gets silently patched to the client's own
// value. That assumption was wrong: suppressHydrationWarning tells React
// to trust whatever the server sent and never reconcile it, not "prefer
// the client." Confirmed directly — forcing a local server to run in UTC
// while the browser stayed on its real IST timezone still displayed the
// server's UTC-formatted string with that version, both locally and on
// production (Vercel's functions run in UTC).
//
// useSyncExternalStore is React's own documented tool for exactly this
// shape of problem — a value that must legitimately differ between the
// server-rendered snapshot and the client snapshot, resolved after
// hydration with no "external system" to subscribe to (hence the no-op
// subscribe). getServerSnapshot supplies the raw ISO string until
// hydration completes; getSnapshot then takes over with the browser's own
// locale/timezone-formatted string — a real state transition, not a
// hydration-mismatch patch, so there's nothing for React to warn about.
const noopSubscribe = () => () => {};

export function LocalTime({ iso }: { iso: string }) {
  const formatted = useSyncExternalStore(
    noopSubscribe,
    () => new Date(iso).toLocaleString(),
    () => iso,
  );
  return <span>{formatted}</span>;
}
