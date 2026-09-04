// A small set of brand-adjacent colors, picked deterministically from the
// name itself (a stable hash, not random) so the same person always gets
// the same color across renders/reloads — purely a visual "tell people
// apart at a glance" aid in a dense list, the same reason chat apps and
// team-directory UIs color-code avatars. Every color pairs a light
// background with a readable-on-it text tone in both themes.
const PALETTE = [
  'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
];

// Exported for anything else that wants the same "stable color per name"
// treatment without a person's round-avatar shape — see TileIcon below,
// used for departments (a square/rounded-square tile reads as "an org
// unit," not "a person," the same visual convention Slack/Notion team
// icons use).
export function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * The one initials-avatar used anywhere a person needs a compact visual
 * identity — ProfileMenu.tsx's own account-menu avatar predates this and
 * is deliberately left as-is (always the current user, always the same
 * brand color, no "tell people apart" need), but every OTHER place a
 * person's identity shows up in a list (EmployeesTable, department member
 * lists) uses this shared version instead of re-deriving initials/colors
 * locally.
 */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-xs';
  return (
    <span
      className={`flex ${dimension} shrink-0 items-center justify-center rounded-full font-semibold ${colorFor(name)}`}
    >
      {initialsFor(name)}
    </span>
  );
}

/**
 * The department/org-unit counterpart to Avatar above — a rounded square
 * instead of a circle, the same visual grammar most team-directory apps
 * use to tell "an org unit" apart from "a person" at a glance. Same
 * deterministic color, one letter instead of two initials (a department
 * name is usually a whole phrase, not a first/last-name pair — "Sales &
 * Business Development" reduced to initials would read as noise, its
 * first letter reads as an icon).
 */
export function TileIcon({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base';
  return (
    <span
      className={`flex ${dimension} shrink-0 items-center justify-center rounded-lg font-semibold ${colorFor(label)}`}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
