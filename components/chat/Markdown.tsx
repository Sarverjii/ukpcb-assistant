import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders assistant answers as real markdown (bold, lists, headings, code,
// tables, links) instead of raw text with literal asterisks. Deliberately
// used ONLY for assistant messages — user messages stay plain text (exactly
// what was typed), which is the standard chat-UI convention and avoids
// surprising a user who happened to type a literal "*" or "#".
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 dark:text-brand-400 underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300"
            />
          ),
          code: ({ className, children, ...props }) => {
            // Block code (```lang) carries a "language-x" className from
            // remark/rehype; plain inline `code` does not — that's the
            // standard way to tell them apart in react-markdown.
            const isBlock = /language-/.test(className ?? '');
            if (isBlock) {
              return (
                <code className={`${className ?? ''} block`} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[0.85em] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ ...props }) => (
            <pre
              className="overflow-x-auto rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-[0.85em] font-mono"
              {...props}
            />
          ),
          ul: ({ ...props }) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: ({ ...props }) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          h1: ({ ...props }) => <h1 className="mt-1 text-lg font-semibold" {...props} />,
          h2: ({ ...props }) => <h2 className="mt-1 text-base font-semibold" {...props} />,
          h3: ({ ...props }) => <h3 className="mt-1 text-sm font-semibold" {...props} />,
          blockquote: ({ ...props }) => (
            <blockquote
              className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 text-zinc-600 dark:text-zinc-400"
              {...props}
            />
          ),
          table: ({ ...props }) => (
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm" {...props} />
            </div>
          ),
          th: ({ ...props }) => (
            <th
              className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-left font-medium"
              {...props}
            />
          ),
          td: ({ ...props }) => (
            <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
