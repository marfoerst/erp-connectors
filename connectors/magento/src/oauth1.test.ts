import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authorizationHeader,
  parseTokenResponse,
  percentEncode,
  signatureBaseString,
} from "./oauth1";

/**
 * The worked example from Twitter's "Creating a signature" guide — an
 * independent, published vector, so the test is not written from the same
 * reading of the RFC as the implementation.
 */
const TWITTER = {
  method: "POST",
  url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: 1318622958,
  body: [["status", "Hello Ladies + Gentlemen, a signed OAuth request!"]] as Array<[string, string]>,
};

function signatureOf(header: string): string {
  const m = header.match(/oauth_signature="([^"]+)"/);
  return decodeURIComponent(m?.[1] ?? "");
}

describe("percentEncode", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("a!b*c'(d)")).toBe("a%21b%2Ac%27%28d%29");
    expect(percentEncode("Ladies + Gentlemen")).toBe("Ladies%20%2B%20Gentlemen");
  });
});

describe("authorizationHeader", () => {
  it("reproduces the published HMAC-SHA1 signature", () => {
    const header = authorizationHeader({
      ...TWITTER,
      bodyParams: TWITTER.body,
      signatureMethod: "HMAC-SHA1",
    });
    expect(signatureOf(header)).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("signs HMAC-SHA256 over the same base string", () => {
    const header = authorizationHeader({ ...TWITTER, bodyParams: TWITTER.body });
    const base = signatureBaseString(TWITTER.method, TWITTER.url, [
      ["oauth_consumer_key", TWITTER.consumerKey],
      ["oauth_nonce", TWITTER.nonce],
      ["oauth_signature_method", "HMAC-SHA256"],
      ["oauth_timestamp", String(TWITTER.timestamp)],
      ["oauth_version", "1.0"],
      ["oauth_token", TWITTER.token],
      ...TWITTER.body,
    ]);
    const expected = crypto
      .createHmac("sha256", `${TWITTER.consumerSecret}&${TWITTER.tokenSecret}`)
      .update(base)
      .digest("base64");
    expect(signatureOf(header)).toBe(expected);
  });

  it("includes URL query parameters and drops a default port from the base URL", () => {
    const base = signatureBaseString("get", "http://Shop.example:80/rest/V1/invoices?a=2&b=1", [
      ["oauth_nonce", "n"],
    ]);
    expect(base.startsWith("GET&http%3A%2F%2Fshop.example%2Frest%2FV1%2Finvoices&")).toBe(true);
    expect(base).toContain("a%3D2%26b%3D1%26oauth_nonce%3Dn");
  });

  it("keeps a non-default port", () => {
    const base = signatureBaseString("GET", "http://localhost:8080/rest/V1/orders/1", []);
    expect(base).toBe("GET&http%3A%2F%2Flocalhost%3A8080%2Frest%2FV1%2Forders%2F1&");
  });

  it("uses an empty token secret before a token exists", () => {
    const a = authorizationHeader({
      method: "POST",
      url: "http://localhost:8080/oauth/token/request",
      consumerKey: "ck",
      consumerSecret: "cs",
      nonce: "n",
      timestamp: 1,
    });
    expect(a).not.toContain("oauth_token=");
    const base = signatureBaseString("POST", "http://localhost:8080/oauth/token/request", [
      ["oauth_consumer_key", "ck"],
      ["oauth_nonce", "n"],
      ["oauth_signature_method", "HMAC-SHA256"],
      ["oauth_timestamp", "1"],
      ["oauth_version", "1.0"],
    ]);
    expect(signatureOf(a)).toBe(crypto.createHmac("sha256", "cs&").update(base).digest("base64"));
  });
});

describe("parseTokenResponse", () => {
  it("reads Magento's form-encoded token answer", () => {
    expect(parseTokenResponse("oauth_token=abc&oauth_token_secret=def\n")).toEqual({
      token: "abc",
      secret: "def",
    });
  });

  it("returns null for an error body", () => {
    expect(parseTokenResponse('{"message":"Consumer key has expired"}')).toBeNull();
  });
});
