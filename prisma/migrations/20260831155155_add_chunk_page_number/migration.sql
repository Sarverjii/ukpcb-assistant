-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "pageNumber" INTEGER;

-- Prisma's own migration diff wanted to also DROP INDEX
-- "document_chunks_embedding_idx" here — it doesn't track the hand-added
-- HNSW index (added outside Prisma's schema modeling, same as the
-- 20260830191102 migration had to recreate it for the same reason) and
-- treats it as drift to reconcile away. Dropping it wouldn't break
-- anything visibly — retrieval would just silently fall back to a full
-- sequential scan over every chunk's embedding on every chat query — so
-- it's deliberately left out of this migration rather than applied.
