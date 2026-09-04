'use client';

import { Check } from 'lucide-react';

export type PickableRole = { hierarchyRank: number; name: string };

/**
 * A horizontal row of pills for picking a document's clearance level —
 * visually modeled on DepartmentCheckboxList (same pill shape/spacing),
 * requested directly after that component shipped for department tagging,
 * as a more legible replacement for a bare `<select>` of role names.
 *
 * Unlike DepartmentCheckboxList, this is NOT a multi-select: exactly one
 * clearance level is ever chosen. What's borrowed is only the pill
 * styling — the highlighting behavior represents a THRESHOLD, not an
 * independent set of toggles. `roles` arrives already ordered most-senior
 * first (every caller sources it from listRolesByRankDesc), so clicking a
 * pill highlights it and every pill to its LEFT (i.e. every more-senior
 * role) alongside it, leaving less-senior roles to the right unhighlighted
 * — a direct visual echo of retrieveAuthorizedChunks's actual rule
 * (`clearanceRank <= userClearanceRank`): everyone at or above the chosen
 * rank can see a document set to it, and the picker now shows exactly who
 * that is at a glance instead of leaving it implicit in a dropdown list.
 */
export function ClearanceLevelPicker({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: PickableRole[];
  // null/'' both mean "nothing chosen yet" — accepts either since callers
  // hold this in a `useState<string>('')` (to match a native <select>'s
  // empty option) rather than `number | null`.
  value: number | string | null;
  onChange: (hierarchyRank: number) => void;
  disabled?: boolean;
}) {
  if (roles.length === 0) {
    return <p className="text-xs text-zinc-400">No clearance levels exist yet.</p>;
  }

  const selectedIndex =
    value === null || value === '' ? -1 : roles.findIndex((r) => r.hierarchyRank === Number(value));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-row flex-wrap items-center gap-1.5">
        {roles.map((r, i) => {
          const isChosen = i === selectedIndex;
          const inRange = selectedIndex !== -1 && i <= selectedIndex;
          return (
            <button
              key={r.hierarchyRank}
              type="button"
              aria-pressed={isChosen}
              disabled={disabled}
              onClick={() => onChange(r.hierarchyRank)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                inRange
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              {isChosen && <Check size={11} className="shrink-0" />}
              {r.name}
            </button>
          );
        })}
      </div>
      {selectedIndex !== -1 && (
        <p className="text-xs text-zinc-400">
          {roles[selectedIndex].name}
          {selectedIndex > 0 ? ' and every more-senior role' : ''} will be able to see this document.
        </p>
      )}
    </div>
  );
}
