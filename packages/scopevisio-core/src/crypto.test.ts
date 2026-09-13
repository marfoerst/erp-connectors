import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * Credential encryption guards the merchant's Scopevisio password and refresh
 * token, so it gets tested for the properties that matter: round-trip
 * fidelity, non-determinism, tamper detection, and refusing a bad key rather
 * than silently degrading.
 *
 * The module reads the key at call time, so the env var is set before import.
 */
beforeAll(() => {
  process.env.SCOPEVISIO_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

const load = async () => import("./crypto");

describe("encrypt / decrypt", () => {
  it("round-trips a value", async () => {
    const { encrypt, decrypt } = await load();
    expect(decrypt(encrypt("test-secret-value"))).toBe("test-secret-value");
  });

  it("round-trips umlauts and emoji", async () => {
    const { encrypt, decrypt } = await load();
    const value = "Passwort-mit-Ümläuten-und-📊";
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it("round-trips an empty string", async () => {
    const { encrypt, decrypt } = await load();
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encrypt } = await load();
    // Identical passwords across shops must not produce identical ciphertext.
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("never leaks the plaintext into the ciphertext", async () => {
    const { encrypt } = await load();
    expect(encrypt("correct-horse-battery-staple")).not.toContain("test-secret");
  });

  it("detects a tampered payload rather than returning garbage", async () => {
    const { encrypt, decrypt } = await load();
    const [iv, tag, data] = encrypt("secret").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decrypt([iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("detects a swapped auth tag", async () => {
    const { encrypt, decrypt } = await load();
    const [iv, , data] = encrypt("secret").split(":");
    const [, otherTag] = encrypt("other").split(":");
    expect(() => decrypt([iv, otherTag, data].join(":"))).toThrow();
  });

  it("rejects malformed ciphertext", async () => {
    const { decrypt } = await load();
    for (const bad of ["", "nope", "a:b", "only-one-part"]) {
      expect(() => decrypt(bad)).toThrow();
    }
  });
});

describe("tryDecrypt", () => {
  it("returns the value when it can", async () => {
    const { encrypt, tryDecrypt } = await load();
    expect(tryDecrypt(encrypt("v"))).toBe("v");
  });

  it("returns null instead of throwing on junk", async () => {
    // A rotated key must degrade to "reconnect", never to a 500.
    const { tryDecrypt } = await load();
    expect(tryDecrypt("garbage")).toBeNull();
    expect(tryDecrypt(null)).toBeNull();
    expect(tryDecrypt(undefined)).toBeNull();
    expect(tryDecrypt("")).toBeNull();
  });

  it("returns null for a value encrypted under a different key", async () => {
    const { encrypt } = await load();
    const ciphertext = encrypt("secret");

    const original = process.env.SCOPEVISIO_ENCRYPTION_KEY;
    process.env.SCOPEVISIO_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const { tryDecrypt } = await load();
    expect(tryDecrypt(ciphertext)).toBeNull();
    process.env.SCOPEVISIO_ENCRYPTION_KEY = original;
  });
});

describe("key validation", () => {
  it("reports a missing key rather than encrypting with a default", async () => {
    const { encrypt, encryptionKeyConfigured } = await load();
    const original = process.env.SCOPEVISIO_ENCRYPTION_KEY;
    delete process.env.SCOPEVISIO_ENCRYPTION_KEY;
    expect(encryptionKeyConfigured()).toBe(false);
    expect(() => encrypt("x")).toThrow(/SCOPEVISIO_ENCRYPTION_KEY/);
    process.env.SCOPEVISIO_ENCRYPTION_KEY = original;
  });

  it("rejects a key that is not 32 bytes", async () => {
    const { encrypt, encryptionKeyConfigured } = await load();
    const original = process.env.SCOPEVISIO_ENCRYPTION_KEY;
    process.env.SCOPEVISIO_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(encryptionKeyConfigured()).toBe(false);
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.SCOPEVISIO_ENCRYPTION_KEY = original;
  });

  it("accepts a valid key", async () => {
    const { encryptionKeyConfigured } = await load();
    expect(encryptionKeyConfigured()).toBe(true);
  });
});
