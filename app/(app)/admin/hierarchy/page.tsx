import { listRolesByRankDesc } from '@/lib/db/queries/roles';
import { HierarchyManager } from '@/components/admin/HierarchyManager';

export default async function HierarchyPage() {
  const roles = await listRolesByRankDesc();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This is the clearance hierarchy — a user at a given level can access documents at their
        level and every level below. Reorder roles with the arrows, or add a new one (it starts at
        the bottom; move it into position).
      </p>
      <HierarchyManager
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          hierarchyRank: r.hierarchyRank,
          canUploadDocuments: r.canUploadDocuments,
          isAdmin: r.isAdmin,
        }))}
      />
    </div>
  );
}
