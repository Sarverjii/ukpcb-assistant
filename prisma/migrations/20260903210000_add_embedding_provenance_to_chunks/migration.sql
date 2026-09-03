-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "embeddingProvider" "AIProviderKind";
