import { describe, expect, it } from "vitest";

import { scrub, scrubValue } from "./store";

describe("scrubValue", () => {
  it("redacts an access token embedded in a URL", () => {
    expect(scrubValue("https://x/rest/token?access_token=abc123&customer=1")).toBe(
      "https://x/rest/token?access_token=***&customer=1",
    );
  });

  it("redacts a bearer token inside an error body", () => {
    expect(scrubValue('failed with Authorization: Bearer eyJhbGci.abc-123')).toContain(
      "Bearer ***",
    );
  });

  it("redacts a refresh token and a password in a query string", () => {
    const out = scrubValue("refresh_token=zzz&password=hunter2");
    expect(out).not.toContain("zzz");
    expect(out).not.toContain("hunter2");
  });

  it("leaves ordinary text untouched", () => {
    expect(scrubValue("order 10024 booked")).toBe("order 10024 booked");
  });
});

describe("scrub", () => {
  it("redacts by key name", () => {
    expect(scrub({ password: "hunter2", city: "Bonn" })).toEqual({
      password: "***",
      city: "Bonn",
    });
  });

  it("redacts inside nested values, not just at the top level", () => {
    const out = scrub({ req: { url: "https://x?access_token=abc" } }) as Record<
      string,
      Record<string, string>
    >;
    expect(out.req.url).toBe("https://x?access_token=***");
  });

  it("redacts inside arrays", () => {
    const out = scrub(["Bearer abc.def"]) as string[];
    expect(out[0]).toBe("Bearer ***");
  });

  it("stops recursing on deeply nested structures rather than hanging", () => {
    let deep: unknown = "end";
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(() => scrub(deep)).not.toThrow();
  });

  it("passes through numbers and booleans unchanged", () => {
    expect(scrub({ n: 42, b: true, z: null })).toEqual({ n: 42, b: true, z: null });
  });
});
