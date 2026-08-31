'use client';

import { useState, useTransition } from 'react';
import { ChevronUp, ChevronDown, Plus, ShieldCheck, Upload } from 'lucide-react';
import {
  createRoleAction,
  moveRoleAction,
  toggleRoleCapabilityAction,
} from '@/app/(app)/admin/hierarchy/actions';

type Role = {
  id: string;
  name: string;
  hierarchyRank: number;
  canUploadDocuments: boolean;
  isAdmin: boolean;
};

export function HierarchyManager({ roles }: { roles: Role[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function move(roleId: string, direction: 'up' | 'down') {
    setPendingId(roleId);
    setError(null);
    startTransition(async () => {
      const result = await moveRoleAction(roleId, direction);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  function toggle(roleId: string, field: 'canUploadDocuments' | 'isAdmin') {
    setPendingId(roleId);
    setError(null);
    startTransition(async () => {
      const result = await toggleRoleCapabilityAction(roleId, field);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        {roles.map((role, i) => (
          <div
            key={role.id}
            className={`flex items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4 ${
              i !== 0 ? 'border-t border-zinc-100 dark:border-zinc-800' : ''
            } bg-white dark:bg-zinc-900`}
          >
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                disabled={i === 0 || pendingId === role.id}
                onClick={() => move(role.id, 'up')}
                className="rounded p-0.5 text-zinc-400 hover:text-brand-600 disabled:opacity-20"
                aria-label={`Move ${role.name} up`}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                disabled={i === roles.length - 1 || pendingId === role.id}
                onClick={() => move(role.id, 'down')}
                className="rounded p-0.5 text-zinc-400 hover:text-brand-600 disabled:opacity-20"
                aria-label={`Move ${role.name} down`}
              >
                <ChevronDown size={16} />
              </button>
            </div>

            <span className="w-7 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800 py-1 text-center text-xs font-mono text-zinc-500">
              {role.hierarchyRank}
            </span>

            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-white">
              {role.name}
            </span>

            <button
              type="button"
              onClick={() => toggle(role.id, 'canUploadDocuments')}
              disabled={pendingId === role.id}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 ${
                role.canUploadDocuments
                  ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300'
                  : 'border-zinc-200 text-zinc-400 dark:border-zinc-700'
              }`}
              title="Can upload documents"
            >
              <Upload size={12} /> <span className="hidden sm:inline">Upload</span>
            </button>

            <button
              type="button"
              onClick={() => toggle(role.id, 'isAdmin')}
              disabled={pendingId === role.id}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 ${
                role.isAdmin
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-zinc-200 text-zinc-400 dark:border-zinc-700'
              }`}
              title="Admin dashboard access"
            >
              <ShieldCheck size={12} /> <span className="hidden sm:inline">Admin</span>
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
          >
            <Plus size={16} /> Add role
          </button>
        ) : (
          <AddRoleForm onDone={() => setAddOpen(false)} />
        )}
      </div>
    </div>
  );
}

function AddRoleForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createRoleAction(formData);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        name="name"
        placeholder="New role name"
        autoFocus
        required
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-700 dark:bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500 disabled:opacity-60"
      >
        Add
      </button>
      <button type="button" onClick={onDone} className="text-sm text-zinc-500 hover:underline">
        Cancel
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
