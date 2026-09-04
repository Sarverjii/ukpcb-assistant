import { Crown, MessageSquare, Users, FileText } from 'lucide-react';

/**
 * A compact read-only "quick facts" panel sitting alongside the tabbed
 * Members/Documents content — head, message budget, and headcount/document
 * counts, pulled out of DepartmentDetailHeader (see that component's own
 * comment) once the detail page had grown enough fields that stacking
 * everything into one always-expanded card stopped reading as organized.
 * Every value here is set from DepartmentDetailHeader's edit form; this is
 * purely a display, not a second place to change anything.
 */
export function DepartmentFactsSidebar({
  headName,
  dailyMessageLimit,
  memberCount,
  documentCount,
}: {
  headName: string | null;
  dailyMessageLimit: number | null;
  memberCount: number;
  documentCount: number;
}) {
  const facts = [
    { icon: Crown, label: 'Head', value: headName ?? 'Not set', muted: headName === null },
    {
      icon: MessageSquare,
      label: 'Message budget',
      value: dailyMessageLimit !== null ? `${dailyMessageLimit}/day` : 'No department cap',
      muted: dailyMessageLimit === null,
    },
    { icon: Users, label: 'Members', value: String(memberCount), muted: false },
    { icon: FileText, label: 'Documents', value: String(documentCount), muted: false },
  ];

  return (
    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 lg:w-56">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-center gap-2.5 px-4 py-3">
          <fact.icon size={15} className="shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">{fact.label}</p>
            <p
              className={`truncate text-sm font-medium ${
                fact.muted ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-800 dark:text-zinc-200'
              }`}
            >
              {fact.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
