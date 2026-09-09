import crypto from "node:crypto";

/**
 * Credential encryption at rest.
 *
 * The merchant entrusts their Scopevisio credentials to this app through the
 * embedded UI, so they must never sit in the database in the clear. The key
 * comes from the environment and is the one piece of configuration that is
 * deliberately NOT settable from the Shopify UI — a tenant must not be able to
 * choose the key that protects their own secrets.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const raw = process.env.SCOPEVISIO_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SCOPEVISIO_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -base64 32` and add it to your environment.",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `SCOPEVISIO_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  // Exactly three parts, and only the IV and tag may not be empty — an empty
  // DATA segment is legitimate: it is what encrypting an empty string yields.
  // Treating it as malformed broke the round-trip for empty values.
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext");
  }
  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64) {
    throw new Error("Malformed ciphertext");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt without throwing — a rotated key should degrade to "reconnect", not a 500. */
export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

export function encryptionKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
