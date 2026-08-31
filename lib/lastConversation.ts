// Shared by ChatPanel (which records the last conversation actually
// viewed) and BackToChatLink (which reads it) — a plain client-side
// localStorage key, not real app state: purely a per-browser UX
// convenience so "Back to chat" from Admin/Settings/Upload returns to
// where you actually were instead of always resetting to a blank draft.
// Never read server-side and never treated as authoritative for anything
// — worst case (private browsing, a cleared/blocked store) it's just
// absent and the back link falls back to the plain "/chat" draft, exactly
// like before this existed.
export const LAST_CONVERSATION_STORAGE_KEY = 'ask-evon:last-conversation-id';
