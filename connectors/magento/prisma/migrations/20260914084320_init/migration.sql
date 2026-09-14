-- CreateTable
CREATE TABLE "MagentoStore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consumerKey" TEXT NOT NULL,
    "consumerSecretEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "accessTokenSecretEnc" TEXT,
    "storeBaseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'handshake',
    "statusDetail" TEXT,
    "lastPolledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScopevisioConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
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
    CONSTRAINT "ScopevisioConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "MagentoStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScopevisioSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "deliveryMode" TEXT NOT NULL DEFAULT 'csv',
    "homeCountry" TEXT NOT NULL DEFAULT 'DE',
    "ossRegistered" BOOLEAN NOT NULL DEFAULT false,
    "customerGroup" TEXT NOT NULL DEFAULT 'Magento',
    "guestCustomerGroup" TEXT NOT NULL DEFAULT 'Magento Gast',
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
    CONSTRAINT "ScopevisioSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "MagentoStore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalRef" TEXT,
    "orderId" INTEGER,
    "orderRef" TEXT,
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
    "exportBatch" TEXT,
    "exportedAt" DATETIME,
    "importConfirmedAt" DATETIME,
    "importConfirmedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastTriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalRef" TEXT,
    "invoiceExternalId" TEXT,
    "orderId" INTEGER,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
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
    "storeId" TEXT NOT NULL,
    "vatId" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "detail" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MagentoStore_consumerKey_key" ON "MagentoStore"("consumerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioConnection_storeId_key" ON "ScopevisioConnection"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopevisioSettings_storeId_key" ON "ScopevisioSettings"("storeId");

-- CreateIndex
CREATE INDEX "SyncRecord_storeId_state_idx" ON "SyncRecord"("storeId", "state");

-- CreateIndex
CREATE INDEX "SyncRecord_storeId_orderId_idx" ON "SyncRecord"("storeId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRecord_storeId_externalId_key" ON "SyncRecord"("storeId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_storeId_externalId_key" ON "RefundRecord"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "SyncEvent_storeId_createdAt_idx" ON "SyncEvent"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "VatIdCheck_storeId_vatId_checkedAt_idx" ON "VatIdCheck"("storeId", "vatId", "checkedAt");
