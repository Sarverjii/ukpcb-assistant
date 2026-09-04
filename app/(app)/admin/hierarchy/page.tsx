import { listRolesByRankDesc } from '@/lib/db/queries/roles';
import { listUsersWithRole } from '@/lib/db/queries/users';
import { HierarchyManager } from '@/components/admin/HierarchyManager';

export default async function HierarchyPage() {
  const [roles, users] = await Promise.all([listRolesByRankDesc(), listUsersWithRole()]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This is the clearance hierarchy — a user at a given level can access documents at their
        level and every level below. Reorder roles with the arrows, or add a new one (it starts at
        the bottom; move it into position). Click a role&apos;s member count to see who holds it.
      </p>
      <HierarchyManager
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          hierarchyRank: r.hierarchyRank,
          canUploadDocuments: r.canUploadDocuments,
          isAdmin: r.isAdmin,
          defaultDailyMessageLimit: r.defaultDailyMessageLimit,
        }))}
        members={users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleId: u.roleId, status: u.status }))}
      />
    </div>
  );
}
