'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SquarePen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  LogOut,
  ShieldCheck,
  Upload,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { deleteConversationAction } from '@/app/(chat)/chat/actions';
import { logoutAction } from '@/app/(app)/actions';
import { ThemeToggle } from '@/components/ThemeToggle';

type Conversation = { id: string; title: string | null; updatedAt: string };
type User = { name: string; email: string; roleName: string };

export function Sidebar({
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
  conversations,
}: {
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  conversations: Conversation[];
}) {
  // Deliberately not persisted (e.g. to localStorage): reading a client-only
  // store during the initial render to decide collapsed/expanded would
  // either require an effect-based sync after mount (a one-frame layout
  // flash) or risk a server/client hydration mismatch on first paint.
  // Defaulting open every load is simpler and avoids both.
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  function toggleCollapsed() {
    setCollapsed((prev) => !prev);
  }

  if (collapsed) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="Evon" className="h-5 w-auto" />
        <button
          type="button"
          onClick={toggleCollapsed}
          className="rounded-md p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen size={18} />
        </button>
        <Link
          href="/chat"
          className="rounded-md p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          aria-label="New chat"
        >
          <SquarePen size={18} />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="flex items-center gap-2 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-5 w-auto" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Ask Evon</span>
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="rounded-md p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={17} />
        </button>
      </div>

      <div className="px-3">
        <Link
          href="/chat"
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800"
        >
          <SquarePen size={16} />
          New chat
        </Link>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-2">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Conversations
        </p>
        <ul className="flex flex-col gap-0.5">
          {conversations.map((c) => (
            <ConversationItem key={c.id} conversation={c} active={pathname === `/chat/${c.id}`} />
          ))}
          {conversations.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-zinc-400 dark:text-zinc-500">No conversations yet.</li>
          )}
        </ul>
      </nav>

      <ProfileMenu
        user={user}
        canUploadDocuments={canUploadDocuments}
        isAdmin={isAdmin}
        initialTheme={initialTheme}
      />
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
}: {
  conversation: Conversation;
  active: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!confirming) return;
    // Clicking anywhere else cancels the pending confirm — otherwise a
    // "click delete again to confirm" state could linger indefinitely and
    // surprise a later, unrelated click.
    function handleClick() {
      setConfirming(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [confirming]);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      await deleteConversationAction(conversation.id);
      if (active) {
        // The conversation being viewed just disappeared — /chat picks the
        // next most recent conversation (or starts a fresh one if none).
        router.push('/chat');
      }
      router.refresh();
    });
  }

  return (
    <li className="group/item relative">
      <Link
        href={`/chat/${conversation.id}`}
        className={`flex items-center gap-2 truncate rounded-lg border-l-2 py-2 pl-2.5 pr-8 text-sm ${
          active
            ? 'border-brand-500 dark:border-brand-400 bg-zinc-200/70 dark:bg-zinc-800 text-zinc-900 dark:text-white'
            : 'border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        <MessageSquare
          size={14}
          className={`shrink-0 ${active ? 'text-brand-600 dark:text-brand-400' : 'text-zinc-400 dark:text-zinc-500'}`}
        />
        <span className="truncate">{conversation.title || 'New conversation'}</span>
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={handleDeleteClick}
        title={confirming ? 'Click again to delete' : 'Delete conversation'}
        aria-label="Delete conversation"
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 transition-opacity disabled:opacity-50 ${
          confirming
            ? 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 opacity-100'
            : 'text-zinc-400 dark:text-zinc-500 opacity-0 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-red-500 dark:hover:text-red-400 group-hover/item:opacity-100'
        }`}
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function ProfileMenu({
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
}: {
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={ref} className="relative border-t border-zinc-200 dark:border-zinc-800 p-2">
      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg">
          <div className="border-b border-zinc-100 dark:border-zinc-800 px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{user.name}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {user.roleName} · Knowledge access: {user.roleName} level
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <ShieldCheck size={15} /> Admin dashboard
            </Link>
          )}
          {canUploadDocuments && (
            <Link
              href="/documents/upload"
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Upload size={15} /> Upload documents
            </Link>
          )}
          <Link
            href="/settings"
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Settings size={15} /> Settings
          </Link>
          <div className="border-t border-zinc-100 dark:border-zinc-800 py-1">
            <ThemeToggle initialTheme={initialTheme} />
          </div>
          <form action={logoutAction} className="border-t border-zinc-100 dark:border-zinc-800 pt-1">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <LogOut size={15} /> Sign out
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 dark:bg-brand-600 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">{user.name}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{user.roleName}</span>
        </span>
        <Settings size={16} className="shrink-0 text-zinc-400 dark:text-zinc-400" />
      </button>
    </div>
  );
}
