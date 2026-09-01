-- AlterEnum: add the third UserStatus value (soft-removed, pre hard-delete)
ALTER TYPE "UserStatus" ADD VALUE 'REMOVED';

-- CreateTable: revocable login-session tracking, separate from Auth.js's
-- own unused Session model (this app's auth is pure JWT).
CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LoginSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginSession_userId_idx" ON "LoginSession"("userId");

ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Message gains an optional "this was edited" timestamp
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMP(3);

-- AlterTable: Conversation.userId now cascades on User delete (was RESTRICT)
-- — a hard-deleted employee's conversations (and their messages, which
-- already cascade from Conversation) are deleted with them.
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_userId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Document.uploadedById becomes optional, and now sets null on
-- User delete (was RESTRICT, which would have blocked hard-deleting any
-- employee who ever uploaded a document). A hard-deleted employee's
-- documents are never force-deleted by this — they survive with a null
-- uploader, displayed as "Removed employee". No existing row's value
-- changes; every current Document keeps its real uploadedById.
ALTER TABLE "Document" DROP CONSTRAINT "Document_uploadedById_fkey";
ALTER TABLE "Document" ALTER COLUMN "uploadedById" DROP NOT NULL;
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: AuditLog_userId_fkey is already ON DELETE SET NULL as of the initial
-- migration (Prisma's default for an optional scalar relation field) — no
-- change needed here; audit history already survives a user being deleted.
