import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generateShopSecret,
  hmac,
  rawQueryString,
  registrationProof,
  safeEqual,
  verify,
} from "./signature";

describe("hmac", () => {
  it("matches a SHA-256 HMAC computed independently", () => {
    const expected = crypto
      .createHmac("sha256", "s3cret")
      .update("hello", "utf8")
      .digest("hex");
    expect(hmac("hello", "s3cret")).toBe(expected);
  });

  it("changes completely when the secret changes", () => {
    expect(hmac("hello", "a")).not.toBe(hmac("hello", "b"));
  });
});

describe("safeEqual", () => {
  it("is true for identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("is false for different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("verify", () => {
  const secret = "shop-secret";

  it("accepts a correct signature", () => {
    expect(verify("body", hmac("body", secret), secret)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verify("body", hmac("body", "other"), secret)).toBe(false);
  });

  it("rejects a missing signature instead of trusting the request", () => {
    expect(verify("body", undefined, secret)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verify("body", "", secret)).toBe(false);
  });

  it("rejects when the body was tampered with", () => {
    const sig = hmac('{"amount":1}', secret);
    expect(verify('{"amount":9999}', sig, secret)).toBe(false);
  });
});

describe("registrationProof", () => {
  const args = {
    shopId: "abc123",
    shopUrl: "https://shop.example.com",
    appName: "ScopevisioConnector",
    appSecret: "app-secret",
  };

  it("hashes shopId + shopUrl + appName with no separator", () => {
    expect(registrationProof(args)).toBe(
      hmac("abc123https://shop.example.comScopevisioConnector", "app-secret"),
    );
  });

  it("differs when any component differs", () => {
    const base = registrationProof(args);
    expect(registrationProof({ ...args, shopId: "other" })).not.toBe(base);
    expect(registrationProof({ ...args, shopUrl: "https://other" })).not.toBe(base);
    expect(registrationProof({ ...args, appName: "Other" })).not.toBe(base);
  });
});

describe("generateShopSecret", () => {
  it("is inside Shopware's 64-255 character range", () => {
    const s = generateShopSecret();
    expect(s.length).toBeGreaterThanOrEqual(64);
    expect(s.length).toBeLessThanOrEqual(255);
  });

  it("is not reused between calls", () => {
    expect(generateShopSecret()).not.toBe(generateShopSecret());
  });
});

describe("rawQueryString", () => {
  it("returns the query exactly as sent, without reordering", () => {
    expect(rawQueryString("/app/register?shop-id=A&shop-url=https%3A%2F%2Fx&timestamp=1")).toBe(
      "shop-id=A&shop-url=https%3A%2F%2Fx&timestamp=1",
    );
  });

  it("is empty when there is no query", () => {
    expect(rawQueryString("/app/register")).toBe("");
  });

  it("keeps encoded characters untouched, because the HMAC covers them", () => {
    const q = rawQueryString("/x?a=%2F%2F&b=%20");
    expect(q).toBe("a=%2F%2F&b=%20");
  });
});
