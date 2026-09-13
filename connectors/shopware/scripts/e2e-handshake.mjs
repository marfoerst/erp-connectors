/**
 * Drives the full Shopware app handshake against a locally running connector,
 * exactly as Shopware would — including the cases that must FAIL.
 *
 * Shopware itself cannot easily be made to produce a bad signature, a tampered
 * body or a hostile re-registration, so those paths would otherwise go
 * untested until someone attacked them.
 *
 * Usage:
 *   npm run dev            # in one terminal
 *   npm run e2e:handshake  # in another
 *
 * Reads SHOPWARE_APP_SECRET from the environment so it stays in step with the
 * running server rather than hardcoding a value that quietly drifts.
 */
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:3100";
const APP_SECRET = process.env.SHOPWARE_APP_SECRET ?? "dev-app-secret-change-me";
const APP_NAME = "ScopevisioConnector";
// A fresh id per run, so the script is repeatable without resetting the database.
const SHOP_ID = `e2e-shop-${Date.now()}`;
const SHOP_URL = "https://shop.example.test";

const hmac = (p, s) => crypto.createHmac("sha256", s).update(p, "utf8").digest("hex");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};

// --- 1. registration, unsigned → must be rejected ---------------------------
const q = `shop-id=${SHOP_ID}&shop-url=${encodeURIComponent(SHOP_URL)}&timestamp=${Date.now()}`;
let r = await fetch(`${BASE}/app/register?${q}`);
check("unsigned registration is rejected", r.status === 401, `HTTP ${r.status}`);

// --- 2. registration with a WRONG app secret → rejected ---------------------
r = await fetch(`${BASE}/app/register?${q}`, {
  headers: { "shopware-app-signature": hmac(q, "wrong-secret") },
});
check("registration signed with the wrong secret is rejected", r.status === 401, `HTTP ${r.status}`);

// --- 3. correct registration -------------------------------------------------
r = await fetch(`${BASE}/app/register?${q}`, {
  headers: { "shopware-app-signature": hmac(q, APP_SECRET) },
});
const reg = await r.json();
check("registration succeeds", r.status === 200, `HTTP ${r.status}`);
check(
  "proof is HMAC(shopId + shopUrl + appName) with the app secret",
  reg.proof === hmac(SHOP_ID + SHOP_URL + APP_NAME, APP_SECRET),
);
check("shop secret is within Shopware's 64-255 range", reg.secret?.length >= 64 && reg.secret?.length <= 255, `len ${reg.secret?.length}`);
check("confirmation_url is absolute", /^https?:\/\//.test(reg.confirmation_url ?? ""), reg.confirmation_url);

const SHOP_SECRET = reg.secret;

// --- 4. confirmation with a bad signature → rejected ------------------------
const confirmBody = JSON.stringify({
  apiKey: "SWIAxxxxAPIKEY", secretKey: "SWSCxxxxSECRET",
  shopId: SHOP_ID, shopUrl: SHOP_URL, timestamp: String(Date.now()),
});
r = await fetch(`${BASE}/app/register/confirm`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(confirmBody, "nope") },
  body: confirmBody,
});
check("confirmation with a bad signature is rejected", r.status === 401, `HTTP ${r.status}`);

// --- 5. correct confirmation -------------------------------------------------
r = await fetch(`${BASE}/app/register/confirm`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(confirmBody, SHOP_SECRET) },
  body: confirmBody,
});
check("confirmation succeeds and credentials are stored", r.status === 200, `HTTP ${r.status}`);

// --- 6. tampered body must fail even with a valid-looking signature ----------
const tampered = confirmBody.replace("SWIAxxxxAPIKEY", "ATTACKERKEY!!!");
r = await fetch(`${BASE}/app/register/confirm`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(confirmBody, SHOP_SECRET) },
  body: tampered,
});
check("a tampered confirmation body is rejected", r.status === 401, `HTTP ${r.status}`);

// --- 7. webhook, unsigned → rejected ----------------------------------------
const hook = JSON.stringify({
  source: { url: SHOP_URL, appVersion: "0.1.0", shopId: SHOP_ID, eventId: "evt-1" },
  data: { event: "state_enter.order_transaction.state.paid", payload: [{ id: "tx-1" }] },
  timestamp: Date.now(),
});
r = await fetch(`${BASE}/webhook/order-paid`, { method: "POST", headers: { "content-type": "application/json" }, body: hook });
check("unsigned webhook is rejected", r.status === 401, `HTTP ${r.status}`);

// --- 8. webhook for an unknown shop → 404 -----------------------------------
const otherHook = hook.replace(SHOP_ID, "not-installed");
r = await fetch(`${BASE}/webhook/order-paid`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(otherHook, SHOP_SECRET) },
  body: otherHook,
});
check("webhook from an unknown shop is rejected", r.status === 404, `HTTP ${r.status}`);

// --- 9. correctly signed webhook is accepted --------------------------------
r = await fetch(`${BASE}/webhook/order-paid`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(hook, SHOP_SECRET) },
  body: hook,
});
check("correctly signed webhook is accepted", r.status === 200, `HTTP ${r.status}`);

// --- 10. re-registration without the old shop secret → rejected -------------
const q2 = `shop-id=${SHOP_ID}&shop-url=${encodeURIComponent(SHOP_URL)}&timestamp=${Date.now()}`;
r = await fetch(`${BASE}/app/register?${q2}`, {
  headers: { "shopware-app-signature": hmac(q2, APP_SECRET) },
});
check("re-registration without proving the old shop secret is rejected", r.status === 401,
  `HTTP ${r.status} — this is the CVE-2026-31889 class of hole`);

// --- 11. re-registration WITH the old shop secret succeeds -------------------
r = await fetch(`${BASE}/app/register?${q2}`, {
  headers: {
    "shopware-app-signature": hmac(q2, APP_SECRET),
    "shopware-shop-signature": hmac(q2, SHOP_SECRET),
  },
});
const reg2 = await r.json();
check("re-registration with the old shop secret succeeds", r.status === 200, `HTTP ${r.status}`);
check("re-registration issues a NEW shop secret", reg2.secret && reg2.secret !== SHOP_SECRET);

// --- 12. app.deleted deactivates the shop -----------------------------------
const delHook = JSON.stringify({
  source: { shopId: SHOP_ID }, data: { event: "app.deleted" },
});
r = await fetch(`${BASE}/webhook/app-deleted`, {
  method: "POST",
  headers: { "content-type": "application/json", "shopware-shop-signature": hmac(delHook, reg2.secret) },
  body: delHook,
});
check("app.deleted is accepted and deactivates the shop", r.status === 200, `HTTP ${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
