/**
 * End-to-end test against a live Scopevisio tenant.
 *
 * Drives the same code path a webhook takes (`syncOrder`), because webhooks
 * cannot reach a localhost dev server. Runs with autoPost forced OFF, so
 * documents are created but never committed to the ledger — nothing here is
 * irreversible.
 *
 *   node --import tsx scripts/e2e-orders.mjs
 *
 * Test data is prefixed E2E- so it can be identified and cleaned up.
 */

import prisma from "../app/db.server.ts";
import { syncOrder } from "../app/scopevisio/sync.server.ts";
import { classify } from "../app/scopevisio/tax-rules.ts";

const STAMP = Date.now();

function order({ key, country, company, vatId, customerId, lines }) {
  return {
    id: `gid://shopify/Order/E2E-${STAMP}-${key}`,
    name: `#E2E-${key}`,
    orderNumber: `E2E-${key}`,
    processedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    currencyCode: "EUR",
    email: `e2e-${key.toLowerCase()}@example.invalid`,
    customer: customerId
      ? {
          id: `gid://shopify/Customer/E2E-${STAMP}-${key}`,
          firstName: "Test",
          lastName: `Kunde ${key}`,
          email: `e2e-${key.toLowerCase()}@example.invalid`,
        }
      : null,
    billingAddress: {
      firstName: "Test",
      lastName: `Kunde ${key}`,
      company: company ?? null,
      address1: "Teststraße 1",
      zip: "53113",
      city: "Bonn",
      countryCodeV2: country,
    },
    shippingAddress: {
      firstName: "Test",
      lastName: `Kunde ${key}`,
      company: company ?? null,
      address1: "Teststraße 1",
      zip: "53113",
      city: "Bonn",
      countryCodeV2: country,
    },
    vatId: vatId ?? null,
    paymentGatewayNames: ["PayPal"],
    lineItems: lines,
  };
}

const LINE = { title: "E2E Testartikel", sku: "E2E-SKU-1", quantity: 1, unitAmount: 100 };

const CASES = [
  {
    key: "DOM",
    label: "Domestic B2C (DE → DE, account holder)",
    order: order({ key: "DOM", country: "DE", customerId: true, lines: [LINE] }),
    expectTaxCase: "domestic",
  },
  {
    key: "GUEST",
    label: "Domestic guest checkout (no Shopify customer → CPD)",
    order: order({ key: "GUEST", country: "DE", customerId: false, lines: [LINE] }),
    expectTaxCase: "domestic",
  },
  {
    key: "B2B",
    label: "EU B2B with a real VAT ID (FR, reverse charge)",
    // A genuine, publicly-known valid French VAT ID so VIES returns valid.
    order: order({
      key: "B2B",
      country: "FR",
      company: "E2E Test SARL",
      vatId: "FR40303265045",
      customerId: true,
      lines: [LINE],
    }),
    expectTaxCase: "eu_b2b_reverse",
  },
  {
    key: "B2C-EU",
    label: "EU B2C (FR, no VAT ID)",
    order: order({ key: "B2C-EU", country: "FR", customerId: true, lines: [LINE] }),
    expectTaxCase: "eu_b2c",
  },
  {
    key: "3RD",
    label: "Third country (CH, export)",
    order: order({ key: "3RD", country: "CH", customerId: true, lines: [LINE] }),
    expectTaxCase: "third_country",
  },
];

