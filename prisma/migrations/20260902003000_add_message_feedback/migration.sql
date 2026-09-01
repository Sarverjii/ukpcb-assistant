-- CreateEnum
CREATE TYPE "MessageFeedback" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "feedback" "MessageFeedback";
