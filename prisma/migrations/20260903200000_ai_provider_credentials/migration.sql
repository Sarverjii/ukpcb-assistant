-- Runtime-switchable LLM/embedding provider configuration — see
-- AIProviderCredential's schema.prisma comment. No existing table is
-- touched; this is purely additive and starts empty, so every deployment
-- keeps behaving exactly as it did via env vars until an admin actively
-- configures something through Admin -> AI Models.

-- CreateEnum
CREATE TYPE "AICapability" AS ENUM ('LLM', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AIProviderKind" AS ENUM ('ANTHROPIC', 'GEMINI', 'OPENAI', 'OLLAMA');

-- CreateTable
CREATE TABLE "AIProviderCredential" (
    "id" TEXT NOT NULL,
    "capability" "AICapability" NOT NULL,
    "provider" "AIProviderKind" NOT NULL,
    "encryptedApiKey" TEXT,
    "baseUrl" TEXT,
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AIProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIProviderCredential_capability_isActive_idx" ON "AIProviderCredential"("capability", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderCredential_capability_provider_key" ON "AIProviderCredential"("capability", "provider");

-- AddForeignKey
ALTER TABLE "AIProviderCredential" ADD CONSTRAINT "AIProviderCredential_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: same standing HNSW-index gotcha as every prior migration in this
-- project — not applicable here (this migration doesn't touch
-- DocumentChunk), documented in case Prisma's own diff tooling is ever run
-- directly against this migration and proposes the spurious DROP INDEX.
