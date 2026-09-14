/**
 * DEV ONLY. Copies an existing Scopevisio connection (refresh token, no
 * password) from another connector's local database into this one, so the
 * live e2e can run without anyone retyping the test tenant's password.
 *
 *   SOURCE_DB=../shopware/prisma/dev.sqlite SOURCE_KEY=<that connector's key> \
 *     node --import tsx scripts/seed-connection.ts
 *
 * Scopevisio may rotate the refresh token on use, which would invalidate the
 * source copy. Run with WRITE_BACK=1 after the e2e to copy the current token
 * back, re-encrypted with the source key.
 */
import { execFileSync } from "node:child_process";

import { decrypt, encrypt } from "@erp/scopevisio-core";

import { loadDotenv } from "../src/config.js";

loadDotenv();
const prisma = (await import("../src/db.js")).default;

const sourceDb = process.env.SOURCE_DB;
const sourceKey = process.env.SOURCE_KEY;
if (!sourceDb || !sourceKey) throw new Error("Set SOURCE_DB and SOURCE_KEY.");
const ownKey = process.env.SCOPEVISIO_ENCRYPTION_KEY!;

function withKey<T>(k: string, fn: () => T): T {
  const previous = process.env.SCOPEVISIO_ENCRYPTION_KEY;
  process.env.SCOPEVISIO_ENCRYPTION_KEY = k;
  try {
    return fn();
  } finally {
    process.env.SCOPEVISIO_ENCRYPTION_KEY = previous;
  }
}

const sql = (q: string) =>
  execFileSync("sqlite3", ["-separator", "\t", sourceDb, q], { encoding: "utf8" }).trim();

const store = await prisma.magentoStore.findFirst({ where: { status: "active" } });
if (!store) throw new Error("No active Magento store yet — activate the integration first.");

if (process.env.WRITE_BACK === "1") {
  const own = await prisma.scopevisioConnection.findUnique({ where: { storeId: store.id } });
  if (!own?.refreshTokenEnc) throw new Error("Nothing to write back.");
  const token = decrypt(own.refreshTokenEnc);
  const reEncrypted = withKey(sourceKey, () => encrypt(token));
  sql(`UPDATE ScopevisioConnection SET refreshTokenEnc='${reEncrypted}', accessTokenEnc=NULL, accessTokenExpiresAt=NULL`);
  console.log("Current refresh token written back to", sourceDb);
  process.exit(0);
}

const [customer, organisation, username, refreshEnc] = sql(
  "SELECT customer, organisation, username, refreshTokenEnc FROM ScopevisioConnection WHERE refreshTokenEnc IS NOT NULL LIMIT 1",
).split("\t");
if (!refreshEnc) throw new Error("The source database holds no refresh token.");

const refreshToken = withKey(sourceKey, () => decrypt(refreshEnc));
process.env.SCOPEVISIO_ENCRYPTION_KEY = ownKey;

await prisma.scopevisioConnection.upsert({
  where: { storeId: store.id },
  create: { storeId: store.id, customer, organisation, username, refreshTokenEnc: encrypt(refreshToken), status: "connected" },
  update: { customer, organisation, username, refreshTokenEnc: encrypt(refreshToken), accessTokenEnc: null, accessTokenExpiresAt: null, passwordEnc: null, status: "connected" },
});
await prisma.scopevisioSettings.upsert({ where: { storeId: store.id }, create: { storeId: store.id }, update: {} });
console.log(`Seeded connection for store ${store.id}: customer ${customer}, ${organisation}, ${username}`);
