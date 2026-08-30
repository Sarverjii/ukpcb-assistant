-- Switching the default EmbeddingProvider from the local in-process model
-- (384-dim) to Gemini's hosted embedding API (768-dim) — see
-- lib/embeddings/geminiEmbeddingProvider.ts for why (a real production
-- crash: running the local model repeatedly exhausted RAM on a
-- memory-constrained host).
--
-- Existing chunks were embedded at 384 dimensions and are not convertible
-- to 768 dimensions — pgvector has no meaningful cast between differently-
-- sized vectors. They must be deleted and every document re-processed
-- through the new provider (re-upload or use the admin "Replace" action).
DELETE FROM "DocumentChunk";

DROP INDEX IF EXISTS "document_chunks_embedding_idx";

ALTER TABLE "DocumentChunk" DROP COLUMN "embedding";
ALTER TABLE "DocumentChunk" ADD COLUMN "embedding" vector(768) NOT NULL;

CREATE INDEX "document_chunks_embedding_idx" ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
