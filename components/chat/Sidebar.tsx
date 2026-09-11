'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SquarePen,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Trash2,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { deleteConversationAction, renameConversationAction, searchConversationsAction } from '@/app/(chat)/chat/actions';
import { ProfileMenu } from '@/components/ProfileMenu';
import { LAST_CONVERSATION_STORAGE_KEY } from '@/lib/lastConversation';

type Conversation = { id: string; title: string | null; updatedAt: string };
type User = { name: string; email: string; roleName: string };

export function Sidebar({
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
  conversations,
  mobileOpen,
  onCloseMobile,
}: {
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  conversations: Conversation[];
  // Below md, the sidebar is an off-canvas drawer (owned by ChatShell,
  // which also renders the hamburger button that opens it — there's no
  // room to dock a permanent rail on a phone-width screen) rather than the
  // permanent collapsible column it is at md+.
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  // Desktop-only: collapsed/expanded rail toggle. Deliberately not
  // persisted (e.g. to localStorage) — reading a client-only store during
  // the initial render to decide collapsed/expanded would either require
  // an effect-based sync after mount (a one-frame layout flash) or risk a
  // server/client hydration mismatch on first paint. Defaulting open every
  // load is simpler and avoids both. Irrelevant on mobile, where the
  // drawer is always shown "full" (or not at all) — see mobileOpen above.
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  // Conversation ids matched by MESSAGE CONTENT (not title) for the current
  // search — a genuine server round trip, debounced, kept separate from the
  // instant client-side title filter below rather than replacing it, so
  // title matches still appear immediately while content matches catch up.
  const [contentMatchIds, setContentMatchIds] = useState<Set<string>>(new Set());
  const [searchingContent, setSearchingContent] = useState(false);
  const pathname = usePathname();

  function toggleCollapsed() {
    setCollapsed((prev) => !prev);
  }

  // Client-side, like the admin tables' search — a user's own conversation
  // list is small (dozens, not thousands) and already fetched for the
  // layout, so filtering it in the browser avoids yet another DB round
  // trip on a deployment where those are measurably expensive (see
  // vercel.json's region-pin comment). Content search below is the one
  // exception — title alone genuinely isn't enough, and that data was
  // never in this prop to begin with.
  const q = search.trim().toLowerCase();
  const filteredConversations = q
    ? conversations.filter((c) => (c.title || 'New conversation').toLowerCase().includes(q) || contentMatchIds.has(c.id))
    : conversations;

  useEffect(() => {
    // Every setState call here happens inside the timeout callback, never
    // synchronously in the effect body itself — including the "clear" path
    // for an empty search, via a zero-delay timer rather than an early
    // return, so this stays a plain "subscribe, react later" effect rather
    // than one that updates state on every render pass.
    const trimmed = search.trim();
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (cancelled) return;
        if (!trimmed) {
          setContentMatchIds(new Set());
          setSearchingContent(false);
          return;
        }
        setSearchingContent(true);
        searchConversationsAction(trimmed).then((matches) => {
          if (cancelled) return;
          setContentMatchIds(new Set(matches.map((m) => m.conversationId)));
          setSearchingContent(false);
        });
      },
      trimmed ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <>
      {/* Desktop: permanent column, collapsible via the button in its own
          header. Hidden below md — the mobile drawer below replaces it
          entirely rather than sharing markup, since the collapsed rail
          (icon-only) has no equivalent that makes sense as an overlay. */}
      <div className="hidden shrink-0 md:flex">
        {collapsed ? (
          <RailContent onExpand={toggleCollapsed} />
        ) : (
          <SidebarContent
            width="w-64"
            user={user}
            canUploadDocuments={canUploadDocuments}
            isAdmin={isAdmin}
            initialTheme={initialTheme}
            filteredConversations={filteredConversations}
            totalConversationCount={conversations.length}
            search={search}
            onSearchChange={setSearch}
            searchingContent={searchingContent}
            pathname={pathname}
            headerAction={{ icon: <PanelLeftClose size={17} />, label: 'Collapse sidebar', onClick: toggleCollapsed }}
          />
        )}
      </div>

      {/* Mobile: off-canvas drawer, always the full (never collapsed)
          content — translated fully off-screen when closed rather than
          unmounted, so the open/close is a smooth slide instead of a
          content pop-in. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 transition-transform duration-200 ease-out md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent
          width="w-full"
          user={user}
          canUploadDocuments={canUploadDocuments}
          isAdmin={isAdmin}
          initialTheme={initialTheme}
          filteredConversations={filteredConversations}
          totalConversationCount={conversations.length}
          search={search}
          onSearchChange={setSearch}
          searchingContent={searchingContent}
          pathname={pathname}
          headerAction={{ icon: <X size={17} />, label: 'Close sidebar', onClick: onCloseMobile }}
          onNavigate={onCloseMobile}
        />
      </div>
      {mobileOpen && (
        <div
          aria-hidden
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}
    </>
  );
}

function RailContent({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex w-14 flex-col items-center gap-3 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="UKPCB" className="h-5 w-auto" />
      <button
        type="button"
        onClick={onExpand}
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

/**
 * The actual sidebar UI (header, new chat, search, conversation list,
 * profile menu) — shared verbatim between the desktop column and the
 * mobile drawer so the two can never silently drift apart. `headerAction`
 * lets each caller supply the right icon/behavior for its own header
 * button (collapse vs close); `onNavigate` lets the mobile drawer close
 * itself whenever a link inside is actually followed (new chat, opening a
 * conversation) — undefined on desktop, where there's no drawer to close.
 */
function SidebarContent({
  width,
  user,
  canUploadDocuments,
  isAdmin,
  initialTheme,
  filteredConversations,
  totalConversationCount,
  search,
  onSearchChange,
  searchingContent,
  pathname,
  headerAction,
  onNavigate,
}: {
  width: string;
  user: User;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  initialTheme: 'LIGHT' | 'DARK';
  filteredConversations: Conversation[];
  totalConversationCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  searchingContent: boolean;
  pathname: string;
  headerAction: { icon: React.ReactNode; label: string; onClick: () => void };
  onNavigate?: () => void;
}) {
  return (
    <div
      className={`flex ${width} flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        <span className="flex items-center gap-2 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-5 w-auto" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">UKPCB Assistant</span>
        </span>
        <button
          type="button"
          onClick={headerAction.onClick}
          className="rounded-md p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          aria-label={headerAction.label}
        >
          {headerAction.icon}
        </button>
      </div>

      <div className="px-3">
        <Link
          href="/chat"
          onClick={onNavigate}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800"
        >
          <SquarePen size={16} />
          New chat
        </Link>
      </div>

      {totalConversationCount > 5 && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-7 pr-6 text-xs text-zinc-700 dark:text-zinc-200 outline-none placeholder:text-zinc-400 focus:border-brand-400"
            />
            {search && searchingContent && (
              <span className="absolute right-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 animate-spin rounded-full border border-zinc-300 border-t-brand-500 dark:border-zinc-700" />
            )}
            {search && !searchingContent && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <nav className="mt-4 flex-1 overflow-y-auto px-2">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Conversations
        </p>
        <ul className="flex flex-col gap-0.5">
          {filteredConversations.map((c) => (
            <ConversationItem
              key={c.id}
              conversation={c}
              active={pathname === `/chat/${c.id}`}
              onNavigate={onNavigate}
            />
          ))}
          {totalConversationCount === 0 && (
            <li className="px-2.5 py-2 text-sm text-zinc-400 dark:text-zinc-500">No conversations yet.</li>
          )}
          {totalConversationCount > 0 && filteredConversations.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-zinc-400 dark:text-zinc-500">No matches.</li>
          )}
        </ul>
      </nav>

      <ProfileMenu
        variant="full"
        user={user}
        canUploadDocuments={canUploadDocuments}
        isAdmin={isAdmin}
        initialTheme={initialTheme}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  onNavigate,
}: {
  conversation: Conversation;
  active: boolean;
  onNavigate?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title || '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      await deleteConversationAction(conversation.id);
      // If "Back to chat" (BackToChatLink.tsx) was pointing at this
      // conversation, it needs to forget it — otherwise it'd send a later
      // visit to Admin/Settings back to a 404 instead of a safe fallback.
      try {
        if (localStorage.getItem(LAST_CONVERSATION_STORAGE_KEY) === conversation.id) {
          localStorage.removeItem(LAST_CONVERSATION_STORAGE_KEY);
        }
      } catch {
        // Unavailable — nothing to clean up either way.
      }
      if (active) {
        // The conversation being viewed just disappeared — /chat picks the
        // next most recent conversation (or starts a fresh one if none).
        router.push('/chat');
      }
      router.refresh();
    });
  }

  function handleRenameClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setTitleDraft(conversation.title || '');
    setEditing(true);
  }

  function commitRename() {
    const trimmed = titleDraft.trim();
    setEditing(false);
    if (!trimmed || trimmed === conversation.title) return;
    startTransition(async () => {
      await renameConversationAction(conversation.id, trimmed);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="px-0.5">
        <input
          ref={inputRef}
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="w-full rounded-lg border border-brand-400 bg-white dark:bg-zinc-900 py-1.5 pl-2.5 pr-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group/item relative">
      <Link
        href={`/chat/${conversation.id}`}
        onClick={onNavigate}
        className={`flex items-center gap-2 truncate rounded-lg border-l-2 py-2 pl-2.5 pr-14 text-sm ${
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
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        <button
          type="button"
          disabled={pending}
          onClick={handleRenameClick}
          title="Rename conversation"
          aria-label="Rename conversation"
          className="rounded-md p-1.5 text-zinc-400 dark:text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-50 group-hover/item:opacity-100"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleDeleteClick}
          title={confirming ? 'Click again to delete' : 'Delete conversation'}
          aria-label="Delete conversation"
          className={`rounded-md p-1.5 transition-opacity disabled:opacity-50 ${
            confirming
              ? 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 opacity-100'
              : 'text-zinc-400 dark:text-zinc-500 opacity-0 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-red-500 dark:hover:text-red-400 group-hover/item:opacity-100'
          }`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

