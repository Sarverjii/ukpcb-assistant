'use client';

import { useState } from 'react';
import { Users, FileText } from 'lucide-react';

type TabId = 'members' | 'documents';

/**
 * Client-side tab switch between Members and Documents — both used to
 * render always-stacked, one long-scrolling page below the header. Same
 * client-state tab pattern as KnowledgeBase.tsx/DocumentLibraryTable.tsx
 * (there's no sub-route for either section, so this can't be
 * `usePathname`-driven the way AdminNav's top-level tabs are).
 */
export function DepartmentTabs({
  memberCount,
  documentCount,
  members,
  documents,
}: {
  memberCount: number;
  documentCount: number;
  members: React.ReactNode;
  documents: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabId>('members');

  const tabs: { id: TabId; label: string; icon: typeof Users; count: number }[] = [
    { id: 'members', label: 'Members', icon: Users, count: memberCount },
    { id: 'documents', label: 'Documents', icon: FileText, count: documentCount },
  ];

  return (
    <div className="min-w-0 flex-1">
      <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <t.icon size={15} />
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  isActive
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="mt-4">{tab === 'members' ? members : documents}</div>
    </div>
  );
}
