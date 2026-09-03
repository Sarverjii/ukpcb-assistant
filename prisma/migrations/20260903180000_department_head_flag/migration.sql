-- Department gains isHeadDepartment: a department flagged this way sees
-- every document tagged with ANY department (not just its own), layered
-- on top of the ordinary clearance-or-own-department rule — see the field
-- comment in prisma/schema.prisma and lib/db/queries/chunks.ts for the
-- enforcement. Defaults false for every existing department; the app
-- toggles it on for "Executive" afterward via the real admin UI, not this
-- migration, consistent with roles/departments being data, not code.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "isHeadDepartment" BOOLEAN NOT NULL DEFAULT false;
