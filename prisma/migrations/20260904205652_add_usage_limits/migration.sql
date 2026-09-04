-- CreateEnum
CREATE TYPE "UsageScope" AS ENUM ('USER', 'DEPARTMENT', 'ORG');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "dailyMessageLimit" INTEGER;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "defaultDailyMessageLimit" INTEGER NOT NULL DEFAULT 300;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyMessageLimitOverride" INTEGER;

-- CreateTable
CREATE TABLE "OrgUsagePolicy" (
    "id" TEXT NOT NULL DEFAULT 'org-usage-policy',
    "dailyMessageLimit" INTEGER NOT NULL DEFAULT 5000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "OrgUsagePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "scope" "UsageScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageCounter_scope_scopeId_idx" ON "UsageCounter"("scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_scope_scopeId_day_key" ON "UsageCounter"("scope", "scopeId", "day");

-- AddForeignKey
ALTER TABLE "OrgUsagePolicy" ADD CONSTRAINT "OrgUsagePolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
