-- Department gains an optional description and a designated head — both
-- purely descriptive org-chart metadata, never authorization-relevant
-- (see the field comments in prisma/schema.prisma). No data migration
-- needed: every existing department simply starts with both unset.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "description" TEXT,
ADD COLUMN     "headUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: same standing HNSW-index gotcha as every prior migration touching
-- DocumentChunk — not applicable here (this migration doesn't touch that
-- table), documented in case Prisma's own diff tooling is ever run
-- directly against this migration and proposes the spurious DROP INDEX.
