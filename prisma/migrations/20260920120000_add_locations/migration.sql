-- Locations: a second, STRICTER document-visibility axis alongside
-- Department, based on physical site rather than org function. See
-- Location's own schema.prisma comment for the full "hard AND, not OR"
-- rule this sets up, and lib/db/queries/chunks.ts for its enforcement.
--
-- Two structural differences from the Department migration this mirrors:
--   1. Every employee gets EXACTLY one location (a required scalar FK on
--      User), not zero-to-many, so this migration adds the column
--      NULLABLE first, backfills every existing employee, THEN tightens
--      it to NOT NULL — the standard safe sequence for adding a required
--      column to a table that already has rows.
--   2. DocumentChunk.locationIds defaults to an empty array like
--      departmentIds, but empty means "matches nothing" here (never
--      "unrestricted") — every document is backfilled with at least one
--      location in the same pass, so no chunk is left in that empty state
--      by this migration itself.
--
-- Every existing employee and document is assigned a location by simple
-- round-robin (ROW_NUMBER() mod 5) over the five seeded locations below —
-- there's no pre-existing site data anywhere in this schema to backfill
-- from, so an even, deterministic spread is the least-arbitrary starting
-- point; an admin can re-tag any individual employee or document
-- afterward from the same UI that already manages clearance and
-- department.

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- Seed the five canonical locations.
INSERT INTO "Location" ("id", "name", "createdAt") VALUES
  (gen_random_uuid()::text, 'Location A', now()),
  (gen_random_uuid()::text, 'Location B', now()),
  (gen_random_uuid()::text, 'Location C', now()),
  (gen_random_uuid()::text, 'Location D', now()),
  (gen_random_uuid()::text, 'Location E', now());

-- CreateTable: implicit Prisma M2M join table (Document <-> Location).
-- User <-> Location is NOT a join table — see User.locationId below.
CREATE TABLE "_DocumentToLocation" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DocumentToLocation_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_DocumentToLocation_B_index" ON "_DocumentToLocation"("B");
ALTER TABLE "_DocumentToLocation" ADD CONSTRAINT "_DocumentToLocation_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DocumentToLocation" ADD CONSTRAINT "_DocumentToLocation_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: User gains locationId, nullable for now — backfilled below,
-- then tightened to NOT NULL once every row has a value.
ALTER TABLE "User" ADD COLUMN "locationId" TEXT;

-- Backfill every existing employee, round-robin over the five locations in
-- a stable order (by id, since createdAt can tie for bulk-imported rows).
WITH numbered_users AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
  FROM "User"
),
numbered_locations AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) - 1 AS rn
  FROM "Location"
)
UPDATE "User" u
SET "locationId" = nl.id
FROM numbered_users nu
JOIN numbered_locations nl ON nl.rn = nu.rn % 5
WHERE u.id = nu.id;

ALTER TABLE "User" ALTER COLUMN "locationId" SET NOT NULL;
CREATE INDEX "User_locationId_idx" ON "User"("locationId");
ALTER TABLE "User" ADD CONSTRAINT "User_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill every existing document with exactly one location, same
-- round-robin approach, independent of the User backfill above.
WITH numbered_docs AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
  FROM "Document"
),
numbered_locations AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) - 1 AS rn
  FROM "Location"
)
INSERT INTO "_DocumentToLocation" ("A", "B")
SELECT nd.id, nl.id
FROM numbered_docs nd
JOIN numbered_locations nl ON nl.rn = nd.rn % 5;

-- AlterTable: the denormalized column the security-critical retrieval
-- queries filter on — see the module-level security note in
-- schema.prisma, DocumentChunk.locationIds's own comment, and
-- lib/db/queries/chunks.ts.
ALTER TABLE "DocumentChunk" ADD COLUMN "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill DocumentChunk.locationIds from each chunk's document's
-- newly-assigned location(s), so retrieval reflects the real starting
-- state immediately rather than every existing chunk matching nothing
-- until the next edit re-indexes it.
UPDATE "DocumentChunk" dc
SET "locationIds" = COALESCE(agg.ids, ARRAY[]::TEXT[])
FROM (
  SELECT jd."A" AS "documentId", array_agg(jd."B") AS ids
  FROM "_DocumentToLocation" jd
  GROUP BY jd."A"
) agg
WHERE dc."documentId" = agg."documentId";

-- Note: same standing HNSW-index gotcha as every previous
-- DocumentChunk-touching migration in this project (see e.g.
-- 20260903120000_add_departments's own trailing note) — Prisma's diff
-- tooling doesn't know about the hand-added vector index and will propose
-- dropping it; that drop is deliberately never applied.
