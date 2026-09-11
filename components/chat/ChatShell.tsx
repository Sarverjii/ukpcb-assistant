'use client';

import { useState } from 'react';
import { Menu, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Sidebar } from '@/components/chat/Sidebar';
import { CitationPreviewProvider } from '@/components/chat/CitationPreviewContext';

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
  providerOffline,
  conversations,
  children,
}: {
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  providerOffline: { llm: boolean; embedding: boolean };
  conversations: Conversation[];
  children: React.ReactNode;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const anyOffline = providerOffline.llm || providerOffline.embedding;

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
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">UKPCB Assistant</span>
        </div>

        {anyOffline && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-sm text-red-700 dark:text-red-400">
            <span className="flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0" />
              {providerOffline.llm
                ? "UKPCB Assistant isn't answering questions right now — no AI model is configured."
                : "Document search isn't working right now — no embedding model is configured."}{' '}
              {isAdmin ? 'Fix this in AI Models.' : 'An administrator needs to fix this.'}
            </span>
            {isAdmin && (
              <Link
                href="/admin/ai-providers"
                className="shrink-0 rounded-md border border-red-300 dark:border-red-800 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                Open AI Models
              </Link>
            )}
          </div>
        )}

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CitationPreviewProvider>{children}</CitationPreviewProvider>
        </main>
      </div>
    </div>
  );
}
