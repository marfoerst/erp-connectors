import crypto from "node:crypto";

/**
 * OAuth 1.0a request signing (RFC 5849), as Magento's integrations require.
 *
 * Magento Open Source hands an external application API access only through
 * an Integration, and an integration's tokens are OAuth 1.0a: since 2.4.4 they
 * are no longer accepted as plain bearer tokens unless the merchant flips a
 * store-wide setting that weakens every integration. So each request is signed
 * rather than asking the merchant to lower that guard.
 *
 * Pure — no network. The one thing that makes signatures fail in practice is
 * the base string, so that is exported and tested on its own.
 */

export type SignatureMethod = "HMAC-SHA1" | "HMAC-SHA256";

/** RFC 3986 encoding. encodeURIComponent leaves !'()* alone; OAuth does not. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The signature base string: METHOD & base-URL & sorted parameters.
 *
 * Query parameters of the URL are part of the signed set, and the base URL
 * drops the query, the fragment and a default port.
 */
export function signatureBaseString(
  method: string,
  url: string,
  params: Array<[string, string]>,
): string {
  const u = new URL(url);
  const baseUrl = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;

  const all: Array<[string, string]> = [...params];
  u.searchParams.forEach((value, key) => all.push([key, value]));

  const normalised = all
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalised)].join("&");
}

export interface SignArgs {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string | null;
  tokenSecret?: string | null;
  /** Extra oauth_* parameters, e.g. oauth_verifier for the access-token call. */
  oauthExtra?: Record<string, string>;
  /** Form-encoded body parameters, which are signed too. JSON bodies are not. */
  bodyParams?: Array<[string, string]>;
  signatureMethod?: SignatureMethod;
  /** Fixed in tests; random otherwise. */
  nonce?: string;
  timestamp?: number;
}

/** Returns the complete `Authorization` header value. */
export function authorizationHeader(args: SignArgs): string {
  const signatureMethod = args.signatureMethod ?? "HMAC-SHA256";
  const oauth: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: args.nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: signatureMethod,
    oauth_timestamp: String(args.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(args.token ? { oauth_token: args.token } : {}),
    ...(args.oauthExtra ?? {}),
  };

  const base = signatureBaseString(args.method, args.url, [
    ...Object.entries(oauth),
    ...(args.bodyParams ?? []),
  ]);
  const key = `${percentEncode(args.consumerSecret)}&${percentEncode(args.tokenSecret ?? "")}`;
  const algorithm = signatureMethod === "HMAC-SHA1" ? "sha1" : "sha256";
  const signature = crypto.createHmac(algorithm, key).update(base).digest("base64");

  const header = Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

/** Magento answers the token endpoints form-encoded: oauth_token=…&oauth_token_secret=… */
export function parseTokenResponse(body: string): { token: string; secret: string } | null {
  const params = new URLSearchParams(body.trim());
  const token = params.get("oauth_token");
  const secret = params.get("oauth_token_secret");
  return token && secret ? { token, secret } : null;
}
