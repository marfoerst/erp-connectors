/**
 * Tests pollOrders against a stubbed Shopify client and the real database.
 *
 * Covers what the pure mapper tests cannot: paging, cursor advance, error
 * isolation, and that polling and webhooks cannot double-book the same order.
 */
import prisma from "../app/db.server.ts";
import { pollOrders } from "../app/scopevisio/intake.server.ts";
import { syncOrder } from "../app/scopevisio/sync.server.ts";

const pass = [], fail = [];
const check = (label, ok, detail = "") => {
  (ok ? pass : fail).push(label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const STAMP = Date.now();
const conn = await prisma.scopevisioConnection.findFirst({ include: { settings: true } });
const shop = conn.shop;
const before = conn.settings;
await prisma.scopevisioSettings.update({
  where: { shop },
  data: { syncEnabled: true, autoPost: false, deliveryMode: "csv", lastPolledAt: null },
});

function node(key, country = "DE", withCustomer = true) {
  return {
    id: `gid://shopify/Order/POLL-${STAMP}-${key}`,
    name: `#POLL-${key}`,
    number: 1,
    createdAt: new Date().toISOString(),
    processedAt: new Date().toISOString(),
    email: `poll-${key}@example.invalid`,
    currencyCode: "EUR",
    totalTaxSet: { shopMoney: { amount: "19.00" } },
    paymentGatewayNames: ["paypal"],
    customAttributes: [],
    customer: withCustomer ? { id: `gid://shopify/Customer/POLL-${STAMP}-${key}`, firstName: "Poll", lastName: `Kunde ${key}`, email: `poll-${key}@example.invalid` } : null,
    billingAddress: { lastName: `Kunde ${key}`, address1: "Teststr. 1", zip: "53113", city: "Bonn", countryCodeV2: country },
    shippingAddress: { lastName: `Kunde ${key}`, address1: "Teststr. 1", zip: "53113", city: "Bonn", countryCodeV2: country },
    lineItems: { nodes: [{ title: "Poll Artikel", sku: "POLL-1", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "100.00" } }, taxLines: [{ rate: 0.19, priceSet: { shopMoney: { amount: "19.00" } } }] }] },
  };
}

/** A stub that serves nodes in pages and records the queries it received. */
function stub(pages, opts = {}) {
  const calls = [];
  return {
    calls,
    graphql: async (_q, { variables } = {}) => {
      calls.push(variables);
      if (opts.errors) return { json: async () => ({ errors: [{ message: "Throttled" }] }) };
      const idx = variables?.cursor ? Number(variables.cursor.replace("c", "")) : 0;
      const page = pages[idx] ?? [];
      const hasNext = idx + 1 < pages.length;
      return { json: async () => ({ data: { orders: { pageInfo: { hasNextPage: hasNext, endCursor: `c${idx + 1}` }, nodes: page } } }) };
    },
  };
}

console.log("1. single page");
const s1 = stub([[node("A"), node("B", "DE", false)]]);
const r1 = await pollOrders(shop, s1);
check("scans every order on the page", r1.scanned === 2, `${r1.scanned}`);
check("prepares both", r1.prepared === 2, `prepared=${r1.prepared} held=${r1.held}`);
check("queries for paid orders only", s1.calls[0].query.includes("financial_status:paid"));

console.log("\n2. paging");
const s2 = stub([[node("C")], [node("D")], [node("E")]]);
const r2 = await pollOrders(shop, s2);
check("follows every page", r2.pages === 3, `${r2.pages} pages`);
check("scans all orders across pages", r2.scanned === 3, `${r2.scanned}`);
check("passes the cursor on subsequent calls", s2.calls[1]?.cursor === "c1" && s2.calls[2]?.cursor === "c2", JSON.stringify(s2.calls.map(c => c.cursor)));

console.log("\n3. cursor persistence");
const settingsAfter = await prisma.scopevisioSettings.findUnique({ where: { shop } });
check("lastPolledAt is recorded", settingsAfter.lastPolledAt !== null, String(settingsAfter.lastPolledAt));
const s3 = stub([[]]);
const r3 = await pollOrders(shop, s3);
check("next poll queries from the stored cursor", s3.calls[0].query.includes("processed_at:>="), s3.calls[0].query.slice(0, 60));
check("window overlaps rather than starting exactly at the cursor", new Date(r3.since) < settingsAfter.lastPolledAt, r3.since);

console.log("\n4. no double-booking across intake paths");
const dup = node("F");
const viaPoll = await pollOrders(shop, stub([[dup]]));
const viaWebhook = await syncOrder(shop, {
  id: dup.id, name: dup.name, processedAt: dup.processedAt, currencyCode: "EUR",
  email: dup.email, customer: { id: dup.customer.id, lastName: "Kunde F", email: dup.email },
  billingAddress: dup.billingAddress, shippingAddress: dup.shippingAddress,
  totalTaxCents: 1900, lineItems: [{ title: "Poll Artikel", sku: "POLL-1", quantity: 1, unitAmount: 100 }],
});
const rows = await prisma.orderSync.count({ where: { shop, orderGid: dup.id } });
check("polling prepared it", viaPoll.prepared === 1);
check("the webhook path then skips it", viaWebhook.state === "skipped", `${viaWebhook.state}/${viaWebhook.reason ?? ""}`);
check("exactly one OrderSync row exists", rows === 1, `${rows} rows`);

console.log("\n5. API errors are reported, not swallowed");
const r5 = await pollOrders(shop, stub([[node("G")]], { errors: true }));
check("the error is captured", r5.errors.length > 0, r5.errors[0] ?? "");
check("nothing is prepared from a failed query", r5.prepared === 0);

console.log("\n6. one bad order does not abort the run");
const bad = { ...node("H"), lineItems: null, billingAddress: null, shippingAddress: null, customer: null, email: null };
const r6 = await pollOrders(shop, stub([[bad, node("I")]]));
check("the run continues past a problem order", r6.scanned === 2, `${r6.scanned} scanned`);
check("the healthy order still got handled", r6.prepared + r6.held >= 1, `prepared=${r6.prepared} held=${r6.held}`);

// cleanup
await prisma.orderSync.deleteMany({ where: { shop, orderGid: { contains: `POLL-${STAMP}` } } });
await prisma.scopevisioSettings.update({
  where: { shop },
  data: { syncEnabled: before.syncEnabled, autoPost: before.autoPost, deliveryMode: before.deliveryMode ?? "csv", lastPolledAt: before.lastPolledAt },
});

console.log(`\n═══ ${pass.length} passed, ${fail.length} failed ═══`);
fail.forEach(f => console.log(`  FAILED: ${f}`));
await prisma.$disconnect();
process.exit(fail.length ? 1 : 0);
