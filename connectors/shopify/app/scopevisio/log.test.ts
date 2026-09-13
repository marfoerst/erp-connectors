import { describe, expect, it } from "vitest";

import { scrubValue } from "./log.server";

/**
 * The journal is written on every sync and read by bookkeepers, so a leaked
 * credential there is a real exposure. Key-based redaction is exercised through
 * scrubValue's sibling path in log.server; these cover the value-level scrub,
 * which is the part that was leaking.
 */
describe("scrubValue", () => {
  it("redacts an access token in a URL", () => {
    const out = scrubValue("https://appload.scopevisio.com/rest/x?access_token=aeaa5226-e7c9f726");
    expect(out).not.toContain("aeaa5226");
    expect(out).toContain("access_token=[redacted]");
  });

  it("redacts a refresh token and keeps the rest of the URL", () => {
    const out = scrubValue("https://h/rest/token?refresh_token=rt-abc123&customer=2039915");
    expect(out).not.toContain("rt-abc123");
    // The non-secret parameter is diagnostically useful and must survive.
    expect(out).toContain("customer=2039915");
  });

  it("redacts a password query parameter", () => {
    expect(scrubValue("?password=correct-horse-battery-staple")).not.toContain("correct-horse-battery-staple");
  });

  it("redacts a Bearer credential", () => {
    const out = scrubValue("authorization: Bearer aeaa5226-e7c9f726-3ea4-4339");
    expect(out).not.toContain("aeaa5226");
    expect(out).toContain("Bearer [redacted]");
  });

  it("redacts Basic credentials", () => {
    expect(scrubValue("Basic dXNlcjpwYXNzd29yZA==")).toContain("Basic [redacted]");
  });

  it("handles several secrets in one string", () => {
    const out = scrubValue("?access_token=aaa1111111 and Bearer bbb2222222");
    expect(out).not.toContain("aaa1111111");
    expect(out).not.toContain("bbb2222222");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Order #1042 booked as invoice RE-2026-1 on account 8400";
    expect(scrubValue(text)).toBe(text);
  });

  it("does not mangle a Shopify GID", () => {
    const gid = "gid://shopify/Order/5678901234";
    expect(scrubValue(gid)).toBe(gid);
  });

  it("does not redact a short word after Bearer", () => {
    // Avoid false positives destroying readable messages.
    expect(scrubValue("Bearer token missing")).toBe("Bearer token missing");
  });

  it("is a no-op on an empty string", () => {
    expect(scrubValue("")).toBe("");
  });
});
