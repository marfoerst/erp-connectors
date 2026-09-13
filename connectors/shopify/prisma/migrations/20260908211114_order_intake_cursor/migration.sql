-- AlterTable
ALTER TABLE "ScopevisioSettings" ADD COLUMN "lastPolledAt" DATETIME;
ALTER TABLE "ScopevisioSettings" ADD COLUMN "pollCursor" TEXT;
