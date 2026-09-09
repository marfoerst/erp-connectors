-- CreateTable
CREATE TABLE "ScopevisioConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://appload.scopevisio.com',
    "customer" TEXT NOT NULL,
    "organisation" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "statusDetail" TEXT,
    "lastCheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScopevisioSettings" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScopevisioSettings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ScopevisioConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "detail" TEXT,
    "contactId" INTEGER,
    "personalAccount" TEXT,
    "documentNumber" TEXT,
    "creditNumber" TEXT,
    "vatScopeUsed" INTEGER,
    "countryUsed" TEXT,
    "shopifyTaxCents" INTEGER,
    "erpTaxCents" INTEGER,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "resolveNote" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastTriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MasterDataCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VatIdCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "vatId" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "detail" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioConnection_shop_key" ON "ScopevisioConnection"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioSettings_shop_key" ON "ScopevisioSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioSettings_connectionId_key" ON "ScopevisioSettings"("connectionId");

-- CreateIndex
CREATE INDEX "OrderSync_shop_state_idx" ON "OrderSync"("shop", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSync_shop_orderGid_key" ON "OrderSync"("shop", "orderGid");

-- CreateIndex
CREATE INDEX "SyncEvent_shop_createdAt_idx" ON "SyncEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SyncEvent_shop_orderGid_idx" ON "SyncEvent"("shop", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "MasterDataCache_shop_kind_key" ON "MasterDataCache"("shop", "kind");

-- CreateIndex
CREATE INDEX "VatIdCheck_shop_vatId_idx" ON "VatIdCheck"("shop", "vatId");
