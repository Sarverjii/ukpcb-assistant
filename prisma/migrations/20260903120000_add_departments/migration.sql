-- Departments: an admin-managed org structure, purely additive to the
-- rank-based clearance system. A User can belong to any number of
-- departments; a Document can be tagged with any number too. See
-- prisma/schema.prisma's Department/DocumentChunk.departmentIds comments
-- and lib/db/queries/chunks.ts for the resulting "clearance OR department"
-- visibility rule.
--
-- This migration is ordered deliberately: the old free-text `department`
-- columns on User and Document are read to backfill the new structured
-- relations BEFORE those columns are dropped, so no existing tagging is
-- silently lost. DocumentChunk.departmentIds (the denormalized column the
-- security-critical retrieval queries actually filter on — see
-- lib/db/queries/chunks.ts) is backfilled from the same data in the same
-- pass.

-- CreateEnum
CREATE TYPE "CreationMethod" AS ENUM ('MANUAL', 'BULK_IMPORT');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateTable: employee bulk-import versioning — one row per uploaded
-- sheet, kept forever (see EmployeeImportBatch's schema.prisma comment).
CREATE TABLE "EmployeeImportBatch" (
    "id" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "errorReportFileKey" TEXT,

    CONSTRAINT "EmployeeImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeImportBatch_uploadedById_idx" ON "EmployeeImportBatch"("uploadedById");

ALTER TABLE "EmployeeImportBatch" ADD CONSTRAINT "EmployeeImportBatch_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: implicit Prisma M2M join tables (Department <-> User,
-- Department <-> Document).
CREATE TABLE "_DepartmentToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DepartmentToUser_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_DepartmentToUser_B_index" ON "_DepartmentToUser"("B");
ALTER TABLE "_DepartmentToUser" ADD CONSTRAINT "_DepartmentToUser_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DepartmentToUser" ADD CONSTRAINT "_DepartmentToUser_B_fkey"
  FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "_DepartmentToDocument" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DepartmentToDocument_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_DepartmentToDocument_B_index" ON "_DepartmentToDocument"("B");
ALTER TABLE "_DepartmentToDocument" ADD CONSTRAINT "_DepartmentToDocument_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DepartmentToDocument" ADD CONSTRAINT "_DepartmentToDocument_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: User gains provenance (who/when/how created) and the
-- optional link to the import batch that created it.
ALTER TABLE "User"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "creationMethod" "CreationMethod" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "importBatchId" TEXT;

CREATE INDEX "User_createdById_idx" ON "User"("createdById");
CREATE INDEX "User_importBatchId_idx" ON "User"("importBatchId");

ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "EmployeeImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: the denormalized column the security-critical retrieval
-- queries filter on (see lib/db/queries/chunks.ts and the module-level
-- security note in schema.prisma) — same pattern as clearanceRank.
ALTER TABLE "DocumentChunk" ADD COLUMN "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Seed the canonical department list. Renamed from the original
-- corporate set (Engineering/HR/Sales & Business Development/Operations/
-- QA) to a Pollution Control Board's own wings — Consent Management in
-- particular replaces "Sales & Business Development" because issuing
-- Consent to Establish/Operate is this kind of board's actual core
-- regulatory function, not a corporate-sales analog. Finance & Accounts
-- and Executive are generic enough to apply unchanged to either kind of
-- org, so those two are untouched. This still only matters for a
-- genuinely fresh database — see the backfill note below, which no-ops
-- here regardless of these names since there's no pre-existing free-text
-- department data in this project's own history to match against.
INSERT INTO "Department" ("id", "name", "createdAt") VALUES
  (gen_random_uuid()::text, 'Environmental Engineering', now()),
  (gen_random_uuid()::text, 'Administration', now()),
  (gen_random_uuid()::text, 'Consent Management', now()),
  (gen_random_uuid()::text, 'Field Operations', now()),
  (gen_random_uuid()::text, 'Laboratory', now()),
  (gen_random_uuid()::text, 'Finance & Accounts', now()),
  (gen_random_uuid()::text, 'Executive', now());

-- Backfill Document -> Department from the old free-text column, matched
-- case-insensitively and EXACTLY against the new canonical names. A value
-- that doesn't exactly match anything (e.g. the real "accounts" tag —
-- arguably Finance & Accounts, but ambiguous enough not to guess) is
-- deliberately left unassigned rather than fuzzy-matched; an admin can tag
-- it correctly afterward from the document edit UI.
INSERT INTO "_DepartmentToDocument" ("A", "B")
SELECT dept.id, doc.id
FROM "Document" doc
JOIN "Department" dept ON lower(trim(doc."department")) = lower(dept."name")
WHERE doc."department" IS NOT NULL;

-- Same backfill for User -> Department. Lower-stakes than the document
-- backfill: every current non-CXO employee is about to be replaced by the
-- planned roster reset regardless, but this still runs for correctness and
-- so nothing is silently dropped for whoever isn't reset.
INSERT INTO "_DepartmentToUser" ("A", "B")
SELECT dept.id, u.id
FROM "User" u
JOIN "Department" dept ON lower(trim(u."department")) = lower(dept."name")
WHERE u."department" IS NOT NULL;

-- Backfill DocumentChunk.departmentIds from each chunk's document's
-- newly-assigned departments, so retrieval reflects the real starting
-- state immediately rather than treating every existing chunk as
-- departmentless until the next clearance/department edit re-indexes it.
UPDATE "DocumentChunk" dc
SET "departmentIds" = COALESCE(agg.ids, ARRAY[]::TEXT[])
FROM (
  SELECT jd."B" AS "documentId", array_agg(jd."A") AS ids
  FROM "_DepartmentToDocument" jd
  GROUP BY jd."B"
) agg
WHERE dc."documentId" = agg."documentId";

-- AlterTable: drop the old free-text columns now that every existing value
-- has been migrated into the structured relations above.
ALTER TABLE "Document" DROP COLUMN "department";
ALTER TABLE "User" DROP COLUMN "department";

-- Note: Prisma's own diff for this change also proposed
-- `DROP INDEX "document_chunks_embedding_idx"` here — the same standing
-- HNSW-index gotcha every DocumentChunk-touching migration in this project
-- has hit (Prisma doesn't track this hand-added index, since it can't
-- express `vector`/HNSW in schema.prisma, and treats it as drift to
-- reconcile away). Deliberately NOT applied: dropping it wouldn't break
-- anything visibly, retrieval would just silently fall back to a full
-- sequential scan over every chunk's embedding on every chat query.
