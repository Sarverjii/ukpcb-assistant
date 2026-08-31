import type { ChatMessage } from '@/components/chat/ChatPanel';

function safeFilename(title: string): string {
  return (title || 'conversation').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'conversation';
}

function messageCitationsLine(m: ChatMessage): string | null {
  if (!m.citations || m.citations.length === 0) return null;
  return `Sources: ${m.citations.map((c) => c.documentName).join(', ')}`;
}

export function conversationToMarkdown(title: string, messages: ChatMessage[]): string {
  const lines = [`# ${title}`, ''];
  for (const m of messages) {
    lines.push(m.role === 'USER' ? '**You**' : '**Ask Evon**');
    lines.push('');
    lines.push(m.content);
    const sources = messageCitationsLine(m);
    if (sources) {
      lines.push('');
      lines.push(`*${sources}*`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/**
 * Markdown export: a real file download, since the raw message content IS
 * already markdown (what Markdown.tsx renders client-side) — writing it
 * straight to a .md file needs no conversion.
 */
export function downloadConversationMarkdown(title: string, messages: ChatMessage[]): void {
  const markdown = conversationToMarkdown(title, messages);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFilename(title)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * PDF export: no PDF-generation library in this app (or worth adding just
 * for this) — instead opens a plain, print-styled document in a new tab and
 * triggers the browser's own print dialog, where "Save as PDF" is a
 * standard destination on every major browser/OS. Needs to run directly
 * inside a user click handler (window.open from anywhere else risks being
 * popup-blocked).
 */
export function exportConversationAsPdf(title: string, messages: ChatMessage[]): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print preview popup — please allow popups for this site and try again.');
    return;
  }

  const body = messages
    .map((m) => {
      const sources = messageCitationsLine(m);
      return `
        <div class="msg">
          <div class="role">${m.role === 'USER' ? 'You' : 'Ask Evon'}</div>
          <div class="content">${escapeHtml(m.content)}</div>
          ${sources ? `<div class="sources">${escapeHtml(sources)}</div>` : ''}
        </div>`;
    })
    .join('\n');

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; color: #18181b; padding: 0 20px; }
  h1 { font-size: 20px; margin-bottom: 24px; }
  .msg { margin-bottom: 20px; page-break-inside: avoid; }
  .role { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #71717a; margin-bottom: 4px; }
  .content { white-space: pre-wrap; line-height: 1.55; font-size: 14px; }
  .sources { margin-top: 6px; font-size: 12px; color: #71717a; font-style: italic; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`);
  win.document.close();
  win.focus();
  // A short delay rather than printing synchronously right after write() —
  // calling print() immediately can race the new document's own layout,
  // opening the dialog before content has actually rendered.
  setTimeout(() => win.print(), 300);
}
