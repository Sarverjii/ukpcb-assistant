-- DropIndex
DROP INDEX "document_chunks_embedding_idx";

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;
