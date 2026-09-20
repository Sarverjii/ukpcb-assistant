import { PublicChatPanel } from '@/components/chat/PublicChatPanel';

// The public, unauthenticated entry point — no login required. proxy.ts
// lets an anonymous visitor reach this route (and its
// /api/public-chat/stream backend) specifically, while every other route
// still requires a session; it also redirects a LOGGED-IN visitor away
// from here straight to /chat, so this page itself never needs to check
// auth at all. See PublicChatPanel's own comment for why this doesn't
// reuse the employee ChatPanel.
export default function RootPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <PublicChatPanel />
    </div>
  );
}
