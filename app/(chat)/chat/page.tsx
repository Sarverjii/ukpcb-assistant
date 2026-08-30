import { ChatPanel } from '@/components/chat/ChatPanel';

// Deliberately does nothing but render an empty composer — no DB read, no
// DB write. "/" (which redirects here) and the sidebar's "New chat" link
// both land on this same static draft state. The conversation only starts
// existing once the first message is actually sent (see
// createConversationAndSendMessage in ./actions.ts), at which point
// ChatPanel navigates to /chat/[id] itself.
export default function ChatDraftPage() {
  return <ChatPanel conversationId={null} initialMessages={[]} />;
}
