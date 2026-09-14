import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createSession,
  csrfToken,
  readSession,
  signAdminLink,
  signWebhook,
  verifyAdminLink,
  verifyCsrf,
  verifyWebhook,
} from "./signature";

const SECRET = "consumer-secret";
const now = Date.UTC(2026, 8, 14, 12, 0, 0);
const ts = String(Math.floor(now / 1000));
const body = '{"event":"invoice.paid","invoiceId":7}';

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh delivery", () => {
    const signature = signWebhook(SECRET, ts, body);
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: ts, signature, rawBody: body, now })).toEqual({ ok: true });
  });

  it("matches what PHP's hash_hmac('sha256', ts.'.'.body, secret) produces", () => {
    // The Magento module signs with hash_hmac; this is the same construction.
    const php = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    expect(signWebhook(SECRET, ts, body)).toBe(php);
  });

  it("rejects a tampered body", () => {
    const signature = signWebhook(SECRET, ts, body);
    const r = verifyWebhook({ consumerSecret: SECRET, timestamp: ts, signature, rawBody: body.replace("7", "8"), now });
    expect(r).toEqual({ ok: false, reason: "bad signature" });
  });

  it("rejects a replay with a new timestamp but the old signature", () => {
    const signature = signWebhook(SECRET, ts, body);
    const later = String(Number(ts) + 60);
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: later, signature, rawBody: body, now }).ok).toBe(false);
  });

  it("rejects a delivery older than five minutes", () => {
    const old = String(Number(ts) - 301);
    const signature = signWebhook(SECRET, old, body);
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: old, signature, rawBody: body, now })).toEqual({ ok: false, reason: "stale timestamp" });
  });

  it("rejects a signature made with another store's secret", () => {
    const signature = signWebhook("other", ts, body);
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: ts, signature, rawBody: body, now }).ok).toBe(false);
  });

  it("rejects missing headers and non-hex garbage without throwing", () => {
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: undefined, signature: "x", rawBody: body, now }).ok).toBe(false);
    expect(verifyWebhook({ consumerSecret: SECRET, timestamp: ts, signature: "zz", rawBody: body, now }).ok).toBe(false);
  });
});

describe("verifyAdminLink", () => {
  it("accepts the link Magento signed for this admin", () => {
    const signature = signAdminLink(SECRET, "ck", ts, "admin");
    expect(verifyAdminLink({ consumerSecret: SECRET, consumerKey: "ck", timestamp: ts, user: "admin", signature, now })).toBe(true);
  });

  it("rejects the same link with the user swapped", () => {
    const signature = signAdminLink(SECRET, "ck", ts, "admin");
    expect(verifyAdminLink({ consumerSecret: SECRET, consumerKey: "ck", timestamp: ts, user: "mallory", signature, now })).toBe(false);
  });

  it("rejects an expired link", () => {
    const old = String(Number(ts) - 3600);
    const signature = signAdminLink(SECRET, "ck", old, "admin");
    expect(verifyAdminLink({ consumerSecret: SECRET, consumerKey: "ck", timestamp: old, user: "admin", signature, now })).toBe(false);
  });
});

describe("sessions", () => {
  const key = crypto.randomBytes(32);

  it("round-trips the store and a user name with dots in it", () => {
    const token = createSession(key, "store1", "martin.foerster");
    expect(readSession(key, token)).toEqual({ storeId: "store1", user: "martin.foerster" });
  });

  it("rejects a token signed with another key, or edited", () => {
    const token = createSession(key, "store1", "admin");
    expect(readSession(crypto.randomBytes(32), token)).toBeNull();
    expect(readSession(key, token.replace("store1", "store2"))).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = createSession(key, "store1", "admin", 10);
    expect(readSession(key, token, Date.now() + 11_000)).toBeNull();
  });

  it("binds the CSRF token to the session", () => {
    const a = createSession(key, "store1", "admin");
    const b = createSession(key, "store1", "other");
    expect(verifyCsrf(key, a, csrfToken(key, a))).toBe(true);
    expect(verifyCsrf(key, b, csrfToken(key, a))).toBe(false);
    expect(verifyCsrf(key, a, undefined)).toBe(false);
  });
});
