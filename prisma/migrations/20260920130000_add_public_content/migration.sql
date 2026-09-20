-- Adds the "public content" visibility axis: a document/URL tagged
-- isPublic bypasses clearanceLevel, departments, AND locations entirely —
-- visible to the new unauthenticated public chat (which can see nothing
-- else) and, simultaneously, to every logged-in employee regardless of
-- their own clearance/department/location. See Document.isPublic's own
-- schema.prisma comment for the full reasoning.
--
-- Also adds the public chat's own two-tier usage-limiting pool (org-wide +
-- per-visitor-IP), a separate pool from employee usage so anonymous public
-- traffic can never eat into (or be capped by) the company's own AI budget.

ALTER TABLE "Document" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentChunk" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- Postgres requires ADD VALUE to run outside the transaction that first
-- USES the new value — fine here, since this migration only adds the
-- values and never references them itself (precedent: the UserStatus.REMOVED
-- addition in 20260902120000_employee_lifecycle_and_sessions did the same).
ALTER TYPE "UsageScope" ADD VALUE 'PUBLIC_ORG';
ALTER TYPE "UsageScope" ADD VALUE 'PUBLIC_IP';

ALTER TABLE "OrgUsagePolicy" ADD COLUMN "publicDailyMessageLimit" INTEGER NOT NULL DEFAULT 200;
