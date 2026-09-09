-- AlterTable
ALTER TABLE "OrderSync" ADD COLUMN "draftJson" TEXT;
ALTER TABLE "OrderSync" ADD COLUMN "resolvedAccount" TEXT;
ALTER TABLE "OrderSync" ADD COLUMN "resolvedVatKey" TEXT;