async function main() {
  const conn = await prisma.scopevisioConnection.findFirst({ include: { settings: true } });
  if (!conn) {
    console.error("No Scopevisio connection. Connect via the app first.");
    process.exit(1);
  }

  const shop = conn.shop;
  console.log(`shop:         ${shop}`);
  console.log(`organisation: ${conn.organisation}`);

  const before = conn.settings;
  console.log(
    `settings before: syncEnabled=${before?.syncEnabled} autoPost=${before?.autoPost}\n`,
  );

  // Force a safe configuration for the run: sync on, posting OFF.
  await prisma.scopevisioSettings.update({
    where: { shop },
    data: { syncEnabled: true, autoPost: false },
  });

  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  console.log("tax-case mapping in effect:");
  for (const [k, v] of Object.entries({
    domestic: settings.vatScopeDomestic,
    eu_b2c: settings.vatScopeEuB2c,
    eu_b2c_oss: settings.vatScopeEuB2cOss,
    eu_b2b_reverse: settings.vatScopeEuB2bReverse,
    third_country: settings.vatScopeThirdCountry,
  })) {
    console.log(`  ${k.padEnd(16)} vatScope=${v ?? "— NOT SET —"}`);
  }
  console.log(`  ossRegistered=${settings.ossRegistered} homeCountry=${settings.homeCountry}\n`);

  const results = [];

  for (const c of CASES) {
    const predicted = classify({
      destination: c.order.shippingAddress.countryCodeV2,
      homeCountry: settings.homeCountry,
      ossRegistered: settings.ossRegistered,
      hasValidVatId: Boolean(c.order.vatId),
    });

    process.stdout.write(`── ${c.key.padEnd(8)} ${c.label}\n`);
    let outcome;
    try {
      outcome = await syncOrder(shop, c.order);
    } catch (err) {
      outcome = { state: "threw", reason: String(err?.message ?? err) };
    }

    const row = await prisma.orderSync.findUnique({
      where: { shop_orderGid: { shop, orderGid: c.order.id } },
    });

    console.log(`   predicted case: ${predicted} (expected ${c.expectTaxCase})`);
    console.log(`   outcome:        ${outcome.state}${outcome.reason ? ` / ${outcome.reason}` : ""}`);
    if (outcome.detail) console.log(`   detail:         ${outcome.detail}`);
    if (row) {
      console.log(
        `   db:             contactId=${row.contactId ?? "-"} account=${row.personalAccount ?? "-"} doc=${row.documentNumber ?? "-"} country=${row.countryUsed ?? "-"} vatScope=${row.vatScopeUsed ?? "-"}`,
      );
    }
    console.log();

    results.push({
      key: c.key,
      predicted,
      expected: c.expectTaxCase,
      classifyOk: predicted === c.expectTaxCase,
      state: outcome.state,
      reason: outcome.reason ?? null,
      contactId: row?.contactId ?? null,
      documentNumber: row?.documentNumber ?? null,
    });
  }

  // Idempotency: replay both an account-holder order and a GUEST order. The
  // guest case is the one that used to create a fresh contact every attempt,
  // because a guest has no Shopify customer id to key on.
  console.log("── REPLAY  idempotency checks");
  const replayChecks = [];
  for (const key of ["DOM", "GUEST"]) {
    const c = CASES.find((x) => x.key === key);
    const firstRow = await prisma.orderSync.findUnique({
      where: { shop_orderGid: { shop, orderGid: c.order.id } },
    });
    const contactBefore = firstRow?.contactId ?? null;

    const replay = await syncOrder(shop, c.order);

    const afterRow = await prisma.orderSync.findUnique({
      where: { shop_orderGid: { shop, orderGid: c.order.id } },
    });
    const rows = await prisma.orderSync.count({ where: { shop, orderGid: c.order.id } });
    const contactAfter = afterRow?.contactId ?? null;
    const sameContact = contactBefore !== null && contactBefore === contactAfter;

    console.log(
      `   ${key}: outcome=${replay.state}${replay.reason ? `/${replay.reason}` : ""} rows=${rows} contact ${contactBefore} -> ${contactAfter} ${sameContact ? "REUSED ✓" : contactBefore === null ? "(no contact yet)" : "NEW CONTACT ✗"}`,
    );
    replayChecks.push({ key, rows, contactBefore, contactAfter, sameContact });
  }
  const replayRows = replayChecks[0].rows;
  console.log();

  // Restore the merchant's original settings.
  await prisma.scopevisioSettings.update({
    where: { shop },
    data: { syncEnabled: before?.syncEnabled ?? false, autoPost: before?.autoPost ?? false },
  });

  console.log("═══ SUMMARY ═══");
  console.table(results);

  const contacts = results.filter((r) => r.contactId).length;
  const docs = results.filter((r) => r.documentNumber).length;
  const classifyFails = results.filter((r) => !r.classifyOk);

  console.log(`\ncontacts created/linked: ${contacts}/${results.length}`);
  console.log(`documents created:       ${docs}/${results.length}`);
  console.log(`tax-case mismatches:     ${classifyFails.length}`);
  console.log(`idempotent replay:       ${replayRows === 1 ? "PASS" : "FAIL"}`);
  for (const r of replayChecks) {
    console.log(
      `  ${r.key}: contact reuse ${r.sameContact ? "PASS" : r.contactBefore === null ? "n/a (never created)" : "FAIL — duplicate created"}`,
    );
  }
  console.log("\nsettings restored. Nothing was posted to the ledger (autoPost was off).");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
