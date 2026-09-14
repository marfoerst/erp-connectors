import crypto from "node:crypto";

/**
 * Everything that proves a request came from a store's own Magento.
 *
 * One secret does all of it: the OAuth consumer secret Magento generated for
 * the integration, handed to us during activation. Nobody has to invent,
 * paste or rotate a second shared secret — deactivating the integration in
 * Magento revokes it along with the API access.
 */

/** Webhooks and admin links older than this are refused. */
export const MAX_SKEW_SECONDS = 300;

function hmacHex(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function fresh(timestamp: string, now: number): boolean {
  if (!/^\d{9,11}$/.test(timestamp)) return false;
  return Math.abs(now / 1000 - Number(timestamp)) <= MAX_SKEW_SECONDS;
}

/**
 * `X-Scopevisio-Signature: hex(HMAC-SHA256(consumerSecret, timestamp + "." + body))`
 *
 * The timestamp is inside the MAC so a captured delivery cannot be replayed
 * later with a new one. Redelivery by the outbox re-signs with a fresh time.
 */
export function signWebhook(consumerSecret: string, timestamp: string, rawBody: string): string {
  return hmacHex(consumerSecret, `${timestamp}.${rawBody}`);
}

export function verifyWebhook(args: {
  consumerSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { timestamp, signature } = args;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!fresh(timestamp, args.now ?? Date.now())) return { ok: false, reason: "stale timestamp" };
  const expected = signWebhook(args.consumerSecret, timestamp, args.rawBody);
  return safeEqualHex(signature, expected) ? { ok: true } : { ok: false, reason: "bad signature" };
}

/**
 * The admin link Magento renders for a logged-in admin:
 * `hex(HMAC-SHA256(consumerSecret, "admin|" + key + "|" + ts + "|" + user))`.
 */
export function signAdminLink(consumerSecret: string, consumerKey: string, ts: string, user: string) {
  return hmacHex(consumerSecret, `admin|${consumerKey}|${ts}|${user}`);
}

export function verifyAdminLink(args: {
  consumerSecret: string;
  consumerKey: string;
  timestamp: string | null;
  user: string | null;
  signature: string | null;
  now?: number;
}): boolean {
  const { timestamp, user, signature } = args;
  if (!timestamp || !user || !signature) return false;
  if (!fresh(timestamp, args.now ?? Date.now())) return false;
  return safeEqualHex(
    signature,
    signAdminLink(args.consumerSecret, args.consumerKey, timestamp, user),
  );
}

/**
 * The session cookie after a verified admin link: `storeId.user.expiry.mac`.
 * Stateless, so the connector keeps no session table.
 */
export function createSession(key: Buffer, storeId: string, user: string, ttlSeconds = 8 * 3600) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = [storeId, Buffer.from(user).toString("base64url"), String(expires)].join(".");
  const mac = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readSession(
  key: Buffer,
  token: string | undefined,
  now = Date.now(),
): { storeId: string; user: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [storeId, userB64, expires, mac] = parts;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${storeId}.${userB64}.${expires}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expires) * 1000 < now) return null;
  return { storeId, user: Buffer.from(userB64, "base64url").toString("utf8") };
}

/** CSRF token for the connector's own forms, bound to the session. */
export function csrfToken(key: Buffer, session: string): string {
  return crypto.createHmac("sha256", key).update(`csrf|${session}`).digest("base64url");
}

export function verifyCsrf(key: Buffer, session: string, token: string | null | undefined) {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(csrfToken(key, session));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
