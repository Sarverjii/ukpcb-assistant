import Link from 'next/link';
import { FileText } from 'lucide-react';

type Doc = { id: string; name: string; clearanceLevel: number };
type Role = { hierarchyRank: number; name: string };

/**
 * Read-only — what this department actually grants access to, alongside
 * who's in it. Deliberately no manage/edit actions here: changing a
 * document's departments is a document-management action that belongs in
 * the Knowledge Base, linked out to rather than duplicated.
 */
export function DepartmentDocuments({ documents, roles }: { documents: Doc[]; roles: Role[] }) {
  const roleNameByRank = new Map(roles.map((r) => [r.hierarchyRank, r.name]));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Documents in this department</h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Every member sees these regardless of their own clearance. Manage tagging from the Knowledge
        Base.
      </p>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2 text-sm last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-2 truncate text-zinc-800 dark:text-zinc-200">
              <FileText size={14} className="shrink-0 text-zinc-400" />
              <span className="truncate">{doc.name}</span>
            </span>
            <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {roleNameByRank.get(doc.clearanceLevel) ?? `Level ${doc.clearanceLevel}`}
            </span>
          </div>
        ))}
        {documents.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-zinc-400">
            No documents tagged with this department yet —{' '}
            <Link href="/knowledge-base" className="text-brand-600 hover:underline">
              tag one from the Knowledge Base
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}
