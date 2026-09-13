-- CreateTable
CREATE TABLE "ShopwareShop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopUrl" TEXT NOT NULL,
    "shopSecret" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "secretKeyEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScopevisioConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://appload.scopevisio.com',
    "customer" TEXT NOT NULL,
    "organisation" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "statusDetail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScopevisioConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopwareShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScopevisioSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "homeCountry" TEXT NOT NULL DEFAULT 'DE',
    "ossRegistered" BOOLEAN NOT NULL DEFAULT false,
    "customerGroup" TEXT NOT NULL DEFAULT 'Shopware',
    "guestCustomerGroup" TEXT NOT NULL DEFAULT 'Shopware Guest',
    "guestUseCpd" BOOLEAN NOT NULL DEFAULT true,
    "numberRangeNumber" INTEGER,
    "taxToleranceCents" INTEGER NOT NULL DEFAULT 2,
    "vatScopeDomestic" INTEGER,
    "vatScopeEuB2c" INTEGER,
    "vatScopeEuB2cOss" INTEGER,
    "vatScopeEuB2bReverse" INTEGER,
    "vatScopeThirdCountry" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScopevisioSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopwareShop" ("shopId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalRef" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "detail" TEXT,
    "contactId" INTEGER,
    "personalAccount" TEXT,
    "documentNumber" TEXT,
    "vatScopeUsed" INTEGER,
    "countryUsed" TEXT,
    "draftJson" TEXT,
    "sourceTaxCents" INTEGER,
    "erpTaxCents" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastTriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "externalId" TEXT,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VatIdCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "vatId" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "detail" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopwareShop_shopId_key" ON "ShopwareShop"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioConnection_shopId_key" ON "ScopevisioConnection"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioSettings_shopId_key" ON "ScopevisioSettings"("shopId");

-- CreateIndex
CREATE INDEX "SyncRecord_shopId_state_idx" ON "SyncRecord"("shopId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRecord_shopId_externalId_key" ON "SyncRecord"("shopId", "externalId");

-- CreateIndex
CREATE INDEX "SyncEvent_shopId_createdAt_idx" ON "SyncEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "VatIdCheck_shopId_vatId_checkedAt_idx" ON "VatIdCheck"("shopId", "vatId", "checkedAt");
