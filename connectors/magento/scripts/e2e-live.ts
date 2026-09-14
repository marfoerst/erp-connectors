/**
 * End to end against a real Magento and the real Scopevisio test tenant.
 *
 * Nothing is simulated on the Magento side: orders go through Magento's own
 * cart and checkout API, invoices and credit memos are created by Magento, the
 * extension's observer writes the outbox, and the extension's own delivery
 * command sends the signed webhooks to the running connector. The connector
 * then fetches everything back over OAuth-signed REST.
 *
 * Never posts to the ledger: delivery mode is CSV, and "booked" here only means
 * the bookkeeper-confirmation step was exercised.
 *
 * Prerequisites: `docker compose -f dev/docker-compose.yml up`, the connector
 * running (`npm run dev`), the integration activated, a Scopevisio connection.
 *
 *   npm run e2e                     # CAPTURE_FIXTURES=1 also saves real payloads
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { tryDecrypt } from "@erp/scopevisio-core";

import { loadDotenv } from "../src/config.js";
import { signAdminLink, signWebhook } from "../src/signature.js";

loadDotenv();
const prisma = (await import("../src/db.js")).default;
const { MagentoClient } = await import("../src/magento-api.js");
const { scopevisioContext } = await import("../src/store.js");

const MAGENTO = process.env.MAGENTO_URL ?? "http://localhost:8080";
const CONNECTOR = process.env.CONNECTOR_URL ?? "http://localhost:3200";
const ADMIN_USER = process.env.MAGENTO_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.MAGENTO_ADMIN_PASSWORD ?? "Admin12345!";
const COMPOSE = path.resolve(import.meta.dirname, "../dev/docker-compose.yml");
const STAMP = Date.now().toString(36);

// --- reporting ----------------------------------------------------------------

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}
const section = (title: string) => console.log(`\n${title}`);

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// --- Magento REST as the shop itself --------------------------------------------

const adminToken = await (async () => {
  const res = await fetch(`${MAGENTO}/rest/V1/integration/admin/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Magento admin token: HTTP ${res.status}`);
  return (await res.json()) as string;
})();

async function mg<T = any>(method: string, route: string, body?: unknown, auth = true): Promise<T> {
  const res = await fetch(`${MAGENTO}/rest/V1${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Magento ${method} ${route}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Address {
  firstname: string; lastname: string; street: string[]; city: string; postcode: string;
  country_id: string; telephone: string; email: string; company?: string; vat_id?: string; region_id?: number;
}

type Line = { sku: "24-WB04" } | { sku: "MH01" };

function cartItem(line: Line, quoteId: string | number) {
  if (line.sku === "MH01") {
    // Chaz Kangeroo Hoodie, Black / XS — a configurable, invoiced as parent + child.
    return {
      cartItem: {
        sku: "MH01", qty: 1, quote_id: quoteId,
        product_option: { extension_attributes: { configurable_item_options: [
          { option_id: "93", option_value: 49 },
          { option_id: "144", option_value: 166 },
        ] } },
      },
    };
  }
  return { cartItem: { sku: line.sku, qty: 2, quote_id: quoteId } };
}

async function guestOrder(address: Address, lines: Line[]): Promise<number> {
  const cartId = await mg<string>("POST", "/guest-carts", undefined, false);
  for (const line of lines) await mg("POST", `/guest-carts/${cartId}/items`, cartItem(line, cartId), false);
  await mg("POST", `/guest-carts/${cartId}/shipping-information`, {
    addressInformation: {
      shipping_address: address, billing_address: address,
      shipping_carrier_code: "flatrate", shipping_method_code: "flatrate",
    },
  }, false);
  const orderId = await mg("POST", `/guest-carts/${cartId}/payment-information`, {
    email: address.email, paymentMethod: { method: "checkmo" }, billingAddress: address,
  }, false);
  return Number(orderId);
}

async function customerOrder(customerId: number, address: Address, lines: Line[]): Promise<number> {
  // Returns the customer's ACTIVE cart if there is one — which still holds
  // whatever an earlier, interrupted run put in it. Empty it first.
  const cartId = await mg<number>("POST", `/customers/${customerId}/carts`);
  for (const item of await mg<Array<{ item_id: number }>>("GET", `/carts/${cartId}/items`)) {
    await mg("DELETE", `/carts/${cartId}/items/${item.item_id}`);
  }
  for (const line of lines) await mg("POST", `/carts/${cartId}/items`, cartItem(line, cartId));
  // The sample customer's default address is in Michigan. Without clearing the
  // region explicitly, Magento merges region 33 into a German address and
  // refuses the order.
  const local = { ...address, region_id: 0, region: "" };
  await mg("POST", `/carts/${cartId}/shipping-information`, {
    addressInformation: {
      shipping_address: local, billing_address: local,
      shipping_carrier_code: "flatrate", shipping_method_code: "flatrate",
    },
  });
  // payment-information exists only for guest and "mine" carts; an admin token
  // sets the billing address and places the order in two calls.
  await mg("POST", `/carts/${cartId}/billing-address`, { address: local });
  const orderId = await mg("PUT", `/carts/${cartId}/order`, { paymentMethod: { method: "checkmo" } });
  return Number(orderId);
}

/** Invoice (captured, so paid). Pass SKUs to invoice only those top-level items. */
async function invoice(orderId: number, onlySkus?: string[]): Promise<number> {
  let items: Array<{ order_item_id: number; qty: number }> | undefined;
  if (onlySkus) {
    const order = await mg("GET", `/orders/${orderId}`);
    items = order.items
      .filter((i: any) => !i.parent_item_id && onlySkus.some((s) => i.sku.startsWith(s)))
      .map((i: any) => ({ order_item_id: i.item_id, qty: i.qty_ordered }));
  }
  const id = await mg("POST", `/order/${orderId}/invoice`, { capture: true, notify: false, ...(items ? { items } : {}) });
  return Number(id);
}

