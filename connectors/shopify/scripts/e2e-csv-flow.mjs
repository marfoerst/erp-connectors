/**
 * End-to-end test of the CSV delivery flow against the live tenant.
 *
 * Verifies the full lifecycle: prepare → queue → batch → confirm, plus the two
 * things that would cause real damage if wrong — exporting the same order
 * twice, and claiming an import succeeded when it did not.
 */
import prisma from "../app/db.server.ts";
import { syncOrder } from "../app/scopevisio/sync.server.ts";
import {
  confirmImported,
  createExportBatch,
  openBatches,
  pendingExport,
  rebuildBatch,
  returnBatchToQueue,
} from "../app/scopevisio/csv-export.server.ts";

const STAMP = Date.now();
const pass = [];
const fail = [];
function check(label, ok, detail = "") {
  (ok ? pass : fail).push(label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function order(key, country = "DE", withCustomer = true) {
  return {
    id: `gid://shopify/Order/CSV-${STAMP}-${key}`,
    name: `#CSV-${key}`,
    processedAt: new Date().toISOString(),
    currencyCode: "EUR",
    email: `csv-${key.toLowerCase()}@example.invalid`,
    customer: withCustomer
      ? { id: `gid://shopify/Customer/CSV-${STAMP}-${key}`, firstName: "CSV", lastName: `Kunde ${key}`, email: `csv-${key.toLowerCase()}@example.invalid` }
      : null,
    billingAddress: { firstName: "CSV", lastName: `Kunde ${key}`, address1: "Teststr. 1", zip: "53113", city: "Bonn", countryCodeV2: country },
    shippingAddress: { firstName: "CSV", lastName: `Kunde ${key}`, address1: "Teststr. 1", zip: "53113", city: "Bonn", countryCodeV2: country },
    totalTaxCents: 1900,
    lineItems: [{ title: "CSV Testartikel", sku: "CSV-SKU-1", quantity: 1, unitAmount: 100 }],
  };
}

const conn = await prisma.scopevisioConnection.findFirst({ include: { settings: true } });
const shop = conn.shop;
const before = conn.settings;

await prisma.scopevisioSettings.update({
  where: { shop },
  data: { syncEnabled: true, autoPost: false, deliveryMode: "csv" },
});

console.log(`shop: ${shop} / ${conn.organisation}\n`);

// --- 1. prepare two domestic orders -------------------------------------
console.log("1. preparing orders");
const a = await syncOrder(shop, order("A"));
const b = await syncOrder(shop, order("B", "DE", false)); // guest
check("domestic order reaches ready_to_export", a.state === "ready_to_export", a.state + (a.reason ? "/" + a.reason : ""));
check("guest order reaches ready_to_export", b.state === "ready_to_export", b.state);

// --- 2. reprocessing a queued order must not duplicate ------------------
console.log("\n2. reprocessing guard");
const again = await syncOrder(shop, order("A"));
check("re-syncing a queued order is skipped", again.state === "skipped" && again.reason === "already_queued", `${again.state}/${again.reason ?? ""}`);

// --- 3. the queue ------------------------------------------------------
console.log("\n3. queue contents");
const queued = await pendingExport(shop);
const mine = queued.filter((r) => r.orderGid.includes(`CSV-${STAMP}`));
check("both orders are queued", mine.length === 2, `${mine.length} queued`);
check("Erlöskonto resolved on queued rows", mine.every((r) => r.resolvedAccount === "8400"), mine.map((r) => r.resolvedAccount).join(","));
check("Steuerschlüssel resolved on queued rows", mine.every((r) => r.resolvedVatKey === "U19"), mine.map((r) => r.resolvedVatKey).join(","));
check("debitor account present on queued rows", mine.every((r) => Boolean(r.personalAccount)), mine.map((r) => r.personalAccount).join(","));

// --- 4. build a batch ---------------------------------------------------
console.log("\n4. batch creation");
const batch = await createExportBatch(shop);
check("batch contains the queued invoices", batch.count >= 2, `${batch.count} rows`);
const dataLines = batch.csv.trim().split("\r\n").slice(1);
check("one CSV row per position", dataLines.length === batch.count, `${dataLines.length} data lines`);
check("CSV carries account and vatKey", dataLines.every((l) => l.endsWith(";8400;U19")), dataLines[0]?.slice(-24) ?? "");
check("CSV has a BOM", batch.csv.charCodeAt(0) === 0xfeff);

// --- 5. the double-export guard ----------------------------------------
console.log("\n5. double-export guard");
const second = await createExportBatch(shop);
check("a second batch does not re-include exported orders", second.count === 0, `${second.count} rows`);
const reDownload = await rebuildBatch(shop, batch.batchId);
check("re-downloading a batch reproduces it exactly", reDownload.csv === batch.csv, `${reDownload.count} rows`);

// --- 6. state must not claim booked before confirmation -----------------
console.log("\n6. honest state");
const exported = await prisma.orderSync.findMany({ where: { shop, exportBatch: batch.batchId } });
check("exported orders are 'exported', not 'booked'", exported.every((r) => r.state === "exported"), [...new Set(exported.map((r) => r.state))].join(","));
check("importConfirmedAt is still empty", exported.every((r) => r.importConfirmedAt === null));
const open = await openBatches(shop);
check("batch awaits confirmation", open.some((o) => o.batchId === batch.batchId));

// --- 7. failed import returns to the queue ------------------------------
console.log("\n7. failed import path");
const returned = await returnBatchToQueue(shop, batch.batchId, "column mapping rejected");
check("returned invoices go back to the queue", returned >= 2, `${returned} returned`);
const requeued = await pendingExport(shop);
check("they are exportable again", requeued.filter((r) => r.orderGid.includes(`CSV-${STAMP}`)).length === 2);

// --- 8. confirm the happy path -----------------------------------------
console.log("\n8. confirmation");
const batch2 = await createExportBatch(shop);
const confirmed = await confirmImported(shop, batch2.batchId, "e2e@test");
check("confirming marks them booked", confirmed >= 2, `${confirmed} confirmed`);
const done = await prisma.orderSync.findMany({ where: { shop, exportBatch: batch2.batchId } });
check("state is booked after confirmation", done.every((r) => r.state === "booked"), [...new Set(done.map((r) => r.state))].join(","));
check("who confirmed it is recorded", done.every((r) => r.importConfirmedBy === "e2e@test"));
const emptyAfter = await pendingExport(shop);
check("queue is drained", emptyAfter.filter((r) => r.orderGid.includes(`CSV-${STAMP}`)).length === 0);

// restore
await prisma.scopevisioSettings.update({
  where: { shop },
  data: { syncEnabled: before.syncEnabled, autoPost: before.autoPost, deliveryMode: before.deliveryMode ?? "csv" },
});

console.log(`\n═══ ${pass.length} passed, ${fail.length} failed ═══`);
if (fail.length) { fail.forEach((f) => console.log(`  FAILED: ${f}`)); }
await prisma.$disconnect();
process.exit(fail.length ? 1 : 0);
