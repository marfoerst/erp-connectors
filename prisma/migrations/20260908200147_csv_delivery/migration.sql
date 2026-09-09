-- AlterTable
ALTER TABLE "OrderSync" ADD COLUMN "exportBatch" TEXT;
ALTER TABLE "OrderSync" ADD COLUMN "exportedAt" DATETIME;
ALTER TABLE "OrderSync" ADD COLUMN "importConfirmedAt" DATETIME;
ALTER TABLE "OrderSync" ADD COLUMN "importConfirmedBy" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScopevisioSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "customerGroup" TEXT NOT NULL DEFAULT 'Shopify',
    "guestCustomerGroup" TEXT NOT NULL DEFAULT 'Shopify Guest',
    "numberRangeNumber" INTEGER,
    "guestUseCpd" BOOLEAN NOT NULL DEFAULT true,
    "vatScopeDomestic" INTEGER,
    "vatScopeEuB2c" INTEGER,
    "vatScopeEuB2cOss" INTEGER,
    "vatScopeEuB2bReverse" INTEGER,
    "vatScopeThirdCountry" INTEGER,
    "ossRegistered" BOOLEAN NOT NULL DEFAULT false,
    "homeCountry" TEXT NOT NULL DEFAULT 'DE',
    "taxToleranceCents" INTEGER NOT NULL DEFAULT 2,
    "copyVatFromProduct" BOOLEAN NOT NULL DEFAULT true,
    "copyAccountsFromProduct" BOOLEAN NOT NULL DEFAULT true,
    "documentTemplate" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'csv',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScopevisioSettings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ScopevisioConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScopevisioSettings" ("autoPost", "connectionId", "copyAccountsFromProduct", "copyVatFromProduct", "createdAt", "customerGroup", "documentTemplate", "guestCustomerGroup", "guestUseCpd", "homeCountry", "id", "numberRangeNumber", "ossRegistered", "shop", "syncEnabled", "taxToleranceCents", "updatedAt", "vatScopeDomestic", "vatScopeEuB2bReverse", "vatScopeEuB2c", "vatScopeEuB2cOss", "vatScopeThirdCountry") SELECT "autoPost", "connectionId", "copyAccountsFromProduct", "copyVatFromProduct", "createdAt", "customerGroup", "documentTemplate", "guestCustomerGroup", "guestUseCpd", "homeCountry", "id", "numberRangeNumber", "ossRegistered", "shop", "syncEnabled", "taxToleranceCents", "updatedAt", "vatScopeDomestic", "vatScopeEuB2bReverse", "vatScopeEuB2c", "vatScopeEuB2cOss", "vatScopeThirdCountry" FROM "ScopevisioSettings";
DROP TABLE "ScopevisioSettings";
ALTER TABLE "new_ScopevisioSettings" RENAME TO "ScopevisioSettings";
CREATE UNIQUE INDEX "ScopevisioSettings_shop_key" ON "ScopevisioSettings"("shop");
CREATE UNIQUE INDEX "ScopevisioSettings_connectionId_key" ON "ScopevisioSettings"("connectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