async function refund(orderId: number): Promise<number> {
  return Number(await mg("POST", `/order/${orderId}/refund`, { notify: false }));
}

function deliverOutbox(): string {
  return execFileSync(
    "docker",
    ["compose", "-f", COMPOSE, "exec", "-T", "-u", "www-data", "magento", "php", "bin/magento", "scopevisio:outbox:deliver"],
    { encoding: "utf8" },
  );
}

const address = (over: Partial<Address>): Address => ({
  firstname: "Erika", lastname: `Mustermann ${STAMP}`, street: ["Teststraße 1"], city: "Bonn",
  postcode: "53113", country_id: "DE", telephone: "0228 123456", email: `e2e-${STAMP}@example.invalid`, ...over,
});

// --- connector as a browser would use it ------------------------------------------

const store = await prisma.magentoStore.findFirstOrThrow({ where: { status: "active" } });
const consumerSecret = tryDecrypt(store.consumerSecretEnc)!;

let sessionCookie = "";
async function connector(method: string, route: string, form?: Record<string, string>) {
  const res = await fetch(`${CONNECTOR}${route}`, {
    method,
    redirect: "manual",
    headers: {
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.getSetCookie(), text: await res.text() };
}
const csrfOf = (html: string) => html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";

const record = (invoiceId: number) =>
  prisma.syncRecord.findUnique({ where: { storeId_externalId: { storeId: store.id, externalId: `invoice:${invoiceId}` } } });
const settled = (invoiceId: number) =>
  waitFor(`invoice ${invoiceId} to settle`, async () => {
    const r = await record(invoiceId);
    return r && r.state !== "pending" ? r : null;
  });

// ================================================================================

console.log(`Magento ${MAGENTO} · connector ${CONNECTOR} · store ${store.id} · run ${STAMP}`);

section("Connector surface");
{
  const health = await fetch(`${CONNECTOR}/healthz`).then((r) => r.json());
  check("healthz touches the database", health.ok === true, health);

  const anonymous = await connector("GET", "/magento/app");
  check("screens refuse a request without a session", anonymous.status === 401, anonymous.status);

  const ts = String(Math.floor(Date.now() / 1000));
  const forged = await connector("GET", `/magento/admin?consumer_key=${store.consumerKey}&ts=${ts}&user=mallory&signature=${signAdminLink(consumerSecret, store.consumerKey, ts, "admin")}`);
  check("admin link signed for another user is refused", forged.status === 403, forged.status);

  const login = await connector("GET", `/magento/admin?consumer_key=${store.consumerKey}&ts=${ts}&user=e2e&signature=${signAdminLink(consumerSecret, store.consumerKey, ts, "e2e")}`);
  sessionCookie = login.setCookie.find((c) => c.startsWith("sv_mg_session="))?.split(";")[0] ?? "";
  check("signed admin link opens a session", login.status === 303 && Boolean(sessionCookie), login.status);

  const settingsPage = await connector("GET", "/magento/app/settings");
  check("settings offer the tenant's own Steuersachverhalte", settingsPage.text.includes("1 – Inland") && settingsPage.text.includes("2 – Drittland"));

  const noCsrf = await connector("POST", "/magento/app/settings", { syncEnabled: "1" });
  check("a form post without CSRF token is refused", noCsrf.status === 403, noCsrf.status);

  const saved = await connector("POST", "/magento/app/settings", {
    csrf: csrfOf(settingsPage.text),
    syncEnabled: "1", deliveryMode: "csv", homeCountry: "DE",
    vatScopeDomestic: "1", vatScopeEuB2c: "1", vatScopeEuB2cOss: "", vatScopeEuB2bReverse: "16", vatScopeThirdCountry: "2",
    customerGroup: "Magento E2E", guestCustomerGroup: "Magento E2E Gast", guestUseCpd: "1",
    numberRangeNumber: "", taxToleranceCents: "2",
  });
  const settings = await prisma.scopevisioSettings.findUnique({ where: { storeId: store.id } });
  check("settings saved through the form", saved.status === 303 && settings?.syncEnabled === true && settings.vatScopeEuB2bReverse === 16, { status: saved.status, settings });
}

section("Orders placed through Magento's checkout, invoiced and refunded by Magento");
const chRegion = (await mg("GET", "/directory/countries/CH")).available_regions?.[0]?.id;

const orderA = await customerOrder(1, address({ firstname: "Veronica", lastname: "Costello", email: "roni_cost@example.com" }), [{ sku: "MH01" }, { sku: "24-WB04" }]);
const invoiceA = await invoice(orderA);
console.log(`  A  customer, DE, configurable + 2 bottles      order ${orderA} invoice ${invoiceA}`);

const orderB = await guestOrder(address({ lastname: `Gast Teillieferung ${STAMP}`, city: "Köln", postcode: "50667" }), [{ sku: "24-WB04" }, { sku: "MH01" }]);
const invoiceB1 = await invoice(orderB, ["24-WB04"]);
const invoiceB2 = await invoice(orderB, ["MH01"]);
console.log(`  B  guest, DE, two partial invoices              order ${orderB} invoices ${invoiceB1}, ${invoiceB2}`);

const orderF = await guestOrder(address({ lastname: `Gast AT ${STAMP}`, city: "Wien", postcode: "1010", country_id: "AT" }), [{ sku: "24-WB04" }]);
const invoiceF = await invoice(orderF);
console.log(`  F  guest, AT (EU B2C, not OSS)                  order ${orderF} invoice ${invoiceF}`);

const orderC = await guestOrder(address({ lastname: `Gast CH ${STAMP}`, city: "Zürich", postcode: "8001", country_id: "CH", region_id: chRegion }), [{ sku: "24-WB04" }]);
const invoiceC = await invoice(orderC);
console.log(`  C  guest, CH (third country)                    order ${orderC} invoice ${invoiceC}`);

const orderD = await guestOrder(address({ lastname: `Gast Storno ${STAMP}` }), [{ sku: "24-WB04" }]);
const invoiceD = await invoice(orderD);
const memoD = await refund(orderD);
console.log(`  D  guest, DE, fully refunded before export      order ${orderD} invoice ${invoiceD} credit memo ${memoD}`);

const orderE = await guestOrder(address({ lastname: `Firma ${STAMP}`, company: `E2E Handels GmbH ${STAMP}`, vat_id: "ATU00000000", city: "Graz", postcode: "8010", country_id: "AT" }), [{ sku: "24-WB04" }]);
const invoiceE = await invoice(orderE);
console.log(`  E  company, AT, VAT ID that VIES rejects        order ${orderE} invoice ${invoiceE}`);

section("Extension outbox → signed webhooks");
{
  const outbox = execFileSync("docker", ["compose", "-f", COMPOSE, "exec", "-T", "db", "mariadb", "-umagento", "-pmagento", "magento", "-N", "-e",
    `select event, entity_id, status from scopevisio_outbox where (event='invoice.paid' and entity_id in (${[invoiceA, invoiceB1, invoiceB2, invoiceC, invoiceD, invoiceE, invoiceF].join(",")})) or (event='creditmemo.created' and entity_id=${memoD})`], { encoding: "utf8" });
  check("the observer enqueued all seven invoices and the credit memo", outbox.trim().split("\n").length === 8, outbox);
  const run = deliverOutbox();
  console.log(run.trim().split("\n").map((l) => `    ${l}`).join("\n"));
  check("the extension delivered them without failures", /Delivered \d+, failed 0/.test(run) || /Nothing sent/.test(run), run);
}

section("Results in the connector and in Scopevisio");
const A = await settled(invoiceA);
const draftA = A.draftJson ? JSON.parse(A.draftJson) : null;
check("A is ready for export", A.state === "ready_to_export", A);
check("A resolved the domestic Erlöskonto and Steuerschlüssel", Boolean(draftA?.account && draftA?.vatKey) && A.countryUsed === "DE", draftA);
const netCentsA = (draftA?.positions ?? []).reduce((s: number, p: any) => s + Math.round(p.singleAmount * 100) * p.quantity, 0);
check("A books the hoodie once, two bags and shipping, all net",
  Math.abs(draftA?.positions?.find((p: any) => p.number === "MH01-XS-Black")?.singleAmount - 52 / 1.19) < 0.01 &&
  (draftA?.positions ?? []).filter((p: any) => p.number === "24-WB04").reduce((s: number, p: any) => s + p.quantity, 0) === 2 &&
  draftA.positions.some((p: any) => p.name === "Versand"), draftA?.positions);
check("A's positions add up to Magento's net total to the cent (131.93)", netCentsA === 13193, netCentsA);

const ctx = await scopevisioContext(store.id);
if (A.contactId) {
  const contact = await ctx.client.get<any>(`/contact/ID/${A.contactId}`);
  check("A's contact in Scopevisio carries the store-scoped customer id and the magento tag",
    /^magento:[0-9a-f]{8}:customer:1$/.test(contact?.legacyNumber ?? "") && String(contact?.tags ?? "").includes("magento"),
    { legacyNumber: contact?.legacyNumber, tags: contact?.tags });
  console.log(`    contact ${A.contactId}, debitor ${A.personalAccount}, Erlöskonto ${draftA?.account}, ${draftA?.vatKey}`);
}

const B1 = await settled(invoiceB1);
const B2 = await settled(invoiceB2);
check("B's two partial invoices are both ready", B1.state === "ready_to_export" && B2.state === "ready_to_export", [B1.state, B1.detail, B2.state, B2.detail]);
check("B's partial invoices share one guest contact", Boolean(B1.contactId) && B1.contactId === B2.contactId, [B1.contactId, B2.contactId]);
check("B's guest contact is a CPD debitor in the guest group", Boolean(B1.personalAccount), B1.personalAccount);

const F = await settled(invoiceF);
// The test tenant's Steuermatrix has no Erlöskonto for an AT destination
// (docs/STATUS.md). Either outcome is legitimate for a real tenant; what must
// never happen is a guess.
check("F (Austria) was classified as EU and either resolved or held — never guessed",
  F.countryUsed === "AT" && (F.state === "ready_to_export" || (F.state === "held" && F.reason === "no_revenue_account")), F);
console.log(`    F: ${F.state}${F.reason ? ` / ${F.reason}` : ""}`);

// Read every debitor back. Live, Scopevisio once answered /createdebitor with
// a number it never persisted, so a number on the record proves nothing.
for (const [label, rec] of [["A", A], ["B", B1]] as const) {
  const accounts = rec.contactId
    ? await ctx.client.search<{ records?: Array<{ number?: string }> }>("/debitoraccounts", {
        search: [{ field: "contactId", value: String(rec.contactId), operator: "equal" }], pageSize: 5, formatValues: false,
      })
    : { records: [] };
  check(`${label}'s debitor ${rec.personalAccount} really exists in Scopevisio for contact ${rec.contactId}`,
    Boolean(rec.personalAccount) && (accounts.records ?? []).some((a) => String(a.number) === rec.personalAccount), accounts.records);
}

const C = await settled(invoiceC);
check("C (Switzerland) is held rather than guessed", C.state === "held", C);
console.log(`    C: ${C.reason} — ${C.detail}`);

const D = await settled(invoiceD);
const refundD = await waitFor("refund D", () => prisma.refundRecord.findUnique({ where: { storeId_externalId: { storeId: store.id, externalId: `creditmemo:${memoD}` } } }));
// Both, not either: live, the refund said "withdrawn" while a concurrent sync
// overwrote the record with ready_to_export and the invoice was exported.
const D2 = await record(invoiceD);
check("D's full refund withdrew the undelivered invoice, and it stayed withdrawn",
  refundD.outcome === "withdrawn" && D2?.state === "declined" && D2.reason === "refunded_before_export",
  { refund: refundD.outcome, state: D2?.state, reason: D2?.reason, first: D.state });

const E = await settled(invoiceE);
check("E's rejected VAT ID holds the invoice instead of applying reverse charge", E.state === "held" && E.reason === "vat_id_unvalidated", E);

section("Idempotency and signature checks against the running connector");
{
  const eventsBefore = await prisma.syncEvent.count({ where: { storeId: store.id, event: "invoice.duplicate_ignored" } });
  const body = JSON.stringify({ event: "invoice.paid", entityId: invoiceA, orderId: orderA, outboxId: 0, storeBaseUrl: store.storeBaseUrl, createdAt: "" });
  const post = (ts: string, signature: string, raw = body) =>
    fetch(`${CONNECTOR}/magento/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-scopevisio-consumer-key": store.consumerKey, "x-scopevisio-timestamp": ts, "x-scopevisio-signature": signature },
      body: raw,
    });
  const now = String(Math.floor(Date.now() / 1000));

  const replay = await post(now, signWebhook(consumerSecret, now, body));
  check("a redelivered, correctly signed webhook is accepted", replay.status === 202, replay.status);
  await waitFor("duplicate to be journalled", async () =>
    (await prisma.syncEvent.count({ where: { storeId: store.id, event: "invoice.duplicate_ignored" } })) > eventsBefore);
  const again = await record(invoiceA);
  check("…and changes nothing: same state, same contact", again?.state === A.state && again?.contactId === A.contactId, again);

  const tampered = await post(now, signWebhook(consumerSecret, now, body), body.replace(String(invoiceA), String(invoiceC)));
  check("a tampered body is refused", tampered.status === 401, tampered.status);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const stale = await post(old, signWebhook(consumerSecret, old, body));
  check("an hour-old delivery is refused", stale.status === 401, stale.status);
}

section("Polling path finds the same invoices and duplicates nothing");
{
  const before = await prisma.syncRecord.count({ where: { storeId: store.id } });
  const overview = await connector("GET", "/magento/app");
  const poll = await connector("POST", "/magento/app/poll", { csrf: csrfOf(overview.text) });
  const after = await prisma.syncRecord.count({ where: { storeId: store.id } });
  check("poll ran", poll.status === 303 && (poll.location ?? "").includes("ok="), decodeURIComponent(poll.location ?? ""));
  console.log(`    ${decodeURIComponent((poll.location ?? "").split("ok=")[1] ?? "")}`);
  check("no invoice was recorded twice", before === after, { before, after });
}

section("CSV delivery lifecycle");
let batchId = "";
{
  const exportPage = await connector("GET", "/magento/app/export");
  // Raw bytes: fetch's text() silently strips a UTF-8 BOM, which is exactly
  // the thing being checked.
  const downloadRes = await fetch(`${CONNECTOR}/magento/app/export/download`, {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: csrfOf(exportPage.text) }).toString(),
  });
  const bytes = Buffer.from(await downloadRes.arrayBuffer());
  const csv = bytes.toString("utf8");
  batchId = (await record(invoiceA))?.exportBatch ?? "";
  check("CSV downloaded with a BOM and Scopevisio column names",
    downloadRes.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && csv.includes("customerContactId;customerPersonalAccountNumber"),
    { status: downloadRes.status, head: bytes.subarray(0, 3).toString("hex") });
  const refA = (await record(invoiceA))?.externalRef;
  check("A and both B invoices are in it; held C and E and withdrawn D are not",
    csv.includes(`Magento ${refA}`) && csv.includes(`invoice:${invoiceB1};`) && csv.includes(`invoice:${invoiceB2};`) &&
      !csv.includes(`invoice:${invoiceC};`) && !csv.includes(`invoice:${invoiceD};`) && !csv.includes(`invoice:${invoiceE};`),
    csv.split("\r\n").slice(0, 8));
  check("exported invoices are marked so a second download cannot repeat them", (await record(invoiceA))?.state === "exported" && Boolean(batchId));
  fs.writeFileSync(path.resolve(import.meta.dirname, `../e2e-${STAMP}.csv`), csv);

  const second = await connector("POST", "/magento/app/export/download", { csrf: csrfOf(exportPage.text) });
  check("a second download right after is empty", !second.text.includes(`invoice:${invoiceA}`));

  const confirm = await connector("POST", "/magento/app/export/confirm", { csrf: csrfOf(exportPage.text), id: batchId });
  check("confirming the import books the batch", confirm.status === 303 && (await record(invoiceA))?.state === "booked", (await record(invoiceA))?.state);
}

section("Refund after booking");
{
  const memoA = await refund(orderA);
  deliverOutbox();
  const refundA = await waitFor("refund A", () => prisma.refundRecord.findUnique({ where: { storeId_externalId: { storeId: store.id, externalId: `creditmemo:${memoA}` } } }));
  const afterRefund = await record(invoiceA);
  check("a refund of a booked invoice flags a required Gutschrift and leaves the booking alone",
    refundA.outcome === "credit_note_required" && afterRefund?.state === "booked" && afterRefund.reason === "credit_note_required", { refundA, afterRefund });
}

if (process.env.CAPTURE_FIXTURES === "1") {
  const client = await MagentoClient.forStore(store.id);
  const dir = path.resolve(import.meta.dirname, "../src/__fixtures__");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "invoice-configurable.json"), JSON.stringify(await client.getInvoice(invoiceA), null, 2));
  fs.writeFileSync(path.join(dir, "order-configurable.json"), JSON.stringify(await client.getOrder(orderA), null, 2));
  fs.writeFileSync(path.join(dir, "invoice-partial.json"), JSON.stringify(await client.getInvoice(invoiceB1), null, 2));
  fs.writeFileSync(path.join(dir, "order-partial-guest.json"), JSON.stringify(await client.getOrder(orderB), null, 2));
  console.log(`\nFixtures written to ${dir}`);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}  Test data is tagged ${STAMP}.`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
