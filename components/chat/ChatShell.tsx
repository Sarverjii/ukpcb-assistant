'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/chat/Sidebar';

type Conversation = { id: string; title: string | null; updatedAt: string };
type User = { name: string; email: string; roleName: string };

/**
 * Client wrapper around Sidebar + the chat content, so the two — siblings
 * in app/(chat)/layout.tsx's server component, which can't itself hold
 * interactive state — can share whether the mobile drawer is open. Below
 * md, Sidebar renders as a hidden-by-default overlay (see its own
 * comments); this is what actually opens it, via a small persistent
 * hamburger bar that only shows on mobile.
 */
export function ChatShell({
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
  conversations,
  children,
}: {
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  conversations: Conversation[];
  children: React.ReactNode;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950">
      <Sidebar
        user={user}
        canUploadDocuments={canUploadDocuments}
        isAdmin={isAdmin}
        initialTheme={initialTheme}
        conversations={conversations}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 px-3 py-2.5 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open sidebar"
            className="rounded-md p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Ask Evon</span>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
