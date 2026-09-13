var _a;
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer, useLoaderData, Meta, Links, Outlet, ScrollRestoration, Scripts, Link, useRouteError, useActionData, useNavigation, Form } from "@remix-run/react";
import { createReadableStreamFromReadable, redirect } from "@remix-run/node";
import { isbot } from "isbot";
import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion, LoginErrorType, boundary } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { AppProvider, Box, Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Button, List, FormLayout, TextField, Checkbox, Select, InlineGrid, Banner, Link as Link$1, EmptyState, FooterHelp } from "@shopify/polaris";
import { AppProvider as AppProvider$1 } from "@shopify/shopify-app-remix/react";
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { SaveBar } from "@shopify/app-bridge-react";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: (_a = process.env.SCOPES) == null ? void 0 : _a.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  // Custom distribution: this app installs on a single store via an install
  // link from the Partner Dashboard, not from the App Store. `SingleMerchant`
  // keeps OAuth and the embedded experience (unlike `ShopifyAdmin`, which is
  // the admin-created kind — no OAuth, no App Bridge, no CLI).
  distribution: AppDistribution.SingleMerchant,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true
  },
  ...process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}
});
ApiVersion.January25;
const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticate = shopify.authenticate;
shopify.unauthenticated;
const login = shopify.login;
shopify.registerWebhooks;
shopify.sessionStorage;
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, remixContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        RemixServer,
        {
          context: remixContext,
          url: request.url
        }
      ),
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        }
      }
    );
    setTimeout(abort, streamTimeout + 1e3);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const loader$d = async (_args) => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};
function App$2() {
  const { apiKey } = useLoaderData();
  return /* @__PURE__ */ jsxs("html", { lang: "en", children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx("meta", { charSet: "utf-8" }),
      /* @__PURE__ */ jsx("meta", { name: "viewport", content: "width=device-width,initial-scale=1" }),
      /* @__PURE__ */ jsx("meta", { name: "shopify-api-key", content: apiKey }),
      /* @__PURE__ */ jsx("script", { src: "https://cdn.shopify.com/shopifycloud/app-bridge.js" }),
      /* @__PURE__ */ jsx("link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" }),
      /* @__PURE__ */ jsx("link", { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }),
      /* @__PURE__ */ jsx("link", { rel: "preconnect", href: "https://cdn.shopify.com/" }),
      /* @__PURE__ */ jsx(
        "link",
        {
          rel: "stylesheet",
          href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        }
      ),
      /* @__PURE__ */ jsx(Meta, {}),
      /* @__PURE__ */ jsx(Links, {})
    ] }),
    /* @__PURE__ */ jsxs("body", { children: [
      /* @__PURE__ */ jsx(Outlet, {}),
      /* @__PURE__ */ jsx(ScrollRestoration, {}),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: App$2,
  loader: loader$d
}, Symbol.toStringTag, { value: "Module" }));
async function logEvent(shop, input) {
  return prisma.syncEvent.create({
    data: {
      shop,
      level: input.level ?? "info",
      event: input.event,
      message: input.message,
      orderGid: input.orderGid ?? null,
      data: input.data === void 0 ? null : safeStringify(input.data)
    }
  });
}
async function recentEvents(shop, limit = 100) {
  return prisma.syncEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit
  });
}
function safeStringify(value) {
  try {
    return JSON.stringify(value, makeReplacer(), 2);
  } catch {
    return "[unserialisable]";
  }
}
const SECRET_KEYS = /password|token|secret|authorization|credential|apikey|api_key/i;
const VALUE_PATTERNS = [
  // Query-string secrets: keep the parameter name, drop the value.
  [
    /([?&](?:access_token|refresh_token|token|password|secret|api_?key)=)[^&\s"'&]+/gi,
    "$1[redacted]"
  ],
  // Bearer / Basic credentials anywhere in a string.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"]
];
function scrubValue(input) {
  let out = input;
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
function makeReplacer() {
  const seen = /* @__PURE__ */ new WeakSet();
  return function replacer(key2, value) {
    if (SECRET_KEYS.test(key2)) return "[redacted]";
    if (typeof value === "string") return scrubValue(value);
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  };
}
const action$c = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  await logEvent(shop, {
    level: "warn",
    event: "gdpr.data_request",
    message: "A customer data request arrived from Shopify. The connector stores order sync state and, in Scopevisio, contact and document data. Booked documents are subject to GoBD retention and cannot be deleted.",
    data: { topic, payload }
  });
  return new Response();
};
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$c
}, Symbol.toStringTag, { value: "Module" }));
const action$b = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;
  if (session) {
    await prisma.session.update({
      where: {
        id: session.id
      },
      data: {
        scope: current.toString()
      }
    });
  }
  return new Response();
};
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$b
}, Symbol.toStringTag, { value: "Module" }));
const action$a = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  await logEvent(shop, {
    level: "warn",
    event: "gdpr.customer_redact",
    message: "Shopify asked for a customer to be erased. Personal data attached to booked documents is retained under GoBD; restrict processing in Scopevisio instead of deleting. No data was deleted automatically.",
    data: { topic, payload }
  });
  return new Response();
};
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$a
}, Symbol.toStringTag, { value: "Module" }));
const action$9 = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }
  return new Response();
};
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$9
}, Symbol.toStringTag, { value: "Module" }));
const VAT_ID_KEYS$2 = [
  "vat_id",
  "vatid",
  "vat",
  "ustid",
  "ust-id",
  "ustidnr",
  "umsatzsteuer-id",
  "tax_id",
  "vat_number"
];
function mapOrder(payload) {
  var _a2, _b;
  const gid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Order/${payload.id}` : "");
  const customerGid = ((_a2 = payload.customer) == null ? void 0 : _a2.admin_graphql_api_id) ?? (((_b = payload.customer) == null ? void 0 : _b.id) ? `gid://shopify/Customer/${payload.customer.id}` : void 0);
  return {
    id: gid,
    name: payload.name,
    orderNumber: payload.order_number,
    createdAt: payload.created_at,
    processedAt: payload.processed_at ?? payload.created_at,
    currencyCode: payload.currency ?? "EUR",
    email: payload.email ?? null,
    customer: payload.customer ? {
      id: customerGid,
      firstName: payload.customer.first_name ?? null,
      lastName: payload.customer.last_name ?? null,
      email: payload.customer.email ?? null,
      phone: payload.customer.phone ?? null
    } : null,
    billingAddress: mapAddress(payload.billing_address),
    shippingAddress: mapAddress(payload.shipping_address),
    totalTaxCents: toCents(payload.total_tax),
    vatId: extractVatId$2(payload),
    paymentGatewayNames: payload.payment_gateway_names ?? [],
    lineItems: (payload.line_items ?? []).map(mapLineItem)
  };
}
function mapAddress(addr) {
  if (!addr) return null;
  return {
    firstName: addr.first_name ?? null,
    lastName: addr.last_name ?? null,
    company: addr.company ?? null,
    address1: addr.address1 ?? null,
    address2: addr.address2 ?? null,
    zip: addr.zip ?? null,
    city: addr.city ?? null,
    countryCodeV2: addr.country_code ?? null,
    phone: addr.phone ?? null
  };
}
function mapLineItem(line) {
  var _a2, _b;
  const taxCents = (line.tax_lines ?? []).reduce(
    (sum, t2) => sum + (toCents(t2.price) ?? 0),
    0
  );
  return {
    title: line.title ?? line.name ?? "Position",
    sku: line.sku ?? null,
    quantity: line.quantity ?? 1,
    unitAmount: Number(line.price ?? 0),
    taxCents,
    taxRate: ((_b = (_a2 = line.tax_lines) == null ? void 0 : _a2[0]) == null ? void 0 : _b.rate) ?? null,
    productId: line.product_id ? String(line.product_id) : null
  };
}
function extractVatId$2(payload) {
  for (const attr of payload.note_attributes ?? []) {
    const key2 = (attr.name ?? "").toLowerCase().replace(/\s+/g, "_");
    if (VAT_ID_KEYS$2.includes(key2) && attr.value) {
      return attr.value.trim();
    }
  }
  return null;
}
function toCents(value) {
  if (value === null || value === void 0 || value === "") return void 0;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) : void 0;
}
function mapRefund(payload) {
  return {
    refundGid: payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Refund/${payload.id}` : ""),
    orderGid: payload.order_id ? `gid://shopify/Order/${payload.order_id}` : "",
    createdAt: payload.created_at,
    note: payload.note ?? null,
    lines: (payload.refund_line_items ?? []).map((rli) => {
      var _a2, _b, _c, _d, _e;
      return {
        title: ((_a2 = rli.line_item) == null ? void 0 : _a2.title) ?? ((_b = rli.line_item) == null ? void 0 : _b.name) ?? "Rückgabe",
        sku: ((_c = rli.line_item) == null ? void 0 : _c.sku) ?? null,
        quantity: rli.quantity ?? 1,
        unitAmount: Number(((_d = rli.line_item) == null ? void 0 : _d.price) ?? rli.subtotal ?? 0),
        productId: ((_e = rli.line_item) == null ? void 0 : _e.product_id) ? String(rli.line_item.product_id) : null
      };
    })
  };
}
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
function key() {
  const raw = process.env.SCOPEVISIO_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SCOPEVISIO_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your environment."
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `SCOPEVISIO_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}. Generate one with \`openssl rand -base64 32\`.`
    );
  }
  return buf;
}
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}
function decrypt(payload) {
  const parts = payload.split(":");
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
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}
function tryDecrypt(payload) {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}
function encryptionKeyConfigured() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
class ScopevisioError extends Error {
  constructor(message, status, body, merchantActionable = false) {
    super(message);
    this.status = status;
    this.body = body;
    this.merchantActionable = merchantActionable;
    this.name = "ScopevisioError";
  }
}
const EXPIRY_SKEW_SECONDS = 60;
class ScopevisioClient {
  constructor(conn, store) {
    this.conn = conn;
    this.store = store;
  }
  /**
   * Build a client over a connector's own storage.
   *
   * Throws if the tenant has no connection yet, because every caller past this
   * point assumes one exists.
   */
  static async fromStore(store) {
    const conn = await store.load();
    if (!conn) {
      throw new ScopevisioError(
        "No Scopevisio connection configured for this tenant.",
        void 0,
        void 0,
        true
      );
    }
    return new ScopevisioClient(conn, store);
  }
  /** Build a client from credentials that are not saved yet, to test them. */
  static ephemeral(input) {
    return new ScopevisioClient(
      {
        baseUrl: input.baseUrl ?? "https://appload.scopevisio.com",
        customer: input.customer,
        organisation: input.organisation ?? "",
        username: input.username,
        passwordEnc: encrypt(input.password),
        refreshTokenEnc: null,
        accessTokenEnc: null,
        accessTokenExpiresAt: null
      },
      null
    );
  }
  get baseUrl() {
    return this.conn.baseUrl.replace(/\/+$/, "");
  }
  get organisation() {
    return this.conn.organisation;
  }
  get isPersisted() {
    return this.store !== null;
  }
  // --- token handling -------------------------------------------------------
  async persistTokens(token) {
    var _a2;
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1e3) : new Date(Date.now() + 15 * 60 * 1e3);
    const data = {
      accessTokenEnc: encrypt(token.access_token),
      accessTokenExpiresAt: expiresAt
    };
    if (token.refresh_token) {
      data.refreshTokenEnc = encrypt(token.refresh_token);
      data.passwordEnc = null;
    }
    if (token.organisationName && !this.conn.organisation) {
      data.organisation = token.organisationName;
    }
    this.conn = { ...this.conn, ...data };
    await ((_a2 = this.store) == null ? void 0 : _a2.save(data));
  }
  async requestToken(params) {
    const res = await fetch(`${this.baseUrl}/rest/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: new URLSearchParams(params).toString()
    });
    const text2 = await res.text();
    if (!res.ok) {
      throw new ScopevisioError(
        res.status === 401 || res.status === 400 ? "Scopevisio rejected these credentials. Check the customer number, organisation, user and password." : `Scopevisio token request failed (HTTP ${res.status}).`,
        res.status,
        text2,
        res.status === 400 || res.status === 401 || res.status === 403
      );
    }
    try {
      return JSON.parse(text2);
    } catch {
      throw new ScopevisioError(
        "Scopevisio returned an unreadable token response.",
        res.status,
        text2
      );
    }
  }
  async accessToken(force = false) {
    if (!force) {
      const cached2 = tryDecrypt(this.conn.accessTokenEnc);
      const exp = this.conn.accessTokenExpiresAt;
      if (cached2 && exp && exp.getTime() - EXPIRY_SKEW_SECONDS * 1e3 > Date.now()) {
        return cached2;
      }
    }
    const refresh = tryDecrypt(this.conn.refreshTokenEnc);
    if (refresh) {
      try {
        const token2 = await this.requestToken({
          grant_type: "refresh_token",
          refresh_token: refresh,
          customer: this.conn.customer,
          ...this.conn.organisation ? { organisation: this.conn.organisation } : {}
        });
        await this.persistTokens(token2);
        return token2.access_token;
      } catch (err) {
        if (!tryDecrypt(this.conn.passwordEnc)) {
          throw new ScopevisioError(
            "The Scopevisio connection needs to be re-authorised. Open Settings and reconnect.",
            err.status,
            err.body,
            true
          );
        }
      }
    }
    const password = tryDecrypt(this.conn.passwordEnc);
    if (!password) {
      throw new ScopevisioError(
        "The Scopevisio connection needs to be re-authorised. Open Settings and reconnect.",
        void 0,
        void 0,
        true
      );
    }
    const token = await this.requestToken({
      grant_type: "password",
      customer: this.conn.customer,
      ...this.conn.organisation ? { organisation: this.conn.organisation } : {},
      username: this.conn.username,
      password
    });
    await this.persistTokens(token);
    return token.access_token;
  }
  // --- request plumbing -----------------------------------------------------
  async raw(method, path, opts = {}) {
    const token = await this.accessToken();
    const url = new URL(`${this.baseUrl}/rest${path.startsWith("/") ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== void 0 && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers2 = {
      authorization: `Bearer ${token}`,
      accept: "*/*"
    };
    let body;
    if (opts.json !== void 0) {
      headers2["content-type"] = "application/json";
      body = typeof opts.json === "string" ? opts.json : JSON.stringify(opts.json);
    }
    const res = await fetch(url, { method, headers: headers2, body });
    const text2 = await res.text();
    if (res.status === 401 && opts.retryOn401 !== false) {
      await this.accessToken(true);
      return this.raw(method, path, { ...opts, retryOn401: false });
    }
    return { status: res.status, text: text2 };
  }
  parse(status, text2, path) {
    if (status < 200 || status >= 300) {
      const merchantActionable = status === 403 || status === 401;
      throw new ScopevisioError(
        merchantActionable ? `Scopevisio denied access to ${path}. The connector user is probably missing a profile — see the required profiles for this endpoint.` : `Scopevisio request to ${path} failed (HTTP ${status}).`,
        status,
        text2.slice(0, 2e3),
        merchantActionable
      );
    }
    if (!text2.trim()) return void 0;
    try {
      return JSON.parse(text2);
    } catch {
      return text2;
    }
  }
  async get(path, query) {
    const { status, text: text2 } = await this.raw("GET", path, { query });
    return this.parse(status, text2, path);
  }
  async post(path, json, query) {
    const { status, text: text2 } = await this.raw("POST", path, { json, query });
    return this.parse(status, text2, path);
  }
  /**
   * `POST /{plural}` endpoints are queries whose body is a search filter, not
   * a JSON object — the spec types the body as a plain string.
   * See docs/API-FINDINGS.md §6.
   */
  async search(path, filter) {
    return this.post(path, JSON.stringify(filter));
  }
  /**
   * Cheap reachability probe used by the settings screen. Returns the
   * organisation the token endpoint resolved, so the UI can confirm which
   * Scopevisio organisation it actually connected to.
   */
  async verify() {
    const account = await this.get("/myaccount");
    return { ok: true, account, organisation: this.conn.organisation };
  }
}
function formatGermanDate$1(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}
const DEFAULT_BASE_URL = "https://appload.scopevisio.com";
const TAX_CASE_LABEL = {
  domestic: "Domestic",
  eu_b2c: "EU B2C (domestic VAT, below threshold)",
  eu_b2c_oss: "EU B2C via OSS (destination VAT)",
  eu_b2b_reverse: "EU B2B — reverse charge",
  third_country: "Third-country export"
};
const EU_COUNTRIES = /* @__PURE__ */ new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK"
]);
const HOLD_REASON_LABEL = {
  vat_id_unvalidated: "VAT ID could not be validated",
  vat_scope_unconfigured: "Tax case not configured",
  no_revenue_account: "No matching revenue account",
  revenue_account_lookup_failed: "Could not reach the Steuermatrix",
  tax_mismatch: "Shopify and Scopevisio disagree on VAT",
  awaiting_manual_post: "Waiting for you to post it",
  no_document_number: "No document number returned",
  scopevisio_rejected: "Scopevisio refused the request",
  sync_error: "Unexpected error",
  sync_disabled: "Sync was switched off",
  refunded_before_posting: "Refunded before it was posted",
  unknown_order: "Refund for an unbooked order",
  credit_failed: "Credit note could not be created",
  missing_contact: "No contact recorded on the original booking"
};
const SCOPE_FIELDS = [
  {
    field: "vatScopeDomestic",
    taxCase: "domestic",
    help: "Orders shipped inside your own country of taxation."
  },
  {
    field: "vatScopeEuB2c",
    taxCase: "eu_b2c",
    help: "Consumers in other EU states while you are below the €10,000 threshold — your domestic VAT applies."
  },
  {
    field: "vatScopeEuB2cOss",
    taxCase: "eu_b2c_oss",
    help: "Consumers in other EU states once you are OSS-registered — destination VAT applies."
  },
  {
    field: "vatScopeEuB2bReverse",
    taxCase: "eu_b2b_reverse",
    help: "Businesses in other EU states with a VAT ID that validates. Reverse charge."
  },
  {
    field: "vatScopeThirdCountry",
    taxCase: "third_country",
    help: "Deliveries outside the EU — normally a tax-free export."
  }
];
function destinationCountry(order, fallback) {
  var _a2, _b;
  return (((_a2 = order.shippingAddress) == null ? void 0 : _a2.countryCodeV2) || ((_b = order.billingAddress) == null ? void 0 : _b.countryCodeV2) || fallback).toUpperCase();
}
function classify(args) {
  const dest = args.destination.toUpperCase();
  const home = args.homeCountry.toUpperCase();
  if (dest === home) return "domestic";
  if (EU_COUNTRIES.has(dest)) {
    if (args.hasValidVatId) return "eu_b2b_reverse";
    return args.ossRegistered ? "eu_b2c_oss" : "eu_b2c";
  }
  return "third_country";
}
const SCOPE_FIELD_FOR_CASE = {
  domestic: "vatScopeDomestic",
  eu_b2c: "vatScopeEuB2c",
  eu_b2c_oss: "vatScopeEuB2cOss",
  eu_b2b_reverse: "vatScopeEuB2bReverse",
  third_country: "vatScopeThirdCountry"
};
const VAT_PREFIXES = /* @__PURE__ */ new Set([...EU_COUNTRIES, "EL", "XI"]);
function normaliseVatId(value) {
  if (!value) return null;
  const cleaned = value.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(cleaned)) return null;
  const prefix = cleaned.slice(0, 2);
  const rest = cleaned.slice(2);
  if (!VAT_PREFIXES.has(prefix)) return null;
  if (!/\d/.test(rest)) return null;
  return cleaned;
}
function pickRevenueAccount(accounts, country) {
  if (accounts.length === 0) return null;
  const exact = accounts.find(
    (a) => (a.countryIso ?? "").toUpperCase() === country.toUpperCase()
  );
  return exact ?? accounts[0];
}
const REVIEW_TAG = "shopify-review";
async function upsertCustomer(ctx, order, settings) {
  var _a2, _b, _c;
  const client = ctx.client;
  const isGuest = !((_a2 = order.customer) == null ? void 0 : _a2.id);
  const gid = ((_b = order.customer) == null ? void 0 : _b.id) ?? `guest:${order.id}`;
  const existing = await findByLegacyNumber(client, gid);
  if (existing) {
    const personalAccount2 = await ensureDebitor(
      ctx,
      client,
      existing,
      order,
      settings,
      isGuest
    );
    return { contactId: existing, personalAccount: personalAccount2, created: false };
  }
  const email = ((_c = order.customer) == null ? void 0 : _c.email) ?? order.email ?? null;
  let reviewNote;
  if (email) {
    const candidates = await findByEmail(client, email);
    if (candidates.length === 1 && !isGuest) {
      const candidate = candidates[0];
      if (matchesName(candidate, order)) {
        await stampLegacyNumber(client, candidate.id, gid);
        const personalAccount2 = await ensureDebitor(ctx, client, candidate.id, order, settings, isGuest);
        await ctx.journal.event({
          event: "contact.linked",
          externalId: order.id,
          message: `Linked to existing Scopevisio contact ${candidate.id} by e-mail.`
        });
        return { contactId: candidate.id, personalAccount: personalAccount2, created: false, reviewNote };
      }
      reviewNote = `A Scopevisio contact (${candidate.id}) already uses ${email} but the name differs. A new contact was created instead of reusing it — merge them in Scopevisio if they are the same person.`;
    } else if (candidates.length > 1) {
      reviewNote = `${candidates.length} Scopevisio contacts already use ${email}. A new contact was created rather than guessing which one is right.`;
    }
  }
  const contactId = await createContact(client, order, gid, isGuest, Boolean(reviewNote));
  const personalAccount = await ensureDebitor(ctx, client, contactId, order, settings, isGuest);
  await ctx.journal.event({
    level: reviewNote ? "warn" : "info",
    event: "contact.created",
    externalId: order.id,
    message: reviewNote ? `Created Scopevisio contact ${contactId}; possible duplicate flagged for review.` : `Created Scopevisio contact ${contactId}.`,
    data: { contactId, personalAccount, isGuest, reviewNote }
  });
  return { contactId, personalAccount, created: true, reviewNote };
}
async function findByLegacyNumber(client, gid) {
  try {
    const res = await client.get(
      `/contact/LEGACYNUMBER/${encodeURIComponent(gid)}`,
      { fields: "id,lastname" }
    );
    return (res == null ? void 0 : res.id) ?? (res == null ? void 0 : res.masterId) ?? null;
  } catch (err) {
    if (err instanceof ScopevisioError && err.status === 404) return null;
    throw err;
  }
}
async function findByEmail(client, email) {
  const res = await client.search("/contacts", {
    search: [{ field: "email", value: email, operator: "equal" }],
    fields: ["id", "lastname", "firstname", "email"],
    // Two is enough to detect ambiguity without paging.
    pageSize: 2,
    formatValues: false
  });
  return (res == null ? void 0 : res.records) ?? [];
}
function matchesName(candidate, order) {
  var _a2, _b, _c;
  const expected = (((_a2 = order.customer) == null ? void 0 : _a2.lastName) || ((_b = order.billingAddress) == null ? void 0 : _b.lastName) || ((_c = order.shippingAddress) == null ? void 0 : _c.lastName) || "").trim().toLowerCase();
  if (!expected) return false;
  return (candidate.lastname ?? "").trim().toLowerCase() === expected;
}
async function stampLegacyNumber(client, contactId, gid) {
  await client.post(`/contact/${contactId}`, { legacyNumber: gid });
}
async function createContact(client, order, gid, isGuest, needsReview) {
  var _a2, _b, _c, _d, _e, _f;
  const addr = order.billingAddress ?? order.shippingAddress ?? null;
  const company = ((_a2 = addr == null ? void 0 : addr.company) == null ? void 0 : _a2.trim()) || null;
  const isPerson = !company;
  const lastname = company || ((_b = order.customer) == null ? void 0 : _b.lastName) || (addr == null ? void 0 : addr.lastName) || ((_c = order.customer) == null ? void 0 : _c.email) || order.email || "Unbekannt";
  const tags = [isGuest ? "shopify-guest" : "shopify", needsReview ? REVIEW_TAG : null].filter(Boolean).join(",");
  const form = {
    person: isPerson,
    lastname: String(lastname).slice(0, 100),
    firstname: isPerson ? (((_d = order.customer) == null ? void 0 : _d.firstName) ?? (addr == null ? void 0 : addr.firstName) ?? void 0) || void 0 : void 0,
    email: ((_e = order.customer) == null ? void 0 : _e.email) ?? order.email ?? void 0,
    phone: (addr == null ? void 0 : addr.phone) ?? ((_f = order.customer) == null ? void 0 : _f.phone) ?? void 0,
    ...addressFields(addr),
    legacyNumber: gid,
    tags,
    vatId: order.vatId ?? void 0,
    currency: order.currencyCode,
    description: `Created by the Shopify connector from order ${order.name ?? order.id}.`
  };
  const res = await client.post("/contact/new", form);
  const id = (res == null ? void 0 : res.id) ?? (res == null ? void 0 : res.contactId) ?? (res == null ? void 0 : res.masterId);
  if (!id) {
    throw new ScopevisioError(
      "Scopevisio accepted the contact but returned no id.",
      void 0,
      JSON.stringify(res)
    );
  }
  return id;
}
function addressFields(addr) {
  if (!addr) return {};
  return {
    street1: addr.address1 ?? void 0,
    addressExtra1: addr.address2 ?? void 0,
    postcode1: addr.zip ?? void 0,
    city1: addr.city ?? void 0,
    country1: addr.countryCodeV2 ?? void 0
  };
}
async function ensureDebitor(ctx, client, contactId, order, settings, isGuest) {
  var _a2;
  const form = {
    contactId,
    group: isGuest ? settings.guestCustomerGroup : settings.customerGroup,
    numberRangeNumber: settings.numberRangeNumber ?? void 0,
    contoProDiverse: isGuest ? settings.guestUseCpd : void 0,
    email: ((_a2 = order.customer) == null ? void 0 : _a2.email) ?? order.email ?? void 0,
    vatId: order.vatId ?? void 0,
    currency: order.currencyCode
  };
  try {
    const res = await client.post("/createdebitor", form);
    return (res == null ? void 0 : res.personalAccountNumber) ?? (res == null ? void 0 : res.accountNumber) ?? (res == null ? void 0 : res.number) ?? void 0;
  } catch (err) {
    if (err instanceof ScopevisioError && err.merchantActionable) {
      throw new ScopevisioError(
        `Scopevisio refused to create the debitor account for contact ${contactId}. The connector user needs the "Datenimport (Bearbeiten)" and "Kontakte bearbeiten (Bearbeiten)" profiles. Original message: ${err.message}`,
        err.status,
        err.body,
        true
      );
    }
    throw err;
  }
}
function buildInvoiceXml(args) {
  const { order, treatment } = args;
  const positions = order.lineItems.map((line) => {
    const fields = [
      el("name", line.title),
      el("quantity", String(line.quantity)),
      el("singleAmount", line.unitAmount.toFixed(2))
    ];
    if (line.sku) fields.push(el("number", line.sku));
    if (!args.deriveFromProduct) {
      if (treatment.account) fields.push(el("account", treatment.account));
      if (treatment.vatKey) fields.push(el("vatKey", treatment.vatKey));
    }
    return `      <position>
${fields.map((f) => `        ${f}`).join("\n")}
      </position>`;
  }).join("\n");
  const header = [
    el("customerContactId", String(args.contactId)),
    el("documentDate", formatGermanDate$1(args.documentDate)),
    el("externalReference", args.externalReference),
    el("currency", order.currencyCode ?? "EUR")
  ];
  if (args.personalAccount) {
    header.push(el("customerPersonalAccountNumber", args.personalAccount));
  }
  if (order.name) header.push(el("text", `Shopify ${order.name}`));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<outgoingInvoices>",
    "  <outgoingInvoice>",
    ...header.map((h) => `    ${h}`),
    "    <positionsForm>",
    positions,
    "    </positionsForm>",
    "  </outgoingInvoice>",
    "</outgoingInvoices>"
  ].join("\n");
}
function el(name, value) {
  return `<${name}>${escapeXml(value)}</${name}>`;
}
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function createInvoice(ctx, args, opts) {
  var _a2;
  const client = ctx.client;
  const form = {
    data: buildInvoiceXml(args),
    generateDocumentNumbers: true,
    // Never post on import. The checksum runs between create and post.
    doPost: false,
    skipDuplicates: true,
    createPdf: Boolean(opts.template),
    template: opts.template ?? void 0,
    copyProductToPosition: opts.copyProductFields,
    copyVatKeyAndTaxRateToPosition: args.deriveFromProduct,
    copyImpersonalAccountFieldsToPosition: args.deriveFromProduct
  };
  const raw = await client.post("/outgoinginvoices/import", form);
  if ((_a2 = raw == null ? void 0 : raw.errors) == null ? void 0 : _a2.length) {
    throw new ScopevisioError(
      `Scopevisio rejected the invoice import: ${raw.errors.join("; ")}`,
      void 0,
      JSON.stringify(raw),
      true
    );
  }
  const imported = (raw == null ? void 0 : raw.invoices) ?? [];
  if (imported.length === 0) {
    throw new ScopevisioError(
      `Scopevisio accepted the import request but created no invoice (${(raw == null ? void 0 : raw.message) ?? "no message"}). The import document was not recognised.`,
      void 0,
      JSON.stringify(raw),
      true
    );
  }
  const documentNumber = extractNumber(imported[0]);
  return { documentNumber, raw };
}
async function postInvoice(ctx, documentNumber) {
  const client = ctx.client;
  return client.post(`/outgoinginvoice/${encodeURIComponent(documentNumber)}/post`);
}
async function getInvoice(ctx, documentNumber) {
  const client = ctx.client;
  return client.get(`/outgoinginvoice/${encodeURIComponent(documentNumber)}`);
}
async function getInvoiceTaxCents(ctx, documentNumber) {
  try {
    const doc = await getInvoice(ctx, documentNumber);
    for (const key2 of ["vatAmount", "taxAmount", "totalVat", "vatTotal"]) {
      const value = doc == null ? void 0 : doc[key2];
      if (typeof value === "number") return Math.round(value * 100);
    }
    return null;
  } catch {
    return null;
  }
}
function extractNumber(entry2) {
  if (!entry2) return null;
  if (typeof entry2 === "string") return entry2 || null;
  return entry2.documentNumber ?? entry2.number ?? null;
}
function buildCreditXml(args) {
  const base = buildInvoiceXml(args);
  return base.replace("<outgoingInvoices>", "<credits>").replace("</outgoingInvoices>", "</credits>").replace("<outgoingInvoice>", "<credit>").replace("</outgoingInvoice>", "</credit>").replace(
    "    <positionsForm>",
    `    ${el("parentDocumentNumber", args.originalDocumentNumber)}
    <positionsForm>`
  );
}
function connectionStore(shop) {
  return {
    async load() {
      const row = await prisma.scopevisioConnection.findUnique({ where: { shop } });
      if (!row) return null;
      return {
        baseUrl: row.baseUrl,
        customer: row.customer,
        organisation: row.organisation,
        username: row.username,
        passwordEnc: row.passwordEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        accessTokenEnc: row.accessTokenEnc,
        accessTokenExpiresAt: row.accessTokenExpiresAt
      };
    },
    async save(patch) {
      await prisma.scopevisioConnection.updateMany({ where: { shop }, data: patch });
    }
  };
}
function journal(shop) {
  return {
    async event(entry2) {
      await logEvent(shop, {
        level: entry2.level,
        event: entry2.event,
        message: entry2.message,
        orderGid: entry2.externalId ?? null,
        data: entry2.data
      });
    }
  };
}
async function scopevisioContext(shop) {
  return {
    client: await ScopevisioClient.fromStore(connectionStore(shop)),
    journal: journal(shop)
  };
}
function clientFor(shop) {
  return ScopevisioClient.fromStore(connectionStore(shop));
}
async function syncRefund(shop, refund) {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  if (!(settings == null ? void 0 : settings.syncEnabled)) {
    return { state: "skipped", reason: "sync_disabled" };
  }
  const order = await prisma.orderSync.findUnique({
    where: { shop_orderGid: { shop, orderGid: refund.orderGid } }
  });
  if (!order) {
    await logEvent(shop, {
      level: "warn",
      event: "refund.unknown_order",
      orderGid: refund.orderGid,
      message: "A refund arrived for an order this connector never booked. No credit note was created."
    });
    return {
      state: "held",
      reason: "unknown_order",
      detail: "This refund belongs to an order that was never booked by the connector, so there is no invoice to correct."
    };
  }
  if (order.creditNumber) {
    return { state: "credited", creditNumber: order.creditNumber };
  }
  if (order.state !== "booked" || !order.documentNumber) {
    await prisma.orderSync.update({
      where: { id: order.id },
      data: {
        state: "declined",
        reason: "refunded_before_posting",
        detail: "The order was refunded before its invoice was posted, so the pending invoice was withdrawn instead of being credited.",
        resolvedBy: "connector",
        resolvedAt: /* @__PURE__ */ new Date()
      }
    });
    await logEvent(shop, {
      event: "refund.withdrew_pending",
      orderGid: refund.orderGid,
      message: "Order refunded before its invoice was posted — the pending document was withdrawn, no Gutschrift created."
    });
    return { state: "withdrawn" };
  }
  if (!order.contactId) {
    return {
      state: "held",
      reason: "missing_contact",
      detail: "The original booking has no Scopevisio contact recorded, so a credit note cannot be addressed."
    };
  }
  try {
    const client = await clientFor(shop);
    const orderLike = {
      id: refund.orderGid,
      name: order.orderName ?? void 0,
      currencyCode: "EUR",
      lineItems: refund.lines
    };
    const xml = buildCreditXml({
      order: orderLike,
      contactId: order.contactId,
      personalAccount: order.personalAccount ?? void 0,
      treatment: {
        // The credit must carry the same treatment as the invoice it corrects.
        taxCase: "domestic",
        vatScope: order.vatScopeUsed ?? null,
        country: order.countryUsed ?? settings.homeCountry
      },
      documentDate: refund.createdAt ? new Date(refund.createdAt) : /* @__PURE__ */ new Date(),
      externalReference: refund.refundGid,
      deriveFromProduct: settings.copyVatFromProduct,
      originalDocumentNumber: order.documentNumber
    });
    const result = await client.post("/outgoinginvoices/import", {
      data: xml,
      generateDocumentNumbers: true,
      doPost: false,
      skipDuplicates: true
    });
    const created = (result == null ? void 0 : result.invoices) ?? [];
    const first = created[0];
    const creditNumber = typeof first === "string" ? first : (first == null ? void 0 : first.documentNumber) ?? (first == null ? void 0 : first.number) ?? null;
    if (!creditNumber) {
      return {
        state: "held",
        reason: "credit_not_created",
        detail: `Scopevisio accepted the import request but created no credit note (${(result == null ? void 0 : result.message) ?? "no message"}). The import document was not recognised — this is the same blocked XML schema as invoice creation.`
      };
    }
    if (settings.autoPost) {
      await client.post(`/credit/${encodeURIComponent(String(creditNumber))}/post`);
    }
    await prisma.orderSync.update({
      where: { id: order.id },
      data: { creditNumber: String(creditNumber) }
    });
    await logEvent(shop, {
      event: "credit.created",
      orderGid: refund.orderGid,
      message: `Refund booked as credit note ${creditNumber} against invoice ${order.documentNumber}.`,
      data: { creditNumber, invoice: order.documentNumber, posted: settings.autoPost }
    });
    return { state: "credited", creditNumber: String(creditNumber) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unexpected error.";
    await logEvent(shop, {
      level: "error",
      event: "credit.failed",
      orderGid: refund.orderGid,
      message: detail
    });
    return { state: "held", reason: "credit_failed", detail };
  }
}
const action$8 = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    const refund = mapRefund(payload);
    if (!refund.orderGid) {
      await logEvent(shop, {
        level: "error",
        event: "webhook.malformed",
        message: `${topic} arrived without an order reference; no credit note was created.`
      });
      return new Response();
    }
    await syncRefund(shop, refund);
  } catch (err) {
    await logEvent(shop, {
      level: "error",
      event: "webhook.failed",
      message: `${topic} could not be processed: ${err instanceof Error ? err.message : String(err)}`
    });
  }
  return new Response();
};
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$8
}, Symbol.toStringTag, { value: "Module" }));
const CACHE_TTL_MS = 30 * 60 * 1e3;
async function cached(shop, kind, load, opts = {}) {
  const row = await prisma.masterDataCache.findUnique({
    where: { shop_kind: { shop, kind } }
  });
  const fresh = row && Date.now() - row.fetchedAt.getTime() < CACHE_TTL_MS && !opts.force;
  if (fresh) {
    try {
      return { data: JSON.parse(row.payload), fetchedAt: row.fetchedAt, stale: false };
    } catch {
    }
  }
  try {
    const data = await load();
    const saved = await prisma.masterDataCache.upsert({
      where: { shop_kind: { shop, kind } },
      create: { shop, kind, payload: JSON.stringify(data) },
      update: { payload: JSON.stringify(data), fetchedAt: /* @__PURE__ */ new Date() }
    });
    return { data, fetchedAt: saved.fetchedAt, stale: false };
  } catch (err) {
    if (row) {
      try {
        return {
          data: JSON.parse(row.payload),
          fetchedAt: row.fetchedAt,
          stale: true
        };
      } catch {
      }
    }
    throw err;
  }
}
function records(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.records ?? [];
}
async function getVatScopes(shop, opts = {}) {
  return cached(
    shop,
    "vatscopes",
    async () => {
      const client = await clientFor(shop);
      const res = await client.get("/vatscopes", {
        active: true
      });
      return records(res);
    },
    opts
  );
}
async function getVatMatrix(shop, opts = {}) {
  return cached(
    shop,
    "vatmatrix",
    async () => {
      const client = await clientFor(shop);
      const res = await client.get("/vatmatrixentries");
      return records(res);
    },
    opts
  );
}
async function getStandardRevenueAccounts(shop, opts = {}) {
  return cached(
    shop,
    "revenueaccounts",
    async () => {
      const client = await clientFor(shop);
      const res = await client.get(
        "/revenueaccounts/standard"
      );
      return records(res);
    },
    opts
  );
}
async function resolveRevenueAccounts(shop, args) {
  const client = await clientFor(shop);
  const query = {
    country: args.country,
    vatScope: args.vatScope,
    servicesRenderedDate: formatGermanDate(args.servicesRenderedDate),
    active: true,
    pageSize: 500
  };
  const [productAccounts, standardAccounts] = await Promise.all([
    client.get("/revenueaccounts/products", query).then(records).catch(() => []),
    client.get("/revenueaccounts/standard", query).then(records).catch(() => [])
  ]);
  if (productAccounts.length === 0 && standardAccounts.length === 0) {
    return [];
  }
  return [...productAccounts, ...standardAccounts];
}
function formatGermanDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}
async function refreshAllMasterData(shop) {
  const [scopes, matrix, accounts] = await Promise.allSettled([
    getVatScopes(shop, { force: true }),
    getVatMatrix(shop, { force: true }),
    getStandardRevenueAccounts(shop, { force: true })
  ]);
  return {
    vatScopes: scopes.status === "fulfilled" ? scopes.value.data.length : null,
    vatMatrix: matrix.status === "fulfilled" ? matrix.value.data.length : null,
    revenueAccounts: accounts.status === "fulfilled" ? accounts.value.data.length : null,
    errors: [scopes, matrix, accounts].filter((r) => r.status === "rejected").map((r) => {
      var _a2;
      return String(((_a2 = r.reason) == null ? void 0 : _a2.message) ?? r.reason);
    })
  };
}
function buildDraft(order, treatment, documentDate, contactId, personalAccount) {
  return {
    externalId: order.id,
    externalRef: order.name ?? null,
    documentDate: formatGermanDate(documentDate),
    contactId,
    personalAccount,
    country: treatment.country ?? null,
    taxCase: treatment.taxCase ?? null,
    vatScope: treatment.vatScope ?? null,
    account: treatment.account ?? null,
    vatKey: treatment.vatKey ?? null,
    currency: order.currencyCode ?? "EUR",
    positions: order.lineItems.map((l) => ({
      name: l.title,
      number: l.sku ?? null,
      quantity: l.quantity,
      singleAmount: l.unitAmount
    })),
    sourceTaxCents: order.totalTaxCents ?? null
  };
}
const COLUMNS = [
  "customerContactId",
  "customerPersonalAccountNumber",
  "documentDate",
  "reference",
  "text",
  "currency",
  "taxCountryCodeIso2",
  "number",
  "name",
  "quantity",
  "singleAmount",
  "account",
  "vatKey"
];
function escapeCsv(s) {
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function cell(value) {
  if (value === null || value === void 0) return "";
  return escapeCsv(String(value));
}
function money(value) {
  if (value === null || value === void 0) return "";
  return escapeCsv(value.toFixed(2).replace(".", ","));
}
function qty(value) {
  if (value === null || value === void 0) return "";
  return escapeCsv(
    Number.isInteger(value) ? String(value) : String(value).replace(".", ",")
  );
}
function draftsToCsv(drafts) {
  const lines = [COLUMNS.join(";")];
  for (const d of drafts) {
    for (const p of d.positions) {
      lines.push(
        [
          cell(d.contactId),
          cell(d.personalAccount),
          cell(d.documentDate),
          cell(d.externalId),
          cell(d.externalRef ? `Shopify ${d.externalRef}` : ""),
          cell(d.currency),
          cell(d.country),
          cell(p.number),
          cell(p.name),
          qty(p.quantity),
          money(p.singleAmount),
          cell(d.account),
          cell(d.vatKey)
        ].join(";")
      );
    }
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
async function pendingExport(shop) {
  return prisma.orderSync.findMany({
    where: { shop, state: "ready_to_export", draftJson: { not: null } },
    orderBy: { createdAt: "asc" }
  });
}
function parseDrafts(rows) {
  const drafts = [];
  for (const row of rows) {
    if (!row.draftJson) continue;
    try {
      drafts.push(JSON.parse(row.draftJson));
    } catch {
    }
  }
  return drafts;
}
async function createExportBatch(shop) {
  const rows = await pendingExport(shop);
  const drafts = parseDrafts(rows);
  const batchId = `B-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
  const csv = draftsToCsv(drafts);
  if (rows.length > 0) {
    await prisma.orderSync.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { state: "exported", exportBatch: batchId, exportedAt: /* @__PURE__ */ new Date() }
    });
  }
  await logEvent(shop, {
    event: "export.batch_created",
    message: `Exported ${drafts.length} invoice(s) as batch ${batchId} for import into Scopevisio.`,
    data: { batchId, orders: drafts.map((d) => d.externalRef ?? d.externalId) }
  });
  return {
    csv,
    batchId,
    count: drafts.length,
    orderNames: drafts.map((d) => d.externalRef ?? d.externalId)
  };
}
async function rebuildBatch(shop, batchId) {
  const rows = await prisma.orderSync.findMany({
    where: { shop, exportBatch: batchId },
    orderBy: { createdAt: "asc" }
  });
  const drafts = parseDrafts(rows);
  return {
    csv: draftsToCsv(drafts),
    batchId,
    count: drafts.length,
    orderNames: drafts.map((d) => d.externalRef ?? d.externalId)
  };
}
async function confirmImported(shop, batchId, by) {
  const result = await prisma.orderSync.updateMany({
    where: { shop, exportBatch: batchId, state: "exported" },
    data: {
      state: "booked",
      reason: null,
      detail: null,
      importConfirmedAt: /* @__PURE__ */ new Date(),
      importConfirmedBy: by
    }
  });
  await logEvent(shop, {
    event: "export.import_confirmed",
    message: `${by} confirmed batch ${batchId} was imported into Scopevisio (${result.count} invoice(s)).`,
    data: { batchId, count: result.count }
  });
  return result.count;
}
async function returnBatchToQueue(shop, batchId, reason) {
  const result = await prisma.orderSync.updateMany({
    where: { shop, exportBatch: batchId, state: "exported" },
    data: {
      state: "ready_to_export",
      exportBatch: null,
      exportedAt: null,
      detail: `Returned to the queue: ${reason}`
    }
  });
  await logEvent(shop, {
    level: "warn",
    event: "export.batch_returned",
    message: `Batch ${batchId} returned to the queue (${result.count} invoice(s)): ${reason}`,
    data: { batchId, count: result.count, reason }
  });
  return result.count;
}
async function openBatches(shop) {
  const rows = await prisma.orderSync.findMany({
    where: { shop, state: "exported", exportBatch: { not: null } },
    orderBy: { exportedAt: "desc" }
  });
  const byBatch = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const id = row.exportBatch;
    const entry2 = byBatch.get(id);
    if (entry2) entry2.count += 1;
    else byBatch.set(id, { batchId: id, count: 1, exportedAt: row.exportedAt });
  }
  return [...byBatch.values()];
}
async function determineTaxTreatment(shop, order, settings, servicesRenderedDate) {
  const country = destinationCountry(order, settings.homeCountry);
  let hasValidVatId = false;
  let vatIdProblem = null;
  const claimedVatId = normaliseVatId(order.vatId);
  if (claimedVatId) {
    const check = await validateVatId(shop, claimedVatId);
    hasValidVatId = check.valid;
    if (!check.valid) {
      vatIdProblem = check.reachable ? `The VAT ID ${claimedVatId} was rejected by VIES.` : `The VAT ID ${claimedVatId} could not be validated — VIES was unreachable.`;
    }
  }
  const taxCase = classify({
    destination: country,
    homeCountry: settings.homeCountry,
    ossRegistered: settings.ossRegistered,
    hasValidVatId
  });
  if (vatIdProblem && EU_COUNTRIES.has(country) && country !== settings.homeCountry) {
    return {
      taxCase,
      vatScope: settings[SCOPE_FIELD_FOR_CASE[taxCase]],
      country,
      hold: {
        reason: "vat_id_unvalidated",
        detail: `${vatIdProblem} Reverse charge requires an ID that is valid at the time of supply, so this order was not booked. Book it with ${settings.homeCountry} VAT, or hold it until the customer supplies a valid ID.`
      }
    };
  }
  const vatScope = settings[SCOPE_FIELD_FOR_CASE[taxCase]];
  if (!vatScope) {
    return {
      taxCase,
      vatScope: null,
      country,
      hold: {
        reason: "vat_scope_unconfigured",
        detail: `No Steuersachverhalt is configured for "${TAX_CASE_LABEL[taxCase]}". Choose one in Settings → Tax mapping, then reprocess this order.`
      }
    };
  }
  let accounts;
  try {
    accounts = await resolveRevenueAccounts(shop, {
      country,
      vatScope,
      servicesRenderedDate
    });
  } catch (err) {
    return {
      taxCase,
      vatScope,
      country,
      hold: {
        reason: "revenue_account_lookup_failed",
        detail: `Scopevisio could not be asked which Erlöskonto applies to "${TAX_CASE_LABEL[taxCase]}" for ${country}: ${err.message}`
      }
    };
  }
  const account = pickRevenueAccount(accounts, country);
  if (!account) {
    return {
      taxCase,
      vatScope,
      country,
      hold: {
        reason: "no_revenue_account",
        detail: `Your Steuermatrix has no active Erlöskonto for "${TAX_CASE_LABEL[taxCase]}" and destination ${country} on ${servicesRenderedDate.toLocaleDateString("de-DE")}. Add one in Scopevisio, then reprocess.`
      }
    };
  }
  return {
    taxCase,
    vatScope,
    country,
    account: account.accountNumber,
    vatKey: account.vatKey,
    reverseCharge: account.reverseCharge ?? false
  };
}
async function validateVatId(shop, vatId, opts = {}) {
  const maxAge = opts.maxAgeMs ?? 24 * 60 * 60 * 1e3;
  const previous = await prisma.vatIdCheck.findFirst({
    where: { shop, vatId },
    orderBy: { checkedAt: "desc" }
  });
  if (previous && Date.now() - previous.checkedAt.getTime() < maxAge) {
    return { valid: previous.valid, reachable: true, checkedAt: previous.checkedAt };
  }
  const countryCode = vatId.slice(0, 2);
  const number = vatId.slice(2);
  try {
    const res = await fetch(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ countryCode, vatNumber: number }),
        signal: AbortSignal.timeout(1e4)
      }
    );
    if (!res.ok) {
      return { valid: false, reachable: false, checkedAt: /* @__PURE__ */ new Date() };
    }
    const body = await res.json();
    const record = await prisma.vatIdCheck.create({
      data: {
        shop,
        vatId,
        valid: Boolean(body.valid),
        detail: body.userError ?? null
      }
    });
    return { valid: record.valid, reachable: true, checkedAt: record.checkedAt };
  } catch {
    return { valid: false, reachable: false, checkedAt: /* @__PURE__ */ new Date() };
  }
}
async function syncOrder(shop, order) {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  if (!settings) {
    return { state: "skipped", reason: "not_configured" };
  }
  if (!settings.syncEnabled) {
    await recordSkip(shop, order, "sync_disabled");
    return { state: "skipped", reason: "sync_disabled" };
  }
  const existing = await prisma.orderSync.findUnique({
    where: { shop_orderGid: { shop, orderGid: order.id } }
  });
  if ((existing == null ? void 0 : existing.state) === "booked") {
    await logEvent(shop, {
      event: "order.duplicate_ignored",
      orderGid: order.id,
      message: `Order ${order.name ?? order.id} is already booked as ${existing.documentNumber}; nothing to do.`
    });
    return { state: "booked", documentNumber: existing.documentNumber };
  }
  if ((existing == null ? void 0 : existing.state) === "declined") {
    return { state: "skipped", reason: "declined_by_user" };
  }
  if ((existing == null ? void 0 : existing.state) === "exported") {
    return { state: "skipped", reason: "already_exported" };
  }
  if ((existing == null ? void 0 : existing.state) === "ready_to_export") {
    return { state: "skipped", reason: "already_queued" };
  }
  if ((existing == null ? void 0 : existing.state) === "processing") {
    return { state: "skipped", reason: "already_processing" };
  }
  const row = await prisma.orderSync.upsert({
    where: { shop_orderGid: { shop, orderGid: order.id } },
    create: {
      shop,
      orderGid: order.id,
      orderName: order.name ?? null,
      orderNumber: order.orderNumber ? String(order.orderNumber) : null,
      state: "processing",
      attempts: 1,
      lastTriedAt: /* @__PURE__ */ new Date()
    },
    update: {
      state: "processing",
      attempts: { increment: 1 },
      lastTriedAt: /* @__PURE__ */ new Date(),
      reason: null,
      detail: null
    }
  });
  try {
    const ctx = await scopevisioContext(shop);
    const documentDate = order.processedAt ? new Date(order.processedAt) : order.createdAt ? new Date(order.createdAt) : /* @__PURE__ */ new Date();
    const treatment = await determineTaxTreatment(
      shop,
      order,
      settings,
      documentDate
    );
    if (treatment.hold) {
      return hold(shop, order.id, treatment.hold.reason, treatment.hold.detail, {
        vatScopeUsed: treatment.vatScope,
        countryUsed: treatment.country
      });
    }
    const customer = await upsertCustomer(ctx, order, settings);
    const draft = buildDraft(
      order,
      treatment,
      documentDate,
      customer.contactId,
      customer.personalAccount ?? null
    );
    await prisma.orderSync.update({
      where: { id: row.id },
      data: {
        contactId: customer.contactId,
        personalAccount: customer.personalAccount ?? null,
        vatScopeUsed: treatment.vatScope,
        countryUsed: treatment.country,
        resolvedAccount: treatment.account ?? null,
        resolvedVatKey: treatment.vatKey ?? null,
        // Keep the finished draft: if the document import fails, the order can
        // still be delivered through the CSV export rather than being lost.
        draftJson: JSON.stringify(draft)
      }
    });
    if (customer.reviewNote) {
      await logEvent(shop, {
        level: "warn",
        event: "contact.possible_duplicate",
        orderGid: order.id,
        message: customer.reviewNote
      });
    }
    if (settings.deliveryMode === "csv") {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: {
          state: "ready_to_export",
          reason: "ready_to_export",
          detail: "Ready to import. Download the CSV on the Export page and import it in Scopevisio under Abrechnung → Abrechnungsbelege.",
          shopifyTaxCents: order.totalTaxCents ?? null
        }
      });
      await logEvent(shop, {
        event: "invoice.ready_to_export",
        orderGid: order.id,
        message: `Order ${order.name ?? order.id} prepared for export (${treatment.taxCase}, ${treatment.country}, account ${treatment.account ?? "-"}).`,
        data: {
          taxCase: treatment.taxCase,
          country: treatment.country,
          account: treatment.account,
          vatKey: treatment.vatKey,
          contactId: customer.contactId
        }
      });
      return {
        state: "ready_to_export",
        documentNumber: null
      };
    }
    const { documentNumber } = await createInvoice(
      ctx,
      {
        order,
        contactId: customer.contactId,
        personalAccount: customer.personalAccount,
        treatment,
        documentDate,
        externalReference: order.id,
        deriveFromProduct: settings.copyVatFromProduct
      },
      {
        template: settings.documentTemplate,
        copyProductFields: settings.copyAccountsFromProduct
      }
    );
    if (!documentNumber) {
      return hold(
        shop,
        order.id,
        "no_document_number",
        "Scopevisio accepted the import but returned no document number, so the invoice could not be posted. Check the Faktura list in Scopevisio before reprocessing.",
        { vatScopeUsed: treatment.vatScope, countryUsed: treatment.country }
      );
    }
    await prisma.orderSync.update({
      where: { id: row.id },
      data: { documentNumber }
    });
    const shopifyTaxCents = order.totalTaxCents ?? null;
    const erpTaxCents = await getInvoiceTaxCents(ctx, documentNumber);
    if (shopifyTaxCents !== null && erpTaxCents !== null && Math.abs(shopifyTaxCents - erpTaxCents) > settings.taxToleranceCents) {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: { shopifyTaxCents, erpTaxCents }
      });
      return hold(
        shop,
        order.id,
        "tax_mismatch",
        `Shopify calculated ${fmt(shopifyTaxCents)} VAT, Scopevisio calculated ${fmt(erpTaxCents)} for the "${TAX_CASE_LABEL[treatment.taxCase]}" case in ${treatment.country}. Document ${documentNumber} was created but NOT posted. Resolve the difference, then either post it in Scopevisio or accept it here.`,
        { vatScopeUsed: treatment.vatScope, countryUsed: treatment.country }
      );
    }
    if (!settings.autoPost) {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: {
          state: "held",
          reason: "awaiting_manual_post",
          detail: `Invoice ${documentNumber} was created and checked but not posted, because automatic posting is switched off. Review it and post it when you are ready.`,
          shopifyTaxCents,
          erpTaxCents
        }
      });
      await logEvent(shop, {
        event: "invoice.created_unposted",
        orderGid: order.id,
        message: `Created invoice ${documentNumber} (automatic posting is off).`
      });
      return {
        state: "held",
        reason: "awaiting_manual_post",
        detail: `Invoice ${documentNumber} created, not posted.`
      };
    }
    await postInvoice(ctx, documentNumber);
    await prisma.orderSync.update({
      where: { id: row.id },
      data: {
        state: "booked",
        reason: null,
        detail: null,
        shopifyTaxCents,
        erpTaxCents
      }
    });
    await logEvent(shop, {
      event: "invoice.posted",
      orderGid: order.id,
      message: `Order ${order.name ?? order.id} booked as invoice ${documentNumber}.`,
      data: {
        documentNumber,
        taxCase: treatment.taxCase,
        country: treatment.country,
        contactId: customer.contactId
      }
    });
    return { state: "booked", documentNumber };
  } catch (err) {
    const actionable = err instanceof ScopevisioError && err.merchantActionable;
    const message = err instanceof Error ? err.message : "Unexpected error during sync.";
    return hold(
      shop,
      order.id,
      actionable ? "scopevisio_rejected" : "sync_error",
      message,
      {},
      actionable ? "warn" : "error"
    );
  }
}
async function hold(shop, orderGid, reason, detail, extra = {}, level = "warn") {
  await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: { state: "held", reason, detail, ...extra }
  });
  await logEvent(shop, {
    level,
    event: `order.held.${reason}`,
    orderGid,
    message: detail
  });
  return { state: "held", reason, detail };
}
async function recordSkip(shop, order, reason) {
  await prisma.orderSync.upsert({
    where: { shop_orderGid: { shop, orderGid: order.id } },
    create: {
      shop,
      orderGid: order.id,
      orderName: order.name ?? null,
      state: "pending",
      reason,
      detail: "Sync is switched off, so this order was recorded but not sent to Scopevisio. Enable sync and reprocess to book it."
    },
    update: {}
  });
}
function fmt(cents) {
  return (cents / 100).toFixed(2);
}
async function heldOrders(shop, limit = 100) {
  return prisma.orderSync.findMany({
    where: { shop, state: { in: ["held", "pending"] } },
    orderBy: { createdAt: "desc" },
    take: limit
  });
}
async function orderCounts(shop) {
  const rows = await prisma.orderSync.groupBy({
    by: ["state"],
    where: { shop },
    _count: { _all: true }
  });
  const counts = {
    booked: 0,
    held: 0,
    declined: 0,
    pending: 0,
    processing: 0,
    ready_to_export: 0,
    exported: 0
  };
  for (const row of rows) counts[row.state] = row._count._all;
  return counts;
}
async function declineOrder(shop, orderGid, by, note) {
  const row = await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: {
      state: "declined",
      resolvedBy: by,
      resolvedAt: /* @__PURE__ */ new Date(),
      resolveNote: note
    }
  });
  await logEvent(shop, {
    level: "warn",
    event: "order.declined",
    orderGid,
    message: `Declined by ${by}: ${note}`
  });
  return row;
}
async function requeueOrder(shop, orderGid) {
  const row = await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: { state: "pending", reason: null, detail: null }
  });
  await logEvent(shop, {
    event: "order.requeued",
    orderGid,
    message: "Queued for reprocessing."
  });
  return row;
}
const action$7 = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    const order = mapOrder(payload);
    if (!order.id) {
      await logEvent(shop, {
        level: "error",
        event: "webhook.malformed",
        message: `${topic} arrived without an order id; nothing was booked.`
      });
      return new Response();
    }
    await syncOrder(shop, order);
  } catch (err) {
    await logEvent(shop, {
      level: "error",
      event: "webhook.failed",
      message: `${topic} could not be processed: ${err instanceof Error ? err.message : String(err)}`
    });
  }
  return new Response();
};
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$7
}, Symbol.toStringTag, { value: "Module" }));
const action$6 = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);
  await prisma.$transaction([
    prisma.scopevisioConnection.deleteMany({ where: { shop } }),
    prisma.masterDataCache.deleteMany({ where: { shop } }),
    prisma.vatIdCheck.deleteMany({ where: { shop } }),
    prisma.orderSync.deleteMany({ where: { shop } }),
    prisma.syncEvent.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } })
  ]);
  return new Response();
};
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$6
}, Symbol.toStringTag, { value: "Module" }));
const Polaris$1 = /* @__PURE__ */ JSON.parse('{"Avatar":{"label":"Avatar","labelWithInitials":"Avatar mit Initialen {initials}"},"Autocomplete":{"spinnerAccessibilityLabel":"Wird geladen","ellipsis":"{content} …"},"Badge":{"PROGRESS_LABELS":{"incomplete":"Unvollständig","partiallyComplete":"Teilweise abgeschlossen","complete":"Abgeschlossen"},"TONE_LABELS":{"info":"Info","success":"Erfolg","warning":"Warnung","attention":"Achtung","new":"Neu","critical":"Kritisch","readOnly":"Schreibgeschützt","enabled":"Aktiviert"},"progressAndTone":"{toneLabel} {progressLabel}"},"Banner":{"dismissButton":"Benachrichtigung verwerfen"},"Button":{"spinnerAccessibilityLabel":"Wird geladen"},"Common":{"checkbox":"Kontrollkästchen","undo":"Rückgängig machen","cancel":"Abbrechen","clear":"Löschen","close":"Schließen","submit":"Senden","more":"Mehr"},"ContextualSaveBar":{"save":"Speichern","discard":"Verwerfen"},"DataTable":{"sortAccessibilityLabel":"von {direction} sortieren nach","navAccessibilityLabel":"Tabelle eine Spalte nach {direction} scrollen","totalsRowHeading":"Gesamt","totalRowHeading":"Gesamtsumme"},"DatePicker":{"previousMonth":"Vormonat anzeigen, {previousMonthName} {showPreviousYear}","nextMonth":"Nächsten Monat anzeigen, {nextMonth} {nextYear}","today":"Heute ","months":{"january":"Januar","february":"Februar","march":"März","april":"April","may":"Mai","june":"Juni","july":"Juli","august":"August","september":"September","october":"Oktober","november":"November","december":"Dezember"},"daysAbbreviated":{"monday":"Mo","tuesday":"Di","wednesday":"Mi","thursday":"Do","friday":"Fr","saturday":"Sa","sunday":"So"},"days":{"monday":"Montag","tuesday":"Dienstag","wednesday":"Mittwoch","thursday":"Donnerstag","friday":"Freitag","saturday":"Samstag","sunday":"Sonntag"},"start":"Beginn des Bereichs","end":"Ende des Bereichs"},"DiscardConfirmationModal":{"title":"Alle nicht gespeicherten Änderungen verwerfen","message":"Wenn du Änderungen verwirfst, werden alle Änderungen gelöscht, die du seit dem letzten Speichern vorgenommen hast.","primaryAction":"Änderungen verwerfen","secondaryAction":"Weiter bearbeiten"},"DropZone":{"errorOverlayTextFile":"Der Dateityp ist nicht gültig","errorOverlayTextImage":"Der Bildtyp ist nicht gültig","single":{"overlayTextFile":"Datei zum Hochladen ablegen","overlayTextImage":"Bild zum Hochladen ablegen","actionTitleFile":"Datei hinzufügen","actionTitleImage":"Bild hinzufügen","actionHintFile":"oder Datei zum Hochladen ablegen","actionHintImage":"oder Bild zum Hochladen ablegen","labelFile":"Datei hochladen","labelImage":"Bild hochladen","overlayTextVideo":"Video zum Hochladen ablegen","actionTitleVideo":"Video hinzufügen","actionHintVideo":"oder Video zum Hochladen ablegen","labelVideo":"Video hochladen"},"allowMultiple":{"overlayTextFile":"Dateien zum Hochladen ablegen","overlayTextImage":"Bilder zum Hochladen ablegen","actionTitleFile":"Dateien hinzufügen","actionTitleImage":"Bilder hinzufügen","actionHintFile":"oder Dateien zum Hochladen ablegen","actionHintImage":"oder Bilder zum Hochladen ablegen","labelFile":"Dateien hochladen","labelImage":"Bilder hochladen","overlayTextVideo":"Videos zum Hochladen ablegen","actionTitleVideo":"Videos hinzufügen","actionHintVideo":"oder Videos zum Hochladen ablegen","labelVideo":"Videos hochladen"},"errorOverlayTextVideo":"Der Videotyp ist nicht gültig"},"EmptySearchResult":{"altText":"Leere Suchergebnisse"},"Frame":{"skipToContent":"Direkt zum Inhalt","Navigation":{"closeMobileNavigationLabel":"Navigation schließen"},"navigationLabel":"Navigation"},"ActionMenu":{"RollupActions":{"rollupButton":"Aktionen anzeigen"},"Actions":{"moreActions":"Weitere Aktionen"}},"Filters":{"moreFilters":"Weitere Filter","filter":"{resourceName} filtern","noFiltersApplied":"Keine Filter angewendet","cancel":"Abbrechen","done":"Fertig","clearAllFilters":"Alle Filter löschen","clear":"Löschen","clearLabel":"{filterName} löschen","moreFiltersWithCount":"Weitere Filter ({count})","addFilter":"Filter hinzufügen","clearFilters":"Alles löschen","searchInView":"in: {viewName}"},"Modal":{"iFrameTitle":"Text-Markup","modalWarning":"Diese erforderlichen Eigenschaften fehlen im Modus: {missingProps}"},"Pagination":{"previous":"Zurück","next":"Weiter","pagination":"Seitennummerierung"},"ProgressBar":{"negativeWarningMessage":"Werte, die an die Statusanzeige übergeben werden, sollten nicht negativ sein. {progress} wird auf 0 zurückgesetzt.","exceedWarningMessage":"Werte, die an die Statusanzeige übergeben werden, sollten 100 nicht überschreiten. {progress} wird auf 100 gesetzt."},"ResourceList":{"sortingLabel":"Sortieren nach","defaultItemSingular":"Artikel","defaultItemPlural":"Artikel","showing":"{itemsCount} {resource} werden angezeigt","loading":"{resource} wird geladen","selected":"{selectedItemsCount} ausgewählt","allItemsSelected":"Alle {itemsLength}+ {resourceNamePlural} in deinem Shop wurden ausgewählt","selectAllItems":"Wähle alle {itemsLength}+ {resourceNamePlural} in deinem Shop aus","emptySearchResultTitle":"Keine {resourceNamePlural} gefunden","emptySearchResultDescription":"Versuche, die Filter oder den Suchbegriff zu ändern","selectButtonText":"Auswählen","a11yCheckboxDeselectAllSingle":"Auswahl für {resourceNameSingular} aufheben","a11yCheckboxSelectAllSingle":"{resourceNameSingular} auswählen","a11yCheckboxDeselectAllMultiple":"Auswahl für alle {itemsLength} {resourceNamePlural} aufheben","a11yCheckboxSelectAllMultiple":"Alle {itemsLength} {resourceNamePlural} auswählen","Item":{"actionsDropdownLabel":"Aktionen für {accessibilityLabel}","actionsDropdown":"Dropdown-Liste mit Aktionen","viewItem":"Details für {itemName} anzeigen"},"BulkActions":{"actionsActivatorLabel":"Aktionen","moreActionsActivatorLabel":"Weitere Aktionen"},"showingTotalCount":"{itemsCount} von {totalItemsCount} {resource} werden angezeigt","allFilteredItemsSelected":"Alle {itemsLength}+ {resourceNamePlural} in diesem Filter wurden ausgewählt","selectAllFilteredItems":"Alle {itemsLength} und {resourceNamePlural} in diesem Filter auswählen"},"SkeletonPage":{"loadingLabel":"Seite wird geladen"},"Tabs":{"toggleTabsLabel":"Weitere Ansichten","newViewAccessibilityLabel":"Neue Ansicht erstellen","newViewTooltip":"Ansicht erstellen","Tab":{"rename":"Ansicht umbenennen","duplicate":"Ansicht duplizieren","edit":"Ansicht bearbeiten","editColumns":"Spalten bearbeiten","delete":"Ansicht löschen","copy":"Kopie von {name}","deleteModal":{"title":"Ansicht löschen?","description":"Diese Aktion kann nicht rückgängig gemacht werden. Die Ansicht \\"{viewName}\\" wird nicht länger in deinem Adminbereich zur Verfügung stehen.","cancel":"Abbrechen","delete":"Ansicht löschen"}},"RenameModal":{"title":"Ansicht umbenennen","label":"Name","cancel":"Abbrechen","create":"Speichern","errors":{"sameName":"Eine Ansicht mit diesem Namen ist bereits vorhanden. Bitte wähle einen anderen Namen aus."}},"DuplicateModal":{"title":"Ansicht duplizieren","label":"Name","cancel":"Abbrechen","create":"Ansicht erstellen","errors":{"sameName":"Eine Ansicht mit diesem Namen ist bereits vorhanden. Bitte wähle einen anderen Namen aus."}},"CreateViewModal":{"title":"Neue Ansicht erstellen","label":"Name","cancel":"Abbrechen","create":"Ansicht erstellen","errors":{"sameName":"Eine Ansicht mit diesem Namen ist bereits vorhanden. Bitte wähle einen anderen Namen aus."}}},"Tag":{"ariaLabel":"{children} entfernen"},"TextField":{"characterCount":"{count} Zeichen","characterCountWithMaxLength":"{count} von {limit} Zeichen verwendet"},"TopBar":{"toggleMenuLabel":"Menü ein/aus","SearchField":{"clearButtonLabel":"Löschen","search":"Suchen"}},"MediaCard":{"popoverButton":"Aktionen","dismissButton":"Ignorieren"},"VideoThumbnail":{"playButtonA11yLabel":{"default":"Video abspielen","defaultWithDuration":"Video mit einer Länge von {duration} abspielen","duration":{"hours":{"other":{"only":"{hourCount} Stunden","andMinutes":"{hourCount} Stunden und {minuteCount} Minuten","andMinute":"{hourCount} Stunden und {minuteCount} Minute","minutesAndSeconds":"{hourCount} Stunden, {minuteCount} Minuten und {secondCount} Sekunden","minutesAndSecond":"{hourCount} Stunden, {minuteCount} Minuten und {secondCount} Sekunde","minuteAndSeconds":"{hourCount} Stunden, {minuteCount} Minute und {secondCount} Sekunden","minuteAndSecond":"{hourCount} Stunden, {minuteCount} Minute und {secondCount} Sekunde","andSeconds":"{hourCount} Stunden und {secondCount} Sekunden","andSecond":"{hourCount} Stunden und {secondCount} Sekunde"},"one":{"only":"{hourCount} Stunde","andMinutes":"{hourCount} Stunde und {minuteCount} Minuten","andMinute":"{hourCount} Stunde und {minuteCount} Minute","minutesAndSeconds":"{hourCount} Stunde, {minuteCount} Minuten und {secondCount} Sekunden","minutesAndSecond":"{hourCount} Stunde, {minuteCount} Minuten und {secondCount} Sekunde","minuteAndSeconds":"{hourCount} Stunde, {minuteCount} Minute und {secondCount} Sekunden","minuteAndSecond":"{hourCount} Stunde, {minuteCount} Minute und {secondCount} Sekunde","andSeconds":"{hourCount} Stunde und {secondCount} Sekunden","andSecond":"{hourCount} Stunde und {secondCount} Sekunde"}},"minutes":{"other":{"only":"{minuteCount} Minuten","andSeconds":"{minuteCount} Minuten und {secondCount} Sekunden","andSecond":"{minuteCount} Minuten und {secondCount} Sekunde"},"one":{"only":"{minuteCount} Minute","andSeconds":"{minuteCount} Minute und {secondCount} Sekunden","andSecond":"{minuteCount} Minute und {secondCount} Sekunde"}},"seconds":{"other":"{secondCount} Sekunden","one":"{secondCount} Sekunde"}}}},"Loading":{"label":"Seiten-Ladeleiste"},"TooltipOverlay":{"accessibilityLabel":"Tooltip: {label}"},"IndexProvider":{"defaultItemSingular":"Artikel","defaultItemPlural":"Artikel","allItemsSelected":"Alle {itemsLength}+ {resourceNamePlural} wurden ausgewählt","selected":"{selectedItemsCount} ausgewählt","a11yCheckboxDeselectAllSingle":"Auswahl für {resourceNameSingular} aufheben","a11yCheckboxSelectAllSingle":"{resourceNameSingular} auswählen","a11yCheckboxDeselectAllMultiple":"Auswahl für alle {itemsLength} {resourceNamePlural} aufheben","a11yCheckboxSelectAllMultiple":"Alle {itemsLength} {resourceNamePlural} auswählen"},"IndexTable":{"emptySearchTitle":"Keine {resourceNamePlural} gefunden","emptySearchDescription":"Versuche, die Filter oder den Suchbegriff zu ändern","onboardingBadgeText":"Neu","resourceLoadingAccessibilityLabel":"{resourceNamePlural} werden geladen ...","selectAllLabel":"Alle {resourceNamePlural} auswählen","selected":"{selectedItemsCount} ausgewählt","undo":"Rückgängig machen","selectAllItems":"Alle {itemsLength}+ {resourceNamePlural} auswählen","selectItem":"{resourceName} auswählen","selectButtonText":"Auswählen","sortAccessibilityLabel":"von {direction} sortieren nach"},"Page":{"Header":{"rollupActionsLabel":"Aktionen für {title} anzeigen","pageReadyAccessibilityLabel":"{title}. Diese Seite ist bereit"}},"FullscreenBar":{"back":"Zurück","accessibilityLabel":"Vollbildmodus beenden"},"FilterPill":{"clear":"Löschen","unsavedChanges":"Nicht gespeicherte Änderungen – {label}"},"IndexFilters":{"searchFilterTooltip":"Suchen und filtern","searchFilterTooltipWithShortcut":"Suchen und filtern (F)","searchFilterAccessibilityLabel":"Ergebnisse suchen und filtern","sort":"Ergebnisse sortieren","addView":"Eine neue Ansicht hinzufügen","newView":"Benutzerdefinierte Suche","SortButton":{"ariaLabel":"Ergebnisse sortieren","tooltip":"Sortieren","title":"Sortieren nach","sorting":{"asc":"Aufsteigend","desc":"Absteigend","az":"A–Z","za":"Z–A"}},"UpdateButtons":{"cancel":"Abbrechen","update":"Aktualisieren","save":"Speichern","saveAs":"Speichern unter","modal":{"title":"Ansicht speichern als","label":"Name","sameName":"Eine Ansicht mit diesem Namen ist bereits vorhanden. Bitte wähle einen anderen Namen aus.","save":"Speichern","cancel":"Abbrechen"}},"EditColumnsButton":{"tooltip":"Spalten bearbeiten","accessibilityLabel":"Reihenfolge und Sichtbarkeit der Tabellenspalten anpassen"}},"ActionList":{"SearchField":{"clearButtonLabel":"Löschen","search":"Suchen","placeholder":"Aktionen durchsuchen"}}}');
const polarisDe = {
  Polaris: Polaris$1
};
const polarisStyles = "/assets/styles-CV7GIAUv.css";
const LOCALES = ["de", "en"];
const DEFAULT_LOCALE = "de";
function resolveLocale(input) {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split("-")[0];
  return LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}
const de = {
  // --- navigation ---
  "nav.overview": "Übersicht",
  "nav.connection": "Verbindung",
  "nav.mapping": "Zuordnung",
  "nav.orders": "Aufträge",
  "nav.export": "Export",
  "nav.journal": "Protokoll",
  // --- overview ---
  "overview.title": "Scopevisio ERP",
  "overview.subtitle.connected": "Shop-Aufträge werden nach {org} gebucht",
  "overview.subtitle.disconnected": "Noch nicht verbunden",
  "overview.onboarding.title": "In drei Schritten einsatzbereit",
  "overview.onboarding.done": "Einrichtung abgeschlossen",
  "overview.onboarding.progress": "{done} von 3 erledigt",
  "overview.onboarding.dismiss": "Ausblenden",
  "overview.onboarding.step1": "Scopevisio-Organisation verbinden",
  "overview.onboarding.step1.detail": "Melden Sie sich mit Ihren gewohnten Zugangsdaten an.",
  "overview.onboarding.step2": "Zuordnung zu Ihren Konten prüfen",
  "overview.onboarding.step2.detail": "Kundengruppen und je Steuerfall ein Steuersachverhalt — aus Ihren eigenen Stammdaten.",
  "overview.onboarding.step3": "Synchronisierung einschalten",
  "overview.onboarding.step3.detail": "Vorher wird nichts an Scopevisio übertragen.",
  "overview.step.done": "Erledigt",
  "overview.connection.broken": "Die Verbindung zu Scopevisio funktioniert nicht",
  "overview.connection.broken.detail": "Aufträge werden zwischengespeichert, nicht verworfen. Nach dem Wiederverbinden werden sie verarbeitet.",
  "overview.connection.fix": "Verbindung reparieren",
  "overview.stat.booked": "Gebucht",
  "overview.stat.attention": "Erfordert Ihre Entscheidung",
  "overview.stat.toExport": "Bereit zum Export",
  "overview.stat.awaiting": "Wartet auf Bestätigung",
  "overview.mode.title": "Aktueller Modus",
  "overview.mode.syncOn": "Synchronisierung ein",
  "overview.mode.syncOff": "Synchronisierung aus",
  "overview.mode.autoPost": "Automatisches Buchen",
  "overview.mode.manualPost": "Nur anlegen, Sie buchen",
  "overview.mode.autoPost.detail": "Rechnungen werden nach erfolgreicher Steuerprüfung automatisch gebucht. Gebuchte Belege lassen sich nicht zurücknehmen.",
  "overview.mode.manualPost.detail": "Rechnungen werden angelegt und geprüft, das Buchen bleibt bei Ihnen. So fängt man am besten an.",
  "overview.export.ready": "{n} Rechnung(en) bereit zum Import",
  "overview.export.awaiting": "{n} Rechnung(en) warten auf Bestätigung",
  "overview.export.ready.detail": "Kunde, Debitorenkonto und Steuer sind bereits ermittelt. Datei herunterladen und in Scopevisio importieren.",
  "overview.export.awaiting.detail": "Ein heruntergeladener Stapel ist noch nicht bestätigt. Teilen Sie mit, ob der Import geklappt hat.",
  "overview.export.open": "Export öffnen",
  "overview.attention.title": "{n} Auftrag/Aufträge warten auf Sie",
  "overview.attention.detail": "Diese wurden nicht gebucht, weil etwas nicht automatisch entschieden werden konnte. Jeder Eintrag erklärt, was fehlt.",
  "overview.attention.open": "Prüfliste öffnen",
  "overview.activity.title": "Letzte Aktivität",
  "overview.activity.all": "Vollständiges Protokoll",
  "overview.footer.help": "Hilfe zu einem zurückgehaltenen Auftrag oder einer Einstellung?",
  "overview.footer.support": "Support kontaktieren",
  "overview.footer.privacy": "Datenschutzerklärung",
  // --- connection ---
  "conn.title": "Scopevisio-Verbindung",
  "conn.subtitle": "Woher diese App ihre Buchhaltungsdaten bezieht",
  "conn.status.notConnected": "Nicht verbunden",
  "conn.status.connected": "Verbunden",
  "conn.status.error": "Erfordert Aufmerksamkeit",
  "conn.status.unverified": "Ungeprüft",
  "conn.credentials": "Scopevisio-Zugangsdaten",
  "conn.credentials.detail": "Dieselben Zugangsdaten, mit denen Sie sich bei Scopevisio anmelden. Sie werden verschlüsselt gespeichert; sobald Scopevisio ein Refresh-Token ausstellt, wird das Passwort gelöscht. Den Zugriff können Sie jederzeit im Scopevisio-Kundenportal unter Schnittstelle (OpenScope) → API-Token widerrufen.",
  "conn.field.customer": "Kundennummer",
  "conn.field.customer.help": "Siebenstellig, aus Ihrem Scopevisio-Kundenportal.",
  "conn.field.organisation": "Organisation (optional)",
  "conn.field.organisation.help": "Können Sie leer lassen — Scopevisio ermittelt sie aus Kundennummer und Benutzer, und wir zeigen Ihnen, welche gewählt wurde. Nur nötig, wenn Ihr Benutzer zu mehreren Organisationen gehört.",
  "conn.field.username": "Benutzer (E-Mail)",
  "conn.field.username.help": "Wir empfehlen einen eigenen Schnittstellen-Benutzer statt eines persönlichen Zugangs.",
  "conn.field.password": "Passwort",
  "conn.field.password.help.new": "Verschlüsselt gespeichert und gelöscht, sobald ein Refresh-Token vorliegt.",
  "conn.field.password.help.existing": "Nur leer lassen, wenn Sie es nicht ändern — eine erneute Eingabe autorisiert die Verbindung neu.",
  "conn.field.baseUrl": "API-Basis-URL",
  "conn.field.baseUrl.help": "Nur ändern, wenn Scopevisio Ihnen eine andere Adresse genannt hat.",
  "conn.submit.new": "Verbinden",
  "conn.submit.existing": "Speichern und neu verbinden",
  "conn.health": "Verbindungsstatus",
  "conn.health.lastCheck": "Letzte Prüfung: {when}",
  "conn.health.never": "noch nie",
  "conn.health.check": "Jetzt prüfen",
  "conn.health.disconnect": "Verbindung trennen",
  "conn.health.disconnect.detail": "Das Trennen stoppt jede Synchronisierung. Bereits in Scopevisio gebuchte Belege bleiben unberührt — gebuchte Belege sind nach GoBD unveränderlich.",
  "conn.error.title": "Verbindung konnte nicht hergestellt werden",
  "conn.ok.title": "Verbunden",
  "conn.broken.title": "Die Verbindung funktioniert nicht mehr",
  "conn.broken.detail": "Aufträge werden zwischengespeichert, solange die Verbindung unterbrochen ist — es geht nichts verloren. Passwort erneut eingeben, um neu zu verbinden.",
  "conn.key.title": "Verschlüsselung der Zugangsdaten ist nicht konfiguriert",
  "conn.field.customer.required": "Bitte geben Sie Ihre Scopevisio-Kundennummer ein.",
  "conn.field.customer.format": "Die Kundennummer ist siebenstellig — Sie finden sie in Ihrem Scopevisio-Kundenportal.",
  "conn.field.username.required": "Bitte geben Sie den Benutzer an, mit dem sich die App anmeldet.",
  "conn.field.username.format": "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  "conn.field.password.required": "Bitte geben Sie das Passwort dieses Benutzers ein.",
  "conn.profiles.title": "Welche Scopevisio-Rechte braucht die Schnittstelle?",
  "conn.profiles.detail": "Der Benutzer benötigt mindestens: Kontakte (Bearbeiten), Datenimport (Bearbeiten), Angebote/Aufträge/Lieferscheine/Rechnungen (Bearbeiten) sowie Stammdaten · Steuermatrix (Anzeigen). Fehlt ein Recht, benennt die Fehlermeldung das fehlende Profil.",
  // --- mapping ---
  "map.title": "Zuordnung",
  "map.subtitle": "Wie Shopify-Daten in {org} zu Buchhaltungsdaten werden",
  "map.needConnection": "Bitte zuerst Scopevisio verbinden",
  "map.needConnection.detail": "Die Zuordnung wird aus Ihren eigenen Scopevisio-Stammdaten aufgebaut — dafür muss die Verbindung bestehen.",
  "map.saved": "Zuordnung gespeichert.",
  "map.saveFailed": "Zuordnung konnte nicht gespeichert werden.",
  "map.matrixError": "Steuermatrix konnte nicht gelesen werden",
  "map.matrixError.detail": "Dem Schnittstellen-Benutzer fehlt wahrscheinlich das Profil „Stammdaten · Steuermatrix (Anzeigen)“. Ohne Zugriff lassen sich keine Steuersachverhalte auswählen.",
  "map.notReady": "Noch nicht bereit zur Synchronisierung",
  "map.stale": "Angezeigt werden zwischengespeicherte Stammdaten — Scopevisio war gerade nicht erreichbar. Bitte vor dem Verlassen aktualisieren.",
  "map.sync": "Synchronisierung",
  "map.sync.enable": "Bezahlte Aufträge an Scopevisio senden",
  "map.sync.enable.help": "Solange dies aus ist, werden Aufträge hier erfasst, aber nichts an Scopevisio übertragen.",
  "map.sync.autoPost": "Belege automatisch buchen",
  "map.sync.autoPost.help": "Lassen Sie dies zunächst aus. Rechnungen werden dann angelegt und geprüft, das Buchen bleibt bei Ihnen — Buchen lässt sich nicht rückgängig machen.",
  "map.sync.autoPost.warning": "Gebuchte Belege sind nach GoBD unveränderlich. Eine Fehlbuchung lässt sich nur per Gutschrift korrigieren, nicht löschen. Schalten Sie dies ein, wenn die Prüfliste eine Weile leer geblieben ist.",
  "map.customers": "Kunden",
  "map.customers.detail": "Neue Kunden werden in Scopevisio als Debitoren angelegt. Kundengruppen werden automatisch erzeugt, falls sie noch nicht existieren — Sie können sie also frei benennen.",
  "map.customers.group": "Kundengruppe",
  "map.customers.group.help": "Für Käufer mit Shopify-Konto.",
  "map.customers.guestGroup": "Kundengruppe für Gäste",
  "map.customers.guestGroup.help": "Für Gastbestellungen, damit Sie sie im Debitorenstamm herausfiltern können.",
  "map.customers.range": "Debitoren-Nummernkreis",
  "map.customers.range.help": "Optional. Leer lassen für Ihren Standardkreis.",
  "map.customers.cpd": "Gäste über Conto pro Diverse buchen",
  "map.customers.cpd.help": "Empfohlen. Name und Adresse des Käufers stehen weiterhin auf dem Beleg, Ihr Debitorenstamm füllt sich aber nicht mit Einmalkunden.",
  "map.tax": "Steuersachverhalte",
  "map.tax.detail": "Die App rechnet die Umsatzsteuer nicht aus. Sie entscheidet, welcher dieser Fälle vorliegt, und fragt dann Scopevisio, welches Erlöskonto und welcher Steuerschlüssel dafür laut Ihrer Steuermatrix gelten — für dieses Zielland und dieses Datum. Ein nicht zugeordneter Fall führt dazu, dass passende Aufträge zurückgehalten statt geraten werden.",
  "map.tax.homeCountry": "Ihr Land der Besteuerung",
  "map.tax.homeCountry.help": "Zweistelliger Ländercode, z. B. DE.",
  "map.tax.tolerance": "Toleranz beim Steuervergleich (Cent)",
  "map.tax.tolerance.help": "Wie weit die von Shopify und von Scopevisio errechnete Steuer abweichen darf, bevor ein Auftrag zurückgehalten wird. Nur für Rundungen.",
  "map.tax.oss": "Wir sind für OSS registriert (oder über der 10.000-€-Grenze)",
  "map.tax.oss.help": "Legt fest, ob EU-Privatverkäufe Ihre inländische oder die Umsatzsteuer des Ziellandes tragen.",
  "map.tax.noScopes": "Für Ihre Scopevisio-Organisation wurden keine aktiven Steuersachverhalte geliefert. Bitte Stammdaten aktualisieren oder die Steuermatrix prüfen.",
  "map.delivery": "Wie Rechnungen nach Scopevisio gelangen",
  "map.delivery.label": "Übertragung",
  "map.delivery.csv": "CSV-Datei, Import in Scopevisio (empfohlen)",
  "map.delivery.api": "Direkter API-Import — derzeit nicht verfügbar",
  "map.delivery.help": "Per CSV entstehen echte Abrechnungsbelege, die die Faktura versenden kann. Sie importieren eine Datei je Stapel und ordnen die Spalten einmal zu.",
  "map.delivery.apiWarning": "Direkter Import funktioniert noch nicht",
  "map.delivery.apiWarning.detail": "Die Belegimport-Schnittstelle von Scopevisio erwartet ein nicht dokumentiertes XML-Format und weist Belege stillschweigend ab. Mit dieser Auswahl wird jeder Auftrag zurückgehalten statt übertragen. Bitte bei CSV bleiben, bis das geklärt ist.",
  "map.documents": "Belege",
  "map.documents.copyVat": "Steuerschlüssel und Steuersatz aus dem Scopevisio-Artikelstamm übernehmen",
  "map.documents.copyVat.help": "Empfohlen. Scopevisio ermittelt den Steuerschlüssel dann selbst — so bleibt eine Quelle der Wahrheit.",
  "map.documents.copyAccounts": "Erlöskonto aus dem Scopevisio-Artikelstamm übernehmen",
  "map.documents.copyAccounts.help": "Empfohlen, aus demselben Grund.",
  "map.documents.template": "PDF-Vorlage (optional)",
  "map.documents.template.help": "Name einer Scopevisio-Exportvorlage, wenn zu jeder Rechnung ein PDF erzeugt werden soll.",
  "map.save": "Zuordnung speichern",
  "map.masterData": "Stammdaten",
  "map.masterData.detail": "Steuersachverhalte und Erlöskonten werden aus Ihrer Scopevisio-Organisation gelesen und 30 Minuten zwischengespeichert. Nach Änderungen an der Steuermatrix aktualisieren — und mit der Prüfung sehen, welche Zielländer Ihre Steuermatrix tatsächlich buchen kann, bevor Sie die Synchronisierung einschalten.",
  "map.readiness.run": "Prüfen, was tatsächlich gebucht wird",
  "map.masterData.refresh": "Stammdaten aktualisieren",
  "map.readiness.title": "Wird das tatsächlich gebucht?",
  "map.readiness.count": "{ready} von {total} bereit",
  "map.readiness.fromOrders": "Geprüft gegen Ihre eigene Steuermatrix, mit den Ländern, in die Ihre Aufträge tatsächlich gehen.",
  "map.readiness.fromDefaults": "Geprüft gegen Ihre eigene Steuermatrix, mit typischen Zielländern, bis echte Aufträge vorliegen.",
  "map.readiness.ready": "Bereit",
  "map.readiness.willHold": "Wird zurückgehalten",
  "map.readiness.footnote": "„Wird zurückgehalten“ ist kein Fehler der App — es bedeutet, dass Ihre Steuermatrix für diese Fälle kein Konto vorsieht und deshalb nicht falsch gebucht wird.",
  "map.why.title": "Warum die Umsatzsteuer nicht von Shopify übernommen wird",
  "map.why.detail": "Eine Position mit 0 % kann eine innergemeinschaftliche Lieferung, ein Drittlandsexport, ein Reverse-Charge-Fall oder eine Kleinunternehmer-Regelung sein. Das sind vier verschiedene Steuersachverhalte, vier UStVA-Zeilen und vier Erlöskonten — der Rechtsgrund lässt sich aus der Zahl nicht zurückgewinnen. Der von Shopify berechnete Betrag dient daher nur als Gegenprüfung vor dem Buchen.",
  // --- orders ---
  "orders.title": "Aufträge mit Entscheidungsbedarf",
  "orders.subtitle": "{booked} gebucht · {waiting} offen · {declined} abgelehnt",
  "orders.check.title": "Shopify auf bezahlte Aufträge prüfen",
  "orders.check.detail": "Aufträge kommen normalerweise von selbst. Nutzen Sie dies, um Versäumtes nachzuholen — etwa während Scopevisio nicht erreichbar war.",
  "orders.check.button": "Jetzt prüfen",
  "orders.check.none": "Keine neuen bezahlten Aufträge seit der letzten Prüfung.",
  "orders.check.result": "{scanned} bezahlte(r) Auftrag/Aufträge gefunden — {prepared} vorbereitet, {held} mit Entscheidungsbedarf, {skipped} bereits erledigt.",
  "orders.empty": "Nichts offen",
  "orders.empty.detail": "Jeder Auftrag wurde entweder gebucht oder bewusst abgelehnt. Eine leere Liste bedeutet, dass den automatischen Buchungen zu trauen ist.",
  "orders.retry": "Erneut versuchen",
  "orders.decline": "Wird nicht gebucht",
  "orders.decline.why": "Warum nicht?",
  "orders.decline.why.help": "Wird für die Nachvollziehbarkeit im Protokoll vermerkt.",
  "orders.decline.confirm": "Bestätigen",
  "orders.decline.needReason": "Bitte begründen, warum dieser Auftrag nicht gebucht wird.",
  "orders.decline.done": "Vermerkt — dieser Auftrag wird nicht gebucht.",
  "orders.retry.gone": "Shopify liefert diesen Auftrag nicht mehr.",
  "orders.retry.prepared": "Vorbereitet — jetzt auf der Export-Seite.",
  "orders.tax.shopify": "Steuer laut Shopify",
  "orders.tax.erp": "Steuer laut Scopevisio",
  "orders.tax.diff": "Differenz",
  "orders.doc.unposted": "Scopevisio-Beleg {n} existiert, ist aber nicht gebucht.",
  "orders.attempts": "{n} Versuche.",
  // --- export ---
  "export.title": "Export nach Scopevisio",
  "export.subtitle": "Vorbereitete Rechnungen für {org}",
  "export.subtitle.plain": "Vorbereitete Rechnungen",
  "export.ready": "{n} Rechnung(en) bereit",
  "export.vatResolved": "Steuer ermittelt",
  "export.ready.detail": "Für jede davon ist der Kunde als Debitor angelegt und Erlöskonto sowie Steuerschlüssel sind aus Ihrer Steuermatrix ermittelt. Datei herunterladen, dann in Scopevisio unter Abrechnung → Abrechnungsbelege importieren. Die Spalten ordnen Sie einmal zu; das Ergebnis ist eine normale Faktura, die Sie versenden können.",
  "export.download": "CSV herunterladen ({n})",
  "export.download.note": "Mit dem Herunterladen gelten diese als exportiert und erscheinen nicht in der nächsten Datei — ein doppelter Import würde doppelte Rechnungen erzeugen.",
  "export.awaiting.title": "Wartet auf Ihre Bestätigung",
  "export.awaiting.detail": "Diese Stapel wurden heruntergeladen. Die App kann nicht sehen, ob Scopevisio den Import angenommen hat — teilen Sie es mit, damit die Nachvollziehbarkeit erhalten bleibt.",
  "export.confirm": "Erfolgreich importiert",
  "export.again": "Erneut herunterladen",
  "export.failed": "Import fehlgeschlagen",
  "export.failed.why": "Was ist schiefgelaufen?",
  "export.failed.why.help": "Wird im Protokoll vermerkt, und die Rechnungen gehen zurück in die Warteschlange.",
  "export.failed.confirm": "Zurück in die Warteschlange",
  "export.failed.needReason": "Bitte angeben, was beim Import schiefgelaufen ist.",
  "export.confirmed": "{n} Rechnung(en) als in Scopevisio gebucht markiert.",
  "export.returned": "{n} Rechnung(en) zurück in die Warteschlange gelegt.",
  "export.empty": "Nichts zu exportieren",
  "export.empty.detail": "Bezahlte Aufträge erscheinen hier, sobald die App sie vorbereitet hat. Fehlt etwas, sehen Sie unter Aufträge nach — vielleicht wartet einer auf eine Entscheidung.",
  "export.apiMode": "Übertragung steht auf direktem API-Import",
  "export.apiMode.detail": "Diese Seite gilt nur für den CSV-Modus. Der direkte Belegimport ist derzeit nicht verfügbar, daher werden Aufträge zurückgehalten. Bitte die Übertragung auf der Seite Zuordnung wieder auf CSV stellen.",
  "export.how": "So importieren Sie in Scopevisio",
  "export.how.1": "Scopevisio öffnen → Abrechnung → Abrechnungsbelege.",
  "export.how.2": "Import wählen und die heruntergeladene CSV auswählen.",
  "export.how.3": "Spalten zuordnen — die Überschriften verwenden bereits die Scopevisio-Feldnamen, meist ist es eins zu eins. Die Zuordnung wird gespeichert.",
  "export.how.4": "Die importierten Belege prüfen, dann hier bestätigen.",
  "export.how.note": "Die Datei ist semikolongetrennt mit deutschem Dezimalkomma und UTF-8-Kennzeichnung, öffnet also auch in Excel korrekt.",
  // --- journal ---
  "journal.title": "Protokoll",
  "journal.subtitle": "Alles, was die App getan hat, neueste zuerst. Einträge werden nie geändert oder gelöscht.",
  "journal.empty": "Noch nichts passiert",
  "journal.empty.detail": "Sobald Scopevisio verbunden und die Synchronisierung eingeschaltet ist, werden hier jede Buchung und jeder zurückgehaltene Beleg vermerkt.",
  // --- shared ---
  "common.notConfigured": "— nicht konfiguriert —",
  "common.save": "Speichern",
  "common.error": "Etwas ist schiefgelaufen.",
  "common.cancel": "Abbrechen"
};
const en = {
  "nav.overview": "Overview",
  "nav.connection": "Connection",
  "nav.mapping": "Mapping",
  "nav.orders": "Orders",
  "nav.export": "Export",
  "nav.journal": "Journal",
  "overview.title": "Scopevisio ERP",
  "overview.subtitle.connected": "Booking shop orders into {org}",
  "overview.subtitle.disconnected": "Not connected yet",
  "overview.onboarding.title": "Three steps to get started",
  "overview.onboarding.done": "You are set up",
  "overview.onboarding.progress": "{done} of 3 done",
  "overview.onboarding.dismiss": "Dismiss",
  "overview.onboarding.step1": "Connect your Scopevisio organisation",
  "overview.onboarding.step1.detail": "Sign in with the credentials you already use.",
  "overview.onboarding.step2": "Confirm how shop data maps onto your accounts",
  "overview.onboarding.step2.detail": "Customer groups and a Steuersachverhalt per tax case, from your own master data.",
  "overview.onboarding.step3": "Switch sync on",
  "overview.onboarding.step3.detail": "Nothing is sent to Scopevisio until you do.",
  "overview.step.done": "Done",
  "overview.connection.broken": "The Scopevisio connection is not working",
  "overview.connection.broken.detail": "Orders are queued, not lost. Reconnect and they will be processed.",
  "overview.connection.fix": "Fix the connection",
  "overview.stat.booked": "Booked",
  "overview.stat.attention": "Needs your decision",
  "overview.stat.toExport": "Ready to export",
  "overview.stat.awaiting": "Awaiting confirmation",
  "overview.mode.title": "Current mode",
  "overview.mode.syncOn": "Sync on",
  "overview.mode.syncOff": "Sync off",
  "overview.mode.autoPost": "Posting automatically",
  "overview.mode.manualPost": "Create only, you post",
  "overview.mode.autoPost.detail": "Invoices are posted automatically once the tax cross-check passes. Posted documents cannot be withdrawn.",
  "overview.mode.manualPost.detail": "Invoices are created and cross-checked, then left for you to post. This is the safe way to start.",
  "overview.export.ready": "{n} invoice(s) ready to import",
  "overview.export.awaiting": "{n} invoice(s) awaiting confirmation",
  "overview.export.ready.detail": "Customer, debitor account and VAT are already resolved. Download the file and import it in Scopevisio.",
  "overview.export.awaiting.detail": "A downloaded batch has not been confirmed yet. Tell the connector whether the import went through.",
  "overview.export.open": "Open Export",
  "overview.attention.title": "{n} order(s) waiting for you",
  "overview.attention.detail": "These were not booked because something could not be decided automatically. Each one explains what it needs.",
  "overview.attention.open": "Open the review queue",
  "overview.activity.title": "Latest activity",
  "overview.activity.all": "See the full journal",
  "overview.footer.help": "Need help with a held order or a Scopevisio setting?",
  "overview.footer.support": "Contact support",
  "overview.footer.privacy": "Privacy policy",
  "conn.title": "Scopevisio connection",
  "conn.subtitle": "Where this app gets its accounting data",
  "conn.status.notConnected": "Not connected",
  "conn.status.connected": "Connected",
  "conn.status.error": "Needs attention",
  "conn.status.unverified": "Unverified",
  "conn.credentials": "Scopevisio credentials",
  "conn.credentials.detail": "These are the same credentials you use to sign in to Scopevisio. They are encrypted before being stored, and once Scopevisio issues a refresh token the password is deleted. You can revoke access at any time from your Scopevisio customer portal under Schnittstelle (OpenScope) → API Token.",
  "conn.field.customer": "Customer number",
  "conn.field.customer.help": "Seven digits, from your Scopevisio customer portal.",
  "conn.field.organisation": "Organisation (optional)",
  "conn.field.organisation.help": "Leave blank — Scopevisio works it out from your customer number and user, and we show you which one it picked. Only fill this in if your user belongs to more than one organisation.",
  "conn.field.username": "User (e-mail)",
  "conn.field.username.help": "We recommend a dedicated integration user rather than a personal login.",
  "conn.field.password": "Password",
  "conn.field.password.help.new": "Stored encrypted, then discarded once a refresh token is issued.",
  "conn.field.password.help.existing": "Leave blank only if you are not changing it — re-entering it re-authorises the connection.",
  "conn.field.baseUrl": "API base URL",
  "conn.field.baseUrl.help": "Only change this if Scopevisio has given you a different endpoint.",
  "conn.submit.new": "Connect",
  "conn.submit.existing": "Save and reconnect",
  "conn.health": "Connection health",
  "conn.health.lastCheck": "Last checked: {when}",
  "conn.health.never": "never",
  "conn.health.check": "Check now",
  "conn.health.disconnect": "Disconnect",
  "conn.health.disconnect.detail": "Disconnecting stops all syncing. Documents already booked in Scopevisio are untouched — posted documents are immutable under GoBD.",
  "conn.error.title": "Could not connect",
  "conn.ok.title": "Connected",
  "conn.broken.title": "The connection stopped working",
  "conn.broken.detail": "Orders are queued while the connection is down — nothing is lost. Re-enter the password below to reconnect.",
  "conn.key.title": "Credential encryption is not configured",
  "conn.field.customer.required": "Enter your Scopevisio customer number.",
  "conn.field.customer.format": "This is seven digits — you will find it in your Scopevisio customer portal.",
  "conn.field.username.required": "Enter the user this app should sign in as.",
  "conn.field.username.format": "Enter a valid e-mail address.",
  "conn.field.password.required": "Enter the password for that user.",
  "conn.profiles.title": "Which Scopevisio permissions does the connector need?",
  "conn.profiles.detail": "The connector user needs at least: Kontakte (Bearbeiten), Datenimport (Bearbeiten), Angebote/Aufträge/Lieferscheine/Rechnungen (Bearbeiten), and Stammdaten · Steuermatrix (Anzeigen). If a sync fails with a permissions error, the message will name the profile that is missing.",
  "map.title": "Mapping",
  "map.subtitle": "How Shopify data becomes accounting data in {org}",
  "map.needConnection": "Connect Scopevisio first",
  "map.needConnection.detail": "The mapping is built from your own Scopevisio master data, so the connection has to exist before it can be configured.",
  "map.saved": "Mapping saved.",
  "map.saveFailed": "Could not save the mapping.",
  "map.matrixError": "Could not read your Steuermatrix",
  "map.matrixError.detail": "The connector user probably lacks the “Stammdaten · Steuermatrix (Anzeigen)” profile. Tax cases cannot be chosen until this works.",
  "map.notReady": "Not ready to sync yet",
  "map.stale": "Showing cached master data — Scopevisio could not be reached just now. Refresh before relying on these choices.",
  "map.sync": "Sync",
  "map.sync.enable": "Send paid orders to Scopevisio",
  "map.sync.enable.help": "While this is off, orders are still recorded here but nothing reaches Scopevisio.",
  "map.sync.autoPost": "Post documents automatically",
  "map.sync.autoPost.help": "Leave this off to begin with. Invoices are then created and checked but left for you to post — posting cannot be undone.",
  "map.sync.autoPost.warning": "Posted documents are immutable under GoBD. A wrong posting can only be corrected with a credit note, never deleted. Turn this on once the review queue has been empty for a while.",
  "map.customers": "Customers",
  "map.customers.detail": "New customers are created in Scopevisio as debitors. Customer groups are created automatically if they do not exist yet, so you can name them whatever suits your reporting.",
  "map.customers.group": "Customer group (Kundengruppe)",
  "map.customers.group.help": "For buyers with a Shopify account.",
  "map.customers.guestGroup": "Guest customer group",
  "map.customers.guestGroup.help": "For guest checkouts, so you can filter them out of your debitor master.",
  "map.customers.range": "Debitor number range (Nummernkreis)",
  "map.customers.range.help": "Optional. Leave empty to use your default range.",
  "map.customers.cpd": "Book guests against a Conto pro Diverse account",
  "map.customers.cpd.help": "Recommended. The buyer’s real name and address still appear on the document, but your debitor master does not fill up with one-off customers.",
  "map.tax": "Tax cases (Steuersachverhalte)",
  "map.tax.detail": "The connector does not calculate VAT. It decides which of these cases an order falls into, then asks Scopevisio which Erlöskonto and Steuerschlüssel your own Steuermatrix prescribes for that case, destination and date. Any case left unconfigured causes matching orders to be held rather than guessed at.",
  "map.tax.homeCountry": "Your country of taxation",
  "map.tax.homeCountry.help": "Two-letter country code, e.g. DE.",
  "map.tax.tolerance": "Tax comparison tolerance (cents)",
  "map.tax.tolerance.help": "How far Shopify’s VAT and Scopevisio’s may differ before an order is held. Rounding only.",
  "map.tax.oss": "We are registered for OSS (or above the €10,000 EU threshold)",
  "map.tax.oss.help": "Determines whether EU consumer sales carry your domestic VAT or the destination country’s.",
  "map.tax.noScopes": "No active tax cases were returned from your Scopevisio organisation. Refresh the master data, or check that your Steuermatrix is configured.",
  "map.delivery": "How invoices reach Scopevisio",
  "map.delivery.label": "Delivery",
  "map.delivery.csv": "CSV file, imported in Scopevisio (recommended)",
  "map.delivery.api": "Direct API import — not currently available",
  "map.delivery.help": "CSV produces real Abrechnungsbelege that the Faktura module can send. You import one file per batch and map the columns once.",
  "map.delivery.apiWarning": "Direct import does not work yet",
  "map.delivery.apiWarning.detail": "Scopevisio’s document-import endpoint accepts an XML format that is not documented, and it rejects documents silently. With this selected every order will be held instead of delivered. Use CSV until that is resolved.",
  "map.documents": "Documents",
  "map.documents.copyVat": "Take the tax key and rate from the Scopevisio product master",
  "map.documents.copyVat.help": "Recommended. Scopevisio then derives the Steuerschlüssel itself, which keeps one source of truth.",
  "map.documents.copyAccounts": "Take the revenue account from the Scopevisio product master",
  "map.documents.copyAccounts.help": "Recommended, for the same reason.",
  "map.documents.template": "PDF template (optional)",
  "map.documents.template.help": "Name of a Scopevisio export template, if you want a PDF generated with each invoice.",
  "map.save": "Save mapping",
  "map.masterData": "Master data",
  "map.masterData.detail": "Tax cases and revenue accounts are read from your Scopevisio organisation and cached for 30 minutes. Refresh after changing your Steuermatrix, and use the check to see which destinations it can actually book before you switch sync on.",
  "map.readiness.run": "Check what will actually book",
  "map.masterData.refresh": "Refresh master data",
  "map.readiness.title": "Will this actually book?",
  "map.readiness.count": "{ready} of {total} ready",
  "map.readiness.fromOrders": "Checked against your own Steuermatrix, using the countries your orders actually ship to.",
  "map.readiness.fromDefaults": "Checked against your own Steuermatrix, using representative destinations until real orders arrive.",
  "map.readiness.ready": "Ready",
  "map.readiness.willHold": "Will be held",
  "map.readiness.footnote": "A case marked “will be held” is not a fault in the connector — it means your Steuermatrix has nothing to book those orders to, so they are held rather than booked wrongly.",
  "map.why.title": "Why VAT is not read from Shopify",
  "map.why.detail": "A 0% line could be an intra-EU B2B supply, a third-country export, a reverse-charge supply or a small-business exemption. Those are four different Steuersachverhalte, four UStVA lines and four revenue accounts — the legal reason cannot be recovered from the number. So Shopify’s calculated tax is only ever used as a cross-check before posting.",
  "orders.title": "Orders needing a decision",
  "orders.subtitle": "{booked} booked · {waiting} waiting · {declined} declined",
  "orders.check.title": "Check Shopify for paid orders",
  "orders.check.detail": "Orders normally arrive on their own. Use this to pull in anything missed — for example while Scopevisio was unreachable.",
  "orders.check.button": "Check now",
  "orders.check.none": "No new paid orders since the last check.",
  "orders.check.result": "{scanned} paid order(s) found — {prepared} prepared, {held} need a decision, {skipped} already handled.",
  "orders.empty": "Nothing waiting",
  "orders.empty.detail": "Every order was either booked or deliberately declined. An empty queue means the automatic bookings can be trusted.",
  "orders.retry": "Try again",
  "orders.decline": "Will not be booked",
  "orders.decline.why": "Why not?",
  "orders.decline.why.help": "Recorded in the journal for the audit trail.",
  "orders.decline.confirm": "Confirm",
  "orders.decline.needReason": "Please say why this order will not be booked.",
  "orders.decline.done": "Recorded — this order will not be booked.",
  "orders.retry.gone": "Shopify no longer returns this order.",
  "orders.retry.prepared": "Prepared — it is now on the Export page.",
  "orders.tax.shopify": "Shopify VAT",
  "orders.tax.erp": "Scopevisio VAT",
  "orders.tax.diff": "Difference",
  "orders.doc.unposted": "Scopevisio document {n} exists but is not posted.",
  "orders.attempts": "Tried {n} times.",
  "export.title": "Export to Scopevisio",
  "export.subtitle": "Prepared invoices for {org}",
  "export.subtitle.plain": "Prepared invoices",
  "export.ready": "{n} invoice(s) ready",
  "export.vatResolved": "VAT resolved",
  "export.ready.detail": "Each of these has its customer set up as a debitor and its Erlöskonto and Steuerschlüssel already resolved from your Steuermatrix. Download the file, then in Scopevisio go to Abrechnung → Abrechnungsbelege and import it. You map the columns once; the result is a normal Faktura you can send.",
  "export.download": "Download CSV ({n})",
  "export.download.note": "Downloading marks these as exported so the next file will not contain them again — importing the same batch twice would create duplicate invoices.",
  "export.awaiting.title": "Waiting for your confirmation",
  "export.awaiting.detail": "These batches have been downloaded. The connector cannot see whether Scopevisio accepted the import, so tell it what happened — that is what keeps the audit trail honest.",
  "export.confirm": "Imported successfully",
  "export.again": "Download again",
  "export.failed": "Import failed",
  "export.failed.why": "What went wrong?",
  "export.failed.why.help": "Recorded in the journal, and the invoices go back in the queue.",
  "export.failed.confirm": "Return to queue",
  "export.failed.needReason": "Please say what went wrong with the import.",
  "export.confirmed": "{n} invoice(s) marked as booked in Scopevisio.",
  "export.returned": "{n} invoice(s) returned to the queue.",
  "export.empty": "Nothing to export",
  "export.empty.detail": "Paid orders appear here once the connector has prepared them. If you expected something, check the Orders page — an order may be waiting on a decision.",
  "export.apiMode": "Delivery mode is set to direct API import",
  "export.apiMode.detail": "This page only applies in CSV mode. Direct document import is not currently available, so orders will be held instead. Switch delivery back to CSV on the Mapping page.",
  "export.how": "How to import in Scopevisio",
  "export.how.1": "Open Scopevisio → Abrechnung → Abrechnungsbelege.",
  "export.how.2": "Choose Import and select the downloaded CSV.",
  "export.how.3": "Map the columns — the headers already use Scopevisio field names, so this is usually one-to-one. The mapping is saved for next time.",
  "export.how.4": "Check the imported Belege, then come back here and confirm.",
  "export.how.note": "The file is semicolon-separated with German decimal commas and a UTF-8 byte-order mark, so Excel opens it correctly too.",
  "journal.title": "Journal",
  "journal.subtitle": "Everything the connector did, newest first. Entries are never changed or removed.",
  "journal.empty": "Nothing has happened yet",
  "journal.empty.detail": "Once Scopevisio is connected and sync is on, every booking and every held document will be recorded here.",
  "common.notConfigured": "— not configured —",
  "common.save": "Save",
  "common.error": "Something went wrong.",
  "common.cancel": "Cancel"
};
const DICTIONARIES = {
  de,
  en
};
function translate(locale, key2, vars) {
  var _a2;
  const value = ((_a2 = DICTIONARIES[locale]) == null ? void 0 : _a2[key2]) ?? DICTIONARIES[DEFAULT_LOCALE][key2];
  if (!value) return key2;
  if (!vars) return value;
  return value.replace(
    /\{(\w+)\}/g,
    (match, name) => name in vars ? String(vars[name]) : match
  );
}
function makeT(locale) {
  return (key2, vars) => translate(locale, key2, vars);
}
const links$2 = () => [{ rel: "stylesheet", href: polarisStyles }];
const loader$c = async ({ params }) => {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }
  return { view: params.view ?? "overview" };
};
const t = makeT("de");
function Stat$1({ label, value, tone }) {
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "100", children: [
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: label }),
    /* @__PURE__ */ jsx(Text, { as: "p", variant: "heading2xl", tone, children: value })
  ] }) });
}
function Overview$1() {
  const steps = [
    { label: t("overview.onboarding.step1"), detail: t("overview.onboarding.step1.detail"), done: true },
    { label: t("overview.onboarding.step2"), detail: t("overview.onboarding.step2.detail"), done: true },
    { label: t("overview.onboarding.step3"), detail: t("overview.onboarding.step3.detail"), done: false }
  ];
  return /* @__PURE__ */ jsx(Page, { title: t("overview.title"), subtitle: t("overview.subtitle.connected", { org: "Simplify AG" }), children: /* @__PURE__ */ jsxs(Layout, { children: [
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
      /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("overview.onboarding.title") }),
        /* @__PURE__ */ jsx(Badge, { tone: "attention", children: t("overview.onboarding.progress", { done: 2 }) })
      ] }),
      /* @__PURE__ */ jsx(BlockStack, { gap: "300", children: steps.map((s, i) => /* @__PURE__ */ jsxs(InlineStack, { gap: "300", blockAlign: "start", children: [
        /* @__PURE__ */ jsx(Badge, { tone: s.done ? "success" : void 0, children: s.done ? t("overview.step.done") : String(i + 1) }),
        /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
          /* @__PURE__ */ jsx(Text, { as: "span", variant: "bodyMd", children: s.label }),
          /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: s.detail })
        ] })
      ] }, s.label)) }),
      /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { variant: "primary", children: t("overview.onboarding.step3") }) })
    ] }) }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(InlineGrid, { columns: { xs: 2, md: 4 }, gap: "400", children: [
      /* @__PURE__ */ jsx(Stat$1, { label: t("overview.stat.booked"), value: "128", tone: "success" }),
      /* @__PURE__ */ jsx(Stat$1, { label: t("overview.stat.attention"), value: "2", tone: "critical" }),
      /* @__PURE__ */ jsx(Stat$1, { label: t("overview.stat.toExport"), value: "6" }),
      /* @__PURE__ */ jsx(Stat$1, { label: t("overview.stat.awaiting"), value: "0" })
    ] }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
      /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("overview.mode.title") }),
        /* @__PURE__ */ jsxs(InlineStack, { gap: "200", children: [
          /* @__PURE__ */ jsx(Badge, { tone: "success", children: t("overview.mode.syncOn") }),
          /* @__PURE__ */ jsx(Badge, { tone: "info", children: t("overview.mode.manualPost") })
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t("overview.mode.manualPost.detail") })
    ] }) }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
      /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("overview.activity.title") }),
      /* @__PURE__ */ jsx(BlockStack, { gap: "200", children: [
        ["09.09.2026, 08:14:22", "Auftrag #1042 gebucht als Rechnung RE-2026-118."],
        ["09.09.2026, 08:11:05", "Scopevisio-Kontakt 101044 angelegt."],
        ["09.09.2026, 07:58:40", "6 Rechnung(en) als Stapel B-2026-09-09-a41f exportiert."]
      ].map(([when, msg]) => /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: when }),
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "bodySm", children: msg })
      ] }, when)) })
    ] }) }) })
  ] }) });
}
const SCOPE_OPTIONS = [
  { label: "— nicht konfiguriert —", value: "" },
  { label: "Inland (1)", value: "1" },
  { label: "Drittland (2)", value: "2" },
  { label: "IG Lieferung an Unternehmer mit USt-ID (16)", value: "16" },
  { label: "IG Leistung an Unternehmer mit USt-ID (17)", value: "17" }
];
function Mapping() {
  return /* @__PURE__ */ jsx(Page, { title: t("map.title"), subtitle: t("map.subtitle", { org: "Simplify AG" }), children: /* @__PURE__ */ jsx(Layout, { children: /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
    /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("map.tax") }),
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t("map.tax.detail") }),
    /* @__PURE__ */ jsxs(FormLayout, { children: [
      /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t("map.tax.homeCountry"),
            value: "DE",
            autoComplete: "off",
            helpText: t("map.tax.homeCountry.help"),
            onChange: () => {
            }
          }
        ),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t("map.tax.tolerance"),
            value: "2",
            type: "number",
            autoComplete: "off",
            helpText: t("map.tax.tolerance.help"),
            onChange: () => {
            }
          }
        )
      ] }),
      /* @__PURE__ */ jsx(
        Checkbox,
        {
          label: t("map.tax.oss"),
          checked: false,
          onChange: () => {
          },
          helpText: t("map.tax.oss.help")
        }
      ),
      /* @__PURE__ */ jsx(
        Select,
        {
          label: "Inland",
          options: SCOPE_OPTIONS,
          value: "1",
          onChange: () => {
          },
          helpText: "Aufträge innerhalb Ihres Landes der Besteuerung."
        }
      ),
      /* @__PURE__ */ jsx(
        Select,
        {
          label: "EU B2B — Reverse Charge",
          options: SCOPE_OPTIONS,
          value: "16",
          onChange: () => {
          },
          helpText: "Unternehmen in anderen EU-Staaten mit geprüfter USt-IdNr."
        }
      ),
      /* @__PURE__ */ jsx(
        Select,
        {
          label: "Drittlandsexport",
          options: SCOPE_OPTIONS,
          value: "2",
          onChange: () => {
          },
          helpText: "Lieferungen außerhalb der EU — in der Regel steuerfrei."
        }
      )
    ] })
  ] }) }) }) }) });
}
function Readiness() {
  const rows = [
    { ok: true, label: "Inland", scope: "Inland", dest: "DE → 8400 / U19" },
    {
      ok: false,
      label: "EU B2B — Reverse Charge",
      scope: "IG Lieferung an Unternehmer mit USt-ID",
      dest: "FR → kein aktives Erlöskonto",
      advice: "Ihre Steuermatrix enthält kein aktives Erlöskonto für „IG Lieferung an Unternehmer mit USt-ID“ und FR. Bitte in Scopevisio anlegen, sonst werden Aufträge in dieses Land zurückgehalten."
    },
    {
      ok: false,
      label: "Drittlandsexport",
      scope: "Drittland",
      dest: "CH → kein aktives Erlöskonto",
      advice: "Ihre Steuermatrix enthält kein aktives Erlöskonto für „Drittland“ und CH. Bitte in Scopevisio anlegen."
    }
  ];
  return /* @__PURE__ */ jsx(Page, { title: t("map.title"), subtitle: t("map.subtitle", { org: "Simplify AG" }), children: /* @__PURE__ */ jsx(Layout, { children: /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
    /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
      /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("map.readiness.title") }),
      /* @__PURE__ */ jsx(Badge, { tone: "attention", children: t("map.readiness.count", { ready: 1, total: 3 }) })
    ] }),
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t("map.readiness.fromOrders") }),
    /* @__PURE__ */ jsx(BlockStack, { gap: "300", children: rows.map((r) => /* @__PURE__ */ jsx(Box, { padding: "300", background: "bg-surface-secondary", borderRadius: "200", children: /* @__PURE__ */ jsxs(BlockStack, { gap: "150", children: [
      /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Badge, { tone: r.ok ? "success" : "attention", children: r.ok ? t("map.readiness.ready") : t("map.readiness.willHold") }),
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: r.label }),
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: r.scope })
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: r.dest }),
      r.advice && /* @__PURE__ */ jsx(Text, { as: "p", variant: "bodySm", children: r.advice })
    ] }) }, r.label)) }),
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t("map.readiness.footnote") })
  ] }) }) }) }) });
}
function Orders() {
  return /* @__PURE__ */ jsx(Page, { title: t("orders.title"), subtitle: t("orders.subtitle", { booked: 128, waiting: 2, declined: 1 }), children: /* @__PURE__ */ jsx(Layout, { children: /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
    /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: "#1043" }),
    /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
      /* @__PURE__ */ jsx(Badge, { tone: "attention", children: "Shopify und Scopevisio weichen bei der Steuer ab" }),
      /* @__PURE__ */ jsx(Badge, { children: "FR" })
    ] }),
    /* @__PURE__ */ jsx(Text, { as: "p", children: "Shopify hat 19,00 Umsatzsteuer berechnet, Scopevisio 0,00 für den Fall „EU B2B — Reverse Charge“ in FR. Beleg RE-2026-119 wurde angelegt, aber NICHT gebucht. Bitte die Abweichung klären und dann in Scopevisio buchen oder hier akzeptieren." }),
    /* @__PURE__ */ jsx(Box, { padding: "300", background: "bg-surface-secondary", borderRadius: "200", children: /* @__PURE__ */ jsxs(InlineStack, { gap: "500", children: [
      [[t("orders.tax.shopify"), "19,00"], [t("orders.tax.erp"), "0,00"]].map(([l, v]) => /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: l }),
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: v })
      ] }, l)),
      /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: t("orders.tax.diff") }),
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", tone: "critical", children: "−19,00" })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs(InlineStack, { gap: "300", children: [
      /* @__PURE__ */ jsx(Button, { children: t("orders.retry") }),
      /* @__PURE__ */ jsx(Button, { variant: "plain", tone: "critical", children: t("orders.decline") })
    ] })
  ] }) }) }) }) });
}
function Export() {
  const rows = [
    ["#1044", "DE · Debitor 10052 · Konto 8400 · U19"],
    ["#1045", "DE · Debitor 10053 · Konto 8400 · U19"],
    ["#1046", "DE · Debitor 10054 · Konto 8400 · U19"]
  ];
  return /* @__PURE__ */ jsx(Page, { title: t("export.title"), subtitle: t("export.subtitle", { org: "Simplify AG" }), children: /* @__PURE__ */ jsxs(Layout, { children: [
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
      /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("export.ready", { n: 3 }) }),
        /* @__PURE__ */ jsx(Badge, { tone: "success", children: t("export.vatResolved") })
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t("export.ready.detail") }),
      /* @__PURE__ */ jsx(BlockStack, { gap: "150", children: rows.map(([name, detail]) => /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "bodyMd", fontWeight: "medium", children: name }),
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: detail })
      ] }, name)) }),
      /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { variant: "primary", children: t("export.download", { n: 3 }) }) }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t("export.download.note") })
    ] }) }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "200", children: [
      /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t("export.how") }),
      /* @__PURE__ */ jsxs(List, { type: "number", children: [
        /* @__PURE__ */ jsx(List.Item, { children: t("export.how.1") }),
        /* @__PURE__ */ jsx(List.Item, { children: t("export.how.2") }),
        /* @__PURE__ */ jsx(List.Item, { children: t("export.how.3") }),
        /* @__PURE__ */ jsx(List.Item, { children: t("export.how.4") })
      ] })
    ] }) }) })
  ] }) });
}
function Connection() {
  return /* @__PURE__ */ jsx(Page, { title: t("conn.title"), subtitle: t("conn.subtitle"), children: /* @__PURE__ */ jsxs(Layout, { children: [
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
      /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t("conn.credentials") }),
        /* @__PURE__ */ jsx(Badge, { tone: "success", children: t("conn.status.connected") })
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t("conn.credentials.detail") }),
      /* @__PURE__ */ jsxs(FormLayout, { children: [
        /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t("conn.field.customer"),
              value: "2039915",
              autoComplete: "off",
              helpText: t("conn.field.customer.help"),
              onChange: () => {
              }
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t("conn.field.organisation"),
              value: "Simplify AG",
              autoComplete: "off",
              helpText: t("conn.field.organisation.help"),
              onChange: () => {
              }
            }
          )
        ] }),
        /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t("conn.field.username"),
              value: "buchhaltung@example.de",
              autoComplete: "off",
              helpText: t("conn.field.username.help"),
              onChange: () => {
              }
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t("conn.field.password"),
              type: "password",
              value: "••••••••••",
              autoComplete: "off",
              helpText: t("conn.field.password.help.existing"),
              onChange: () => {
              }
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsx(InlineStack, { gap: "300", children: /* @__PURE__ */ jsx(Button, { variant: "primary", children: t("conn.submit.existing") }) })
    ] }) }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "200", children: [
      /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t("conn.profiles.title") }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t("conn.profiles.detail") })
    ] }) }) })
  ] }) });
}
const VIEWS = {
  overview: Overview$1,
  connection: Connection,
  mapping: Mapping,
  readiness: Readiness,
  orders: Orders,
  export: Export
};
function Screenshot() {
  const { view } = useLoaderData();
  const Component = VIEWS[view] ?? Overview$1;
  return /* @__PURE__ */ jsx(AppProvider, { i18n: polarisDe, children: /* @__PURE__ */ jsx(Box, { background: "bg-surface-secondary", padding: "600", children: /* @__PURE__ */ jsx(Component, {}) }) });
}
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Screenshot,
  links: links$2,
  loader: loader$c
}, Symbol.toStringTag, { value: "Module" }));
const Polaris = /* @__PURE__ */ JSON.parse('{"ActionMenu":{"Actions":{"moreActions":"More actions"},"RollupActions":{"rollupButton":"View actions"}},"ActionList":{"SearchField":{"clearButtonLabel":"Clear","search":"Search","placeholder":"Search actions"}},"Avatar":{"label":"Avatar","labelWithInitials":"Avatar with initials {initials}"},"Autocomplete":{"spinnerAccessibilityLabel":"Loading","ellipsis":"{content}…"},"Badge":{"PROGRESS_LABELS":{"incomplete":"Incomplete","partiallyComplete":"Partially complete","complete":"Complete"},"TONE_LABELS":{"info":"Info","success":"Success","warning":"Warning","critical":"Critical","attention":"Attention","new":"New","readOnly":"Read-only","enabled":"Enabled"},"progressAndTone":"{toneLabel} {progressLabel}"},"Banner":{"dismissButton":"Dismiss notification"},"Button":{"spinnerAccessibilityLabel":"Loading"},"Common":{"checkbox":"checkbox","undo":"Undo","cancel":"Cancel","clear":"Clear","close":"Close","submit":"Submit","more":"More"},"ContextualSaveBar":{"save":"Save","discard":"Discard"},"DataTable":{"sortAccessibilityLabel":"sort {direction} by","navAccessibilityLabel":"Scroll table {direction} one column","totalsRowHeading":"Totals","totalRowHeading":"Total"},"DatePicker":{"previousMonth":"Show previous month, {previousMonthName} {showPreviousYear}","nextMonth":"Show next month, {nextMonth} {nextYear}","today":"Today ","start":"Start of range","end":"End of range","months":{"january":"January","february":"February","march":"March","april":"April","may":"May","june":"June","july":"July","august":"August","september":"September","october":"October","november":"November","december":"December"},"days":{"monday":"Monday","tuesday":"Tuesday","wednesday":"Wednesday","thursday":"Thursday","friday":"Friday","saturday":"Saturday","sunday":"Sunday"},"daysAbbreviated":{"monday":"Mo","tuesday":"Tu","wednesday":"We","thursday":"Th","friday":"Fr","saturday":"Sa","sunday":"Su"}},"DiscardConfirmationModal":{"title":"Discard all unsaved changes","message":"If you discard changes, you’ll delete any edits you made since you last saved.","primaryAction":"Discard changes","secondaryAction":"Continue editing"},"DropZone":{"single":{"overlayTextFile":"Drop file to upload","overlayTextImage":"Drop image to upload","overlayTextVideo":"Drop video to upload","actionTitleFile":"Add file","actionTitleImage":"Add image","actionTitleVideo":"Add video","actionHintFile":"or drop file to upload","actionHintImage":"or drop image to upload","actionHintVideo":"or drop video to upload","labelFile":"Upload file","labelImage":"Upload image","labelVideo":"Upload video"},"allowMultiple":{"overlayTextFile":"Drop files to upload","overlayTextImage":"Drop images to upload","overlayTextVideo":"Drop videos to upload","actionTitleFile":"Add files","actionTitleImage":"Add images","actionTitleVideo":"Add videos","actionHintFile":"or drop files to upload","actionHintImage":"or drop images to upload","actionHintVideo":"or drop videos to upload","labelFile":"Upload files","labelImage":"Upload images","labelVideo":"Upload videos"},"errorOverlayTextFile":"File type is not valid","errorOverlayTextImage":"Image type is not valid","errorOverlayTextVideo":"Video type is not valid"},"EmptySearchResult":{"altText":"Empty search results"},"Frame":{"skipToContent":"Skip to content","navigationLabel":"Navigation","Navigation":{"closeMobileNavigationLabel":"Close navigation"}},"FullscreenBar":{"back":"Back","accessibilityLabel":"Exit fullscreen mode"},"Filters":{"moreFilters":"More filters","moreFiltersWithCount":"More filters ({count})","filter":"Filter {resourceName}","noFiltersApplied":"No filters applied","cancel":"Cancel","done":"Done","clearAllFilters":"Clear all filters","clear":"Clear","clearLabel":"Clear {filterName}","addFilter":"Add filter","clearFilters":"Clear all","searchInView":"in:{viewName}"},"FilterPill":{"clear":"Clear","unsavedChanges":"Unsaved changes - {label}"},"IndexFilters":{"searchFilterTooltip":"Search and filter","searchFilterTooltipWithShortcut":"Search and filter (F)","searchFilterAccessibilityLabel":"Search and filter results","sort":"Sort your results","addView":"Add a new view","newView":"Custom search","SortButton":{"ariaLabel":"Sort the results","tooltip":"Sort","title":"Sort by","sorting":{"asc":"Ascending","desc":"Descending","az":"A-Z","za":"Z-A"}},"EditColumnsButton":{"tooltip":"Edit columns","accessibilityLabel":"Customize table column order and visibility"},"UpdateButtons":{"cancel":"Cancel","update":"Update","save":"Save","saveAs":"Save as","modal":{"title":"Save view as","label":"Name","sameName":"A view with this name already exists. Please choose a different name.","save":"Save","cancel":"Cancel"}}},"IndexProvider":{"defaultItemSingular":"Item","defaultItemPlural":"Items","allItemsSelected":"All {itemsLength}+ {resourceNamePlural} are selected","selected":"{selectedItemsCount} selected","a11yCheckboxDeselectAllSingle":"Deselect {resourceNameSingular}","a11yCheckboxSelectAllSingle":"Select {resourceNameSingular}","a11yCheckboxDeselectAllMultiple":"Deselect all {itemsLength} {resourceNamePlural}","a11yCheckboxSelectAllMultiple":"Select all {itemsLength} {resourceNamePlural}"},"IndexTable":{"emptySearchTitle":"No {resourceNamePlural} found","emptySearchDescription":"Try changing the filters or search term","onboardingBadgeText":"New","resourceLoadingAccessibilityLabel":"Loading {resourceNamePlural}…","selectAllLabel":"Select all {resourceNamePlural}","selected":"{selectedItemsCount} selected","undo":"Undo","selectAllItems":"Select all {itemsLength}+ {resourceNamePlural}","selectItem":"Select {resourceName}","selectButtonText":"Select","sortAccessibilityLabel":"sort {direction} by"},"Loading":{"label":"Page loading bar"},"Modal":{"iFrameTitle":"body markup","modalWarning":"These required properties are missing from Modal: {missingProps}"},"Page":{"Header":{"rollupActionsLabel":"View actions for {title}","pageReadyAccessibilityLabel":"{title}. This page is ready"}},"Pagination":{"previous":"Previous","next":"Next","pagination":"Pagination"},"ProgressBar":{"negativeWarningMessage":"Values passed to the progress prop shouldn’t be negative. Resetting {progress} to 0.","exceedWarningMessage":"Values passed to the progress prop shouldn’t exceed 100. Setting {progress} to 100."},"ResourceList":{"sortingLabel":"Sort by","defaultItemSingular":"item","defaultItemPlural":"items","showing":"Showing {itemsCount} {resource}","showingTotalCount":"Showing {itemsCount} of {totalItemsCount} {resource}","loading":"Loading {resource}","selected":"{selectedItemsCount} selected","allItemsSelected":"All {itemsLength}+ {resourceNamePlural} in your store are selected","allFilteredItemsSelected":"All {itemsLength}+ {resourceNamePlural} in this filter are selected","selectAllItems":"Select all {itemsLength}+ {resourceNamePlural} in your store","selectAllFilteredItems":"Select all {itemsLength}+ {resourceNamePlural} in this filter","emptySearchResultTitle":"No {resourceNamePlural} found","emptySearchResultDescription":"Try changing the filters or search term","selectButtonText":"Select","a11yCheckboxDeselectAllSingle":"Deselect {resourceNameSingular}","a11yCheckboxSelectAllSingle":"Select {resourceNameSingular}","a11yCheckboxDeselectAllMultiple":"Deselect all {itemsLength} {resourceNamePlural}","a11yCheckboxSelectAllMultiple":"Select all {itemsLength} {resourceNamePlural}","Item":{"actionsDropdownLabel":"Actions for {accessibilityLabel}","actionsDropdown":"Actions dropdown","viewItem":"View details for {itemName}"},"BulkActions":{"actionsActivatorLabel":"Actions","moreActionsActivatorLabel":"More actions"}},"SkeletonPage":{"loadingLabel":"Page loading"},"Tabs":{"newViewAccessibilityLabel":"Create new view","newViewTooltip":"Create view","toggleTabsLabel":"More views","Tab":{"rename":"Rename view","duplicate":"Duplicate view","edit":"Edit view","editColumns":"Edit columns","delete":"Delete view","copy":"Copy of {name}","deleteModal":{"title":"Delete view?","description":"This can’t be undone. {viewName} view will no longer be available in your admin.","cancel":"Cancel","delete":"Delete view"}},"RenameModal":{"title":"Rename view","label":"Name","cancel":"Cancel","create":"Save","errors":{"sameName":"A view with this name already exists. Please choose a different name."}},"DuplicateModal":{"title":"Duplicate view","label":"Name","cancel":"Cancel","create":"Create view","errors":{"sameName":"A view with this name already exists. Please choose a different name."}},"CreateViewModal":{"title":"Create new view","label":"Name","cancel":"Cancel","create":"Create view","errors":{"sameName":"A view with this name already exists. Please choose a different name."}}},"Tag":{"ariaLabel":"Remove {children}"},"TextField":{"characterCount":"{count} characters","characterCountWithMaxLength":"{count} of {limit} characters used"},"TooltipOverlay":{"accessibilityLabel":"Tooltip: {label}"},"TopBar":{"toggleMenuLabel":"Toggle menu","SearchField":{"clearButtonLabel":"Clear","search":"Search"}},"MediaCard":{"dismissButton":"Dismiss","popoverButton":"Actions"},"VideoThumbnail":{"playButtonA11yLabel":{"default":"Play video","defaultWithDuration":"Play video of length {duration}","duration":{"hours":{"other":{"only":"{hourCount} hours","andMinutes":"{hourCount} hours and {minuteCount} minutes","andMinute":"{hourCount} hours and {minuteCount} minute","minutesAndSeconds":"{hourCount} hours, {minuteCount} minutes, and {secondCount} seconds","minutesAndSecond":"{hourCount} hours, {minuteCount} minutes, and {secondCount} second","minuteAndSeconds":"{hourCount} hours, {minuteCount} minute, and {secondCount} seconds","minuteAndSecond":"{hourCount} hours, {minuteCount} minute, and {secondCount} second","andSeconds":"{hourCount} hours and {secondCount} seconds","andSecond":"{hourCount} hours and {secondCount} second"},"one":{"only":"{hourCount} hour","andMinutes":"{hourCount} hour and {minuteCount} minutes","andMinute":"{hourCount} hour and {minuteCount} minute","minutesAndSeconds":"{hourCount} hour, {minuteCount} minutes, and {secondCount} seconds","minutesAndSecond":"{hourCount} hour, {minuteCount} minutes, and {secondCount} second","minuteAndSeconds":"{hourCount} hour, {minuteCount} minute, and {secondCount} seconds","minuteAndSecond":"{hourCount} hour, {minuteCount} minute, and {secondCount} second","andSeconds":"{hourCount} hour and {secondCount} seconds","andSecond":"{hourCount} hour and {secondCount} second"}},"minutes":{"other":{"only":"{minuteCount} minutes","andSeconds":"{minuteCount} minutes and {secondCount} seconds","andSecond":"{minuteCount} minutes and {secondCount} second"},"one":{"only":"{minuteCount} minute","andSeconds":"{minuteCount} minute and {secondCount} seconds","andSecond":"{minuteCount} minute and {secondCount} second"}},"seconds":{"other":"{secondCount} seconds","one":"{secondCount} second"}}}}}');
const polarisEn = {
  Polaris
};
function loginErrorMessage(loginErrors) {
  if ((loginErrors == null ? void 0 : loginErrors.shop) === LoginErrorType.MissingShop || (loginErrors == null ? void 0 : loginErrors.shop) === LoginErrorType.InvalidShop) {
    return {
      shop: "Open this app from your Shopify admin under Apps."
    };
  }
  return {};
}
const links$1 = () => [{ rel: "stylesheet", href: polarisStyles }];
const loader$b = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors, polarisTranslations: polarisEn };
};
const action$5 = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};
function Auth() {
  const { polarisTranslations: i18n } = useLoaderData();
  return /* @__PURE__ */ jsx(AppProvider, { i18n, children: /* @__PURE__ */ jsx(Page, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
    /* @__PURE__ */ jsx(Text, { variant: "headingMd", as: "h2", children: "Open this app from your Shopify admin" }),
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: "Scopevisio ERP runs inside the Shopify admin. Open it from Apps in your store’s admin — there is nothing to sign in to here." }),
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: "If it is not installed yet, use the install link supplied by Scopevisio." })
  ] }) }) }) });
}
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$5,
  default: Auth,
  links: links$1,
  loader: loader$b
}, Symbol.toStringTag, { value: "Module" }));
const loader$a = async (_args) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "database" }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
};
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$a
}, Symbol.toStringTag, { value: "Module" }));
const index = "_index_12o3y_1";
const heading = "_heading_12o3y_11";
const text = "_text_12o3y_12";
const content = "_content_12o3y_22";
const list = "_list_12o3y_51";
const styles = {
  index,
  heading,
  text,
  content,
  list
};
const loader$9 = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};
function App$1() {
  return /* @__PURE__ */ jsx("div", { className: styles.index, children: /* @__PURE__ */ jsxs("div", { className: styles.content, children: [
    /* @__PURE__ */ jsx("h1", { className: styles.heading, children: "Scopevisio ERP for Shopify" }),
    /* @__PURE__ */ jsx("p", { className: styles.text, children: "Books paid Shopify orders into Scopevisio: the customer becomes a contact and debitor, and the VAT treatment comes from your own Steuermatrix rather than being guessed at." }),
    /* @__PURE__ */ jsxs("ul", { className: styles.list, children: [
      /* @__PURE__ */ jsxs("li", { children: [
        /* @__PURE__ */ jsx("strong", { children: "Customers become debitors" }),
        ". Each buyer is created as a Scopevisio contact with a debitor account, guests included, and never duplicated on a retry."
      ] }),
      /* @__PURE__ */ jsxs("li", { children: [
        /* @__PURE__ */ jsx("strong", { children: "VAT from your Steuermatrix" }),
        ". The connector determines the Steuersachverhalt, then asks Scopevisio which Erlöskonto and Steuerschlüssel apply for that destination and date."
      ] }),
      /* @__PURE__ */ jsxs("li", { children: [
        /* @__PURE__ */ jsx("strong", { children: "Nothing booked on a guess" }),
        ". When a tax case or an account cannot be resolved, the order is held with an explanation instead of being posted — a posted document cannot be withdrawn."
      ] })
    ] }),
    /* @__PURE__ */ jsx("p", { className: styles.text, children: "Installed from a link supplied by Scopevisio. Once installed, open it from Apps in your store’s admin." })
  ] }) });
}
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: App$1,
  loader: loader$9
}, Symbol.toStringTag, { value: "Module" }));
const loader$8 = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$8
}, Symbol.toStringTag, { value: "Module" }));
const links = () => [{ rel: "stylesheet", href: polarisStyles }];
const loader$7 = async ({ request }) => {
  await authenticate.admin(request);
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));
  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale };
};
function App() {
  const { apiKey, locale } = useLoaderData();
  const t2 = makeT(locale);
  return (
    // Polaris has its own translations for built-in component labels
    // (pagination, "Clear", sort controls) — without this they stay English
    // inside an otherwise German UI.
    /* @__PURE__ */ jsxs(
      AppProvider$1,
      {
        isEmbeddedApp: true,
        apiKey,
        i18n: locale === "de" ? polarisDe : polarisEn,
        children: [
          /* @__PURE__ */ jsxs("s-app-nav", { children: [
            /* @__PURE__ */ jsx(Link, { to: "/app", rel: "home", children: t2("nav.overview") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/connection", children: t2("nav.connection") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/mapping", children: t2("nav.mapping") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/orders", children: t2("nav.orders") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/export", children: t2("nav.export") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/journal", children: t2("nav.journal") })
          ] }),
          /* @__PURE__ */ jsx(Outlet, {})
        ]
      }
    )
  );
}
function ErrorBoundary() {
  return boundary.error(useRouteError());
}
const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route13 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  default: App,
  headers,
  links,
  loader: loader$7
}, Symbol.toStringTag, { value: "Module" }));
const loader$6 = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const requested = new URL(request.url).searchParams.get("batch");
  const { csv, batchId, count } = requested ? await rebuildBatch(session.shop, requested) : await createExportBatch(session.shop);
  const filename = `scopevisio-abrechnungsbelege-${batchId}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      // Explicit charset: the file carries a BOM and German umlauts.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-batch-id": batchId,
      "x-invoice-count": String(count),
      "cache-control": "no-store"
    }
  });
};
const route14 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$6
}, Symbol.toStringTag, { value: "Module" }));
async function getConnection(shop) {
  return prisma.scopevisioConnection.findUnique({
    where: { shop },
    include: { settings: true }
  });
}
async function saveConnection(shop, input) {
  const baseUrl = (input.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const organisation = (input.organisation ?? "").trim();
  const probe = ScopevisioClient.ephemeral({ ...input, baseUrl, organisation });
  const verified = await probe.verify();
  const resolvedOrganisation = organisation || verified.organisation || "";
  const connection = await prisma.scopevisioConnection.upsert({
    where: { shop },
    create: {
      shop,
      baseUrl,
      customer: input.customer.trim(),
      organisation: resolvedOrganisation,
      username: input.username.trim(),
      passwordEnc: encrypt(input.password),
      status: "connected",
      statusDetail: null,
      lastCheckAt: /* @__PURE__ */ new Date()
    },
    update: {
      baseUrl,
      customer: input.customer.trim(),
      organisation: resolvedOrganisation,
      username: input.username.trim(),
      passwordEnc: encrypt(input.password),
      // New credentials invalidate every cached token.
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      refreshTokenEnc: null,
      status: "connected",
      statusDetail: null,
      lastCheckAt: /* @__PURE__ */ new Date()
    }
  });
  await prisma.scopevisioSettings.upsert({
    where: { shop },
    create: { shop, connectionId: connection.id },
    update: { connectionId: connection.id }
  });
  await logEvent(shop, {
    event: "connection.saved",
    message: `Connected to Scopevisio organisation "${resolvedOrganisation}" as ${input.username}.`
  });
  return connection;
}
async function refreshStatus(shop) {
  const conn = await prisma.scopevisioConnection.findUnique({ where: { shop } });
  if (!conn) return null;
  try {
    const client = await clientFor(shop);
    await client.verify();
    return prisma.scopevisioConnection.update({
      where: { shop },
      data: { status: "connected", statusDetail: null, lastCheckAt: /* @__PURE__ */ new Date() }
    });
  } catch (err) {
    const detail = err instanceof ScopevisioError ? err.message : "Scopevisio is unreachable.";
    await logEvent(shop, {
      level: "error",
      event: "connection.error",
      message: detail
    });
    return prisma.scopevisioConnection.update({
      where: { shop },
      data: { status: "error", statusDetail: detail, lastCheckAt: /* @__PURE__ */ new Date() }
    });
  }
}
async function deleteConnection(shop) {
  await prisma.scopevisioConnection.deleteMany({ where: { shop } });
  await prisma.masterDataCache.deleteMany({ where: { shop } });
  await logEvent(shop, {
    event: "connection.removed",
    message: "Scopevisio connection removed."
  });
}
async function updateSettings(shop, patch) {
  const conn = await prisma.scopevisioConnection.findUnique({ where: { shop } });
  if (!conn) {
    throw new ScopevisioError(
      "Connect Scopevisio before changing the mapping.",
      void 0,
      void 0,
      true
    );
  }
  const updated = await prisma.scopevisioSettings.upsert({
    where: { shop },
    create: { shop, connectionId: conn.id, ...patch },
    update: patch
  });
  await logEvent(shop, {
    event: "settings.updated",
    message: "Mapping settings updated.",
    data: patch
  });
  return updated;
}
function missingSettings(settings) {
  if (!settings) return ["Mapping has not been configured yet."];
  const gaps = [];
  if (!settings.vatScopeDomestic) {
    gaps.push("Domestic tax case (Steuersachverhalt) is not chosen.");
  }
  if (!settings.homeCountry) {
    gaps.push("The organisation's country of taxation is not set.");
  }
  return gaps;
}
const loader$5 = async ({ request }) => {
  var _a2;
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);
  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    keyConfigured: encryptionKeyConfigured(),
    connection: connection ? {
      baseUrl: connection.baseUrl,
      customer: connection.customer,
      organisation: connection.organisation,
      username: connection.username,
      status: connection.status,
      statusDetail: connection.statusDetail,
      lastCheckAt: ((_a2 = connection.lastCheckAt) == null ? void 0 : _a2.toISOString()) ?? null
    } : null
  };
};
const action$4 = async ({
  request
}) => {
  const { session } = await authenticate.admin(request);
  const t2 = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  try {
    if (intent === "disconnect") {
      await deleteConnection(session.shop);
      return { ok: true, message: "Scopevisio connection removed." };
    }
    if (intent === "recheck") {
      const conn = await refreshStatus(session.shop);
      return (conn == null ? void 0 : conn.status) === "connected" ? { ok: true, message: "Connection is healthy." } : { ok: false, message: (conn == null ? void 0 : conn.statusDetail) ?? "Connection failed." };
    }
    const customer = String(form.get("customer") ?? "").trim();
    const organisation = String(form.get("organisation") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const baseUrl = String(form.get("baseUrl") ?? DEFAULT_BASE_URL).trim();
    const fieldErrors = {};
    if (!customer) fieldErrors.customer = t2("conn.field.customer.required");
    else if (!/^\d{7}$/.test(customer)) {
      fieldErrors.customer = t2("conn.field.customer.format");
    }
    if (!username) fieldErrors.username = t2("conn.field.username.required");
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) {
      fieldErrors.username = t2("conn.field.username.format");
    }
    if (!password) fieldErrors.password = t2("conn.field.password.required");
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, fieldErrors };
    }
    await saveConnection(session.shop, {
      baseUrl,
      customer,
      organisation,
      username,
      password
    });
    const master = await refreshAllMasterData(session.shop);
    return {
      ok: true,
      message: "Connected to Scopevisio.",
      master
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not connect to Scopevisio."
    };
  }
};
function ConnectionPage() {
  const { connection, keyConfigured, locale } = useLoaderData();
  const t2 = makeT(locale);
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const fieldErrors = (actionData == null ? void 0 : actionData.fieldErrors) ?? {};
  const [customer, setCustomer] = useState((connection == null ? void 0 : connection.customer) ?? "");
  const [organisation, setOrganisation] = useState((connection == null ? void 0 : connection.organisation) ?? "");
  const [username, setUsername] = useState((connection == null ? void 0 : connection.username) ?? "");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState((connection == null ? void 0 : connection.baseUrl) ?? DEFAULT_BASE_URL);
  const statusBadge = () => {
    if (!connection) return /* @__PURE__ */ jsx(Badge, { tone: "new", children: t2("conn.status.notConnected") });
    if (connection.status === "connected") return /* @__PURE__ */ jsx(Badge, { tone: "success", children: t2("conn.status.connected") });
    if (connection.status === "error") return /* @__PURE__ */ jsx(Badge, { tone: "critical", children: t2("conn.status.error") });
    return /* @__PURE__ */ jsx(Badge, { tone: "attention", children: t2("conn.status.unverified") });
  };
  return /* @__PURE__ */ jsx(Page, { title: t2("conn.title"), subtitle: t2("conn.subtitle"), children: /* @__PURE__ */ jsxs(Layout, { children: [
    (actionData == null ? void 0 : actionData.message) ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(
      Banner,
      {
        tone: actionData.ok ? "success" : "critical",
        title: actionData.ok ? t2("conn.ok.title") : t2("conn.error.title"),
        children: /* @__PURE__ */ jsx("p", { children: actionData.message })
      }
    ) }) : (connection == null ? void 0 : connection.status) === "error" && connection.statusDetail ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(Banner, { tone: "warning", title: t2("conn.broken.title"), children: [
      /* @__PURE__ */ jsx("p", { children: connection.statusDetail }),
      /* @__PURE__ */ jsx("p", { children: t2("conn.broken.detail") })
    ] }) }) : !keyConfigured ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: "critical", title: t2("conn.key.title"), children: /* @__PURE__ */ jsxs("p", { children: [
      /* @__PURE__ */ jsx("code", { children: "SCOPEVISIO_ENCRYPTION_KEY" }),
      " is not set, so credentials cannot be stored safely. Generate one with",
      " ",
      /* @__PURE__ */ jsx("code", { children: "openssl rand -base64 32" }),
      " and add it to the app’s environment before connecting."
    ] }) }) }) : null,
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(Form, { method: "post", children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
      /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("conn.credentials") }),
        statusBadge()
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("conn.credentials.detail") }),
      /* @__PURE__ */ jsxs(FormLayout, { children: [
        /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t2("conn.field.customer"),
              name: "customer",
              value: customer,
              onChange: setCustomer,
              autoComplete: "off",
              helpText: t2("conn.field.customer.help"),
              maxLength: 7,
              error: fieldErrors.customer
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t2("conn.field.organisation"),
              name: "organisation",
              value: organisation,
              onChange: setOrganisation,
              autoComplete: "off",
              helpText: t2("conn.field.organisation.help")
            }
          )
        ] }),
        /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t2("conn.field.username"),
              name: "username",
              type: "email",
              value: username,
              onChange: setUsername,
              autoComplete: "off",
              helpText: t2("conn.field.username.help"),
              error: fieldErrors.username
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t2("conn.field.password"),
              name: "password",
              type: "password",
              value: password,
              onChange: setPassword,
              autoComplete: "off",
              error: fieldErrors.password,
              helpText: connection ? t2("conn.field.password.help.existing") : t2("conn.field.password.help.new")
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t2("conn.field.baseUrl"),
            name: "baseUrl",
            value: baseUrl,
            onChange: setBaseUrl,
            autoComplete: "off",
            helpText: t2("conn.field.baseUrl.help")
          }
        )
      ] }),
      /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "save" }),
      /* @__PURE__ */ jsx(InlineStack, { gap: "300", children: /* @__PURE__ */ jsx(Button, { submit: true, variant: "primary", loading: busy, disabled: !keyConfigured, children: connection ? t2("conn.submit.existing") : t2("conn.submit.new") }) })
    ] }) }) }) }),
    connection && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
      /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("conn.health") }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("conn.health.lastCheck", {
        when: connection.lastCheckAt ? new Date(connection.lastCheckAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB") : t2("conn.health.never")
      }) }),
      /* @__PURE__ */ jsxs(InlineStack, { gap: "300", children: [
        /* @__PURE__ */ jsxs(Form, { method: "post", children: [
          /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "recheck" }),
          /* @__PURE__ */ jsx(Button, { submit: true, loading: busy, children: t2("conn.health.check") })
        ] }),
        /* @__PURE__ */ jsxs(Form, { method: "post", children: [
          /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "disconnect" }),
          /* @__PURE__ */ jsx(Button, { submit: true, tone: "critical", variant: "plain", children: t2("conn.health.disconnect") })
        ] })
      ] }),
      /* @__PURE__ */ jsx(Box, { paddingBlockStart: "200", children: /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("conn.health.disconnect.detail") }) })
    ] }) }) }),
    /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "200", children: [
      /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t2("conn.profiles.title") }),
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("conn.profiles.detail") }),
      /* @__PURE__ */ jsx(
        Link$1,
        {
          url: "https://help.scopevisio.com/de/articles/467358-rest-api-erste-schritte",
          target: "_blank",
          removeUnderline: true,
          children: "Scopevisio REST API — getting started"
        }
      )
    ] }) }) })
  ] }) });
}
const route15 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$4,
  default: ConnectionPage,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
const loader$4 = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const events = await recentEvents(session.shop, 250);
  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    events: events.map((e) => ({
      id: e.id,
      level: e.level,
      event: e.event,
      message: e.message,
      orderGid: e.orderGid,
      createdAt: e.createdAt.toISOString()
    }))
  };
};
function JournalPage() {
  const { events, locale } = useLoaderData();
  const t2 = makeT(locale);
  return /* @__PURE__ */ jsx(
    Page,
    {
      title: t2("journal.title"),
      subtitle: t2("journal.subtitle"),
      children: /* @__PURE__ */ jsx(Layout, { children: /* @__PURE__ */ jsx(Layout.Section, { children: events.length === 0 ? /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
        EmptyState,
        {
          heading: t2("journal.empty"),
          image: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
          children: /* @__PURE__ */ jsx("p", { children: t2("journal.empty.detail") })
        }
      ) }) : /* @__PURE__ */ jsx(Card, { padding: "0", children: /* @__PURE__ */ jsx(BlockStack, { gap: "0", children: events.map((e, index2) => /* @__PURE__ */ jsx(
        Box,
        {
          padding: "400",
          borderBlockEndWidth: index2 === events.length - 1 ? "0" : "025",
          borderColor: "border-secondary",
          children: /* @__PURE__ */ jsxs(BlockStack, { gap: "150", children: [
            /* @__PURE__ */ jsxs(InlineStack, { gap: "300", blockAlign: "center", children: [
              /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: new Date(e.createdAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB") }),
              /* @__PURE__ */ jsx(
                Badge,
                {
                  tone: e.level === "error" ? "critical" : e.level === "warn" ? "attention" : void 0,
                  children: e.event
                }
              ),
              e.orderGid && /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: e.orderGid.split("/").pop() })
            ] }),
            /* @__PURE__ */ jsx(
              Text,
              {
                as: "p",
                tone: e.level === "error" ? "critical" : void 0,
                children: e.message
              }
            )
          ] })
        },
        e.id
      )) }) }) }) })
    }
  );
}
const route16 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: JournalPage,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const DEFAULT_EU_PROBE = ["AT", "FR", "NL"];
const DEFAULT_THIRD_PROBE = ["CH", "GB", "US"];
async function probeCountries(shop, homeCountry) {
  const seen = await prisma.orderSync.findMany({
    where: { shop, countryUsed: { not: null } },
    select: { countryUsed: true },
    distinct: ["countryUsed"],
    take: 40
  });
  const countries = seen.map((r) => (r.countryUsed ?? "").toUpperCase()).filter((c) => c && c !== homeCountry.toUpperCase());
  const eu = countries.filter((c) => EU_COUNTRIES.has(c));
  const third = countries.filter((c) => !EU_COUNTRIES.has(c));
  if (eu.length === 0 && third.length === 0) {
    return { eu: DEFAULT_EU_PROBE, third: DEFAULT_THIRD_PROBE, source: "defaults" };
  }
  return {
    eu: eu.length ? eu : DEFAULT_EU_PROBE,
    third: third.length ? third : DEFAULT_THIRD_PROBE,
    source: "orders"
  };
}
const SCOPE_FIELD = {
  domestic: "vatScopeDomestic",
  eu_b2c: "vatScopeEuB2c",
  eu_b2c_oss: "vatScopeEuB2cOss",
  eu_b2b_reverse: "vatScopeEuB2bReverse",
  third_country: "vatScopeThirdCountry"
};
async function checkReadiness(shop) {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  if (!settings) {
    return {
      rows: [],
      readyCount: 0,
      blockedCount: 0,
      learnedFrom: "defaults",
      checkedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const home = (settings.homeCountry || "DE").toUpperCase();
  const { eu, third, source } = await probeCountries(shop, home);
  let scopeNames = /* @__PURE__ */ new Map();
  try {
    const scopes = await getVatScopes(shop);
    scopeNames = new Map(scopes.data.map((s) => [s.caseId, s.caseName]));
  } catch {
  }
  const applicable = [
    { taxCase: "domestic", countries: [home] },
    settings.ossRegistered ? { taxCase: "eu_b2c_oss", countries: eu } : { taxCase: "eu_b2c", countries: eu },
    { taxCase: "eu_b2b_reverse", countries: eu },
    { taxCase: "third_country", countries: third }
  ];
  const today = /* @__PURE__ */ new Date();
  const rows = [];
  for (const { taxCase, countries } of applicable) {
    const vatScope = settings[SCOPE_FIELD[taxCase]];
    if (!vatScope) {
      rows.push({
        taxCase,
        label: TAX_CASE_LABEL[taxCase],
        vatScope: null,
        scopeName: null,
        destinations: countries.map((country) => ({
          country,
          ok: false,
          problem: "no tax case selected"
        })),
        ok: false,
        advice: `Choose a Steuersachverhalt for "${TAX_CASE_LABEL[taxCase]}" above. Until then every matching order is held rather than booked.`
      });
      continue;
    }
    const destinations = [];
    for (const country of countries) {
      try {
        const accounts = await resolveRevenueAccounts(shop, {
          country,
          vatScope,
          servicesRenderedDate: today
        });
        const exact = accounts.find(
          (a) => (a.countryIso ?? "").toUpperCase() === country
        ) ?? accounts[0];
        if (!exact) {
          destinations.push({
            country,
            ok: false,
            problem: "no active Erlöskonto"
          });
        } else {
          destinations.push({
            country,
            ok: true,
            account: exact.accountNumber,
            vatKey: exact.vatKey
          });
        }
      } catch (err) {
        destinations.push({
          country,
          ok: false,
          problem: err instanceof Error ? err.message.slice(0, 120) : "lookup failed"
        });
      }
    }
    const failing = destinations.filter((d) => !d.ok).map((d) => d.country);
    rows.push({
      taxCase,
      label: TAX_CASE_LABEL[taxCase],
      vatScope,
      scopeName: scopeNames.get(vatScope) ?? null,
      destinations,
      ok: failing.length === 0,
      advice: failing.length ? `Your Steuermatrix has no active Erlöskonto for "${scopeNames.get(vatScope) ?? `case ${vatScope}`}" and ${failing.join(", ")}. Add one in Scopevisio, or orders to ${failing.length === 1 ? "that country" : "those countries"} will be held.` : void 0
    });
  }
  return {
    rows,
    readyCount: rows.filter((r) => r.ok).length,
    blockedCount: rows.filter((r) => !r.ok).length,
    learnedFrom: source,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
const loader$3 = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));
  if (!connection) {
    return { connected: false, locale };
  }
  let vatScopes = [];
  let masterDataError = null;
  let stale = false;
  try {
    const res = await getVatScopes(session.shop);
    vatScopes = res.data.map((s) => ({ caseId: s.caseId, caseName: s.caseName }));
    stale = res.stale;
  } catch (err) {
    masterDataError = err instanceof Error ? err.message : "Steuermatrix";
  }
  const settings = connection.settings;
  return {
    connected: true,
    locale,
    organisation: connection.organisation,
    vatScopes,
    masterDataError,
    stale,
    gaps: missingSettings(settings),
    settings: settings ? {
      syncEnabled: settings.syncEnabled,
      autoPost: settings.autoPost,
      customerGroup: settings.customerGroup,
      guestCustomerGroup: settings.guestCustomerGroup,
      numberRangeNumber: settings.numberRangeNumber,
      guestUseCpd: settings.guestUseCpd,
      vatScopeDomestic: settings.vatScopeDomestic,
      vatScopeEuB2c: settings.vatScopeEuB2c,
      vatScopeEuB2cOss: settings.vatScopeEuB2cOss,
      vatScopeEuB2bReverse: settings.vatScopeEuB2bReverse,
      vatScopeThirdCountry: settings.vatScopeThirdCountry,
      ossRegistered: settings.ossRegistered,
      homeCountry: settings.homeCountry,
      taxToleranceCents: settings.taxToleranceCents,
      copyVatFromProduct: settings.copyVatFromProduct,
      copyAccountsFromProduct: settings.copyAccountsFromProduct,
      documentTemplate: settings.documentTemplate,
      deliveryMode: settings.deliveryMode
    } : null
  };
};
const action$3 = async ({
  request
}) => {
  const { session } = await authenticate.admin(request);
  const t2 = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  try {
    if (intent === "readiness") {
      const readiness = await checkReadiness(session.shop);
      return { ok: true, readiness };
    }
    if (intent === "refresh") {
      const result = await refreshAllMasterData(session.shop);
      return {
        ok: result.errors.length === 0,
        message: result.errors.length ? `${t2("map.masterData")}: ${result.errors.join("; ")}` : `Refreshed: ${result.vatScopes} tax cases, ${result.vatMatrix} matrix entries, ${result.revenueAccounts} revenue accounts.`
      };
    }
    const num = (key2) => {
      const raw = String(form.get(key2) ?? "").trim();
      return raw === "" ? null : Number(raw);
    };
    const bool = (key2) => form.get(key2) === "on" || form.get(key2) === "true";
    await updateSettings(session.shop, {
      syncEnabled: bool("syncEnabled"),
      autoPost: bool("autoPost"),
      customerGroup: String(form.get("customerGroup") ?? "Shopify").trim() || "Shopify",
      guestCustomerGroup: String(form.get("guestCustomerGroup") ?? "Shopify Guest").trim() || "Shopify Guest",
      numberRangeNumber: num("numberRangeNumber"),
      guestUseCpd: bool("guestUseCpd"),
      vatScopeDomestic: num("vatScopeDomestic"),
      vatScopeEuB2c: num("vatScopeEuB2c"),
      vatScopeEuB2cOss: num("vatScopeEuB2cOss"),
      vatScopeEuB2bReverse: num("vatScopeEuB2bReverse"),
      vatScopeThirdCountry: num("vatScopeThirdCountry"),
      ossRegistered: bool("ossRegistered"),
      homeCountry: String(form.get("homeCountry") ?? "DE").trim().toUpperCase() || "DE",
      taxToleranceCents: num("taxToleranceCents") ?? 2,
      copyVatFromProduct: bool("copyVatFromProduct"),
      copyAccountsFromProduct: bool("copyAccountsFromProduct"),
      documentTemplate: String(form.get("documentTemplate") ?? "").trim() || null,
      deliveryMode: String(form.get("deliveryMode") ?? "csv") === "api" ? "api" : "csv"
    });
    return { ok: true, message: t2("map.saved") };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t2("map.saveFailed")
    };
  }
};
function BoolField({
  label,
  name,
  checked,
  onChange,
  helpText
}) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("input", { type: "hidden", name, value: checked ? "true" : "false" }),
    /* @__PURE__ */ jsx(Checkbox, { label, checked, onChange, helpText })
  ] });
}
function MappingPage() {
  const data = useLoaderData();
  if (!data.connected) {
    return /* @__PURE__ */ jsx(Page, { title: makeT(data.locale)("map.title"), children: /* @__PURE__ */ jsx(Banner, { tone: "warning", title: makeT(data.locale)("map.needConnection"), children: /* @__PURE__ */ jsx("p", { children: makeT(data.locale)("map.needConnection.detail") }) }) });
  }
  return /* @__PURE__ */ jsx(MappingEditor, { data });
}
function MappingEditor({ data }) {
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const formRef = useRef(null);
  const t2 = makeT(data.locale);
  const s = data.settings;
  const [syncEnabled, setSyncEnabled] = useState((s == null ? void 0 : s.syncEnabled) ?? false);
  const [autoPost, setAutoPost] = useState((s == null ? void 0 : s.autoPost) ?? false);
  const [customerGroup, setCustomerGroup] = useState((s == null ? void 0 : s.customerGroup) ?? "Shopify");
  const [guestCustomerGroup, setGuestCustomerGroup] = useState(
    (s == null ? void 0 : s.guestCustomerGroup) ?? "Shopify Guest"
  );
  const [numberRangeNumber, setNumberRangeNumber] = useState(
    (s == null ? void 0 : s.numberRangeNumber) != null ? String(s.numberRangeNumber) : ""
  );
  const [guestUseCpd, setGuestUseCpd] = useState((s == null ? void 0 : s.guestUseCpd) ?? true);
  const [ossRegistered, setOssRegistered] = useState((s == null ? void 0 : s.ossRegistered) ?? false);
  const [homeCountry, setHomeCountry] = useState((s == null ? void 0 : s.homeCountry) ?? "DE");
  const [tolerance, setTolerance] = useState(String((s == null ? void 0 : s.taxToleranceCents) ?? 2));
  const [copyVat, setCopyVat] = useState((s == null ? void 0 : s.copyVatFromProduct) ?? true);
  const [copyAccounts, setCopyAccounts] = useState((s == null ? void 0 : s.copyAccountsFromProduct) ?? true);
  const [template, setTemplate] = useState((s == null ? void 0 : s.documentTemplate) ?? "");
  const [deliveryMode, setDeliveryMode] = useState((s == null ? void 0 : s.deliveryMode) ?? "csv");
  const [scopes, setScopes] = useState(
    Object.fromEntries(
      SCOPE_FIELDS.map((f) => [
        f.field,
        (s == null ? void 0 : s[f.field]) != null ? String(s[f.field]) : ""
      ])
    )
  );
  const current = useMemo(
    () => ({
      syncEnabled,
      autoPost,
      customerGroup,
      guestCustomerGroup,
      numberRangeNumber,
      guestUseCpd,
      ossRegistered,
      homeCountry,
      tolerance,
      copyVat,
      copyAccounts,
      template,
      deliveryMode,
      scopes
    }),
    [
      syncEnabled,
      autoPost,
      customerGroup,
      guestCustomerGroup,
      numberRangeNumber,
      guestUseCpd,
      ossRegistered,
      homeCountry,
      tolerance,
      copyVat,
      copyAccounts,
      template,
      deliveryMode,
      scopes
    ]
  );
  const initial = useRef(current);
  const dirty = JSON.stringify(current) !== JSON.stringify(initial.current);
  useEffect(() => {
    if (actionData == null ? void 0 : actionData.ok) initial.current = current;
  }, [actionData, current]);
  const onSave = useCallback(() => {
    var _a2;
    return (_a2 = formRef.current) == null ? void 0 : _a2.requestSubmit();
  }, []);
  const readiness = (actionData == null ? void 0 : actionData.readiness) ?? null;
  const onDiscard = useCallback(() => {
    const i = initial.current;
    setSyncEnabled(i.syncEnabled);
    setAutoPost(i.autoPost);
    setCustomerGroup(i.customerGroup);
    setGuestCustomerGroup(i.guestCustomerGroup);
    setNumberRangeNumber(i.numberRangeNumber);
    setGuestUseCpd(i.guestUseCpd);
    setOssRegistered(i.ossRegistered);
    setHomeCountry(i.homeCountry);
    setTolerance(i.tolerance);
    setCopyVat(i.copyVat);
    setCopyAccounts(i.copyAccounts);
    setTemplate(i.template);
    setDeliveryMode(i.deliveryMode);
    setScopes(i.scopes);
  }, []);
  const scopeOptions = [
    { label: "— not configured —", value: "" },
    ...data.vatScopes.map((v) => ({
      label: `${v.caseName} (${v.caseId})`,
      value: String(v.caseId)
    }))
  ];
  return /* @__PURE__ */ jsxs(
    Page,
    {
      title: t2("map.title"),
      subtitle: t2("map.subtitle", { org: data.organisation }),
      children: [
        /* @__PURE__ */ jsxs(SaveBar, { id: "mapping-save-bar", open: dirty, children: [
          /* @__PURE__ */ jsx("button", { variant: "primary", onClick: onSave, disabled: busy }),
          /* @__PURE__ */ jsx("button", { onClick: onDiscard, disabled: busy })
        ] }),
        /* @__PURE__ */ jsxs(Layout, { children: [
          (actionData == null ? void 0 : actionData.message) ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: actionData.ok ? "success" : "critical", children: /* @__PURE__ */ jsx("p", { children: actionData.message }) }) }) : data.masterDataError ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(Banner, { tone: "critical", title: t2("map.matrixError"), children: [
            /* @__PURE__ */ jsx("p", { children: data.masterDataError }),
            /* @__PURE__ */ jsx("p", { children: t2("map.matrixError.detail") })
          ] }) }) : data.gaps.length > 0 ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(Banner, { tone: "warning", title: t2("map.notReady"), children: [
            /* @__PURE__ */ jsx(List, { children: data.gaps.map((gap) => /* @__PURE__ */ jsx(List.Item, { children: gap }, gap)) }),
            data.stale && /* @__PURE__ */ jsx("p", { children: t2("map.stale") })
          ] }) }) : data.stale ? /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: "warning", children: /* @__PURE__ */ jsx("p", { children: t2("map.stale") }) }) }) : null,
          /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Form, { method: "post", ref: formRef, children: /* @__PURE__ */ jsxs(BlockStack, { gap: "500", children: [
            /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.sync") }),
              /* @__PURE__ */ jsx(
                BoolField,
                {
                  label: t2("map.sync.enable"),
                  name: "syncEnabled",
                  checked: syncEnabled,
                  onChange: setSyncEnabled,
                  helpText: t2("map.sync.enable.help")
                }
              ),
              /* @__PURE__ */ jsx(
                BoolField,
                {
                  label: t2("map.sync.autoPost"),
                  name: "autoPost",
                  checked: autoPost,
                  onChange: setAutoPost,
                  helpText: t2("map.sync.autoPost.help")
                }
              ),
              autoPost && /* @__PURE__ */ jsx(Banner, { tone: "warning", children: /* @__PURE__ */ jsx("p", { children: t2("map.sync.autoPost.warning") }) })
            ] }) }),
            /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.customers") }),
              /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("map.customers.detail") }),
              /* @__PURE__ */ jsxs(FormLayout, { children: [
                /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
                  /* @__PURE__ */ jsx(
                    TextField,
                    {
                      label: t2("map.customers.group"),
                      name: "customerGroup",
                      value: customerGroup,
                      onChange: setCustomerGroup,
                      autoComplete: "off",
                      helpText: t2("map.customers.group.help")
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    TextField,
                    {
                      label: t2("map.customers.guestGroup"),
                      name: "guestCustomerGroup",
                      value: guestCustomerGroup,
                      onChange: setGuestCustomerGroup,
                      autoComplete: "off",
                      helpText: t2("map.customers.guestGroup.help")
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(FormLayout.Group, { children: /* @__PURE__ */ jsx(
                  TextField,
                  {
                    label: t2("map.customers.range"),
                    name: "numberRangeNumber",
                    type: "number",
                    value: numberRangeNumber,
                    onChange: setNumberRangeNumber,
                    autoComplete: "off",
                    helpText: t2("map.customers.range.help")
                  }
                ) }),
                /* @__PURE__ */ jsx(
                  BoolField,
                  {
                    label: t2("map.customers.cpd"),
                    name: "guestUseCpd",
                    checked: guestUseCpd,
                    onChange: setGuestUseCpd,
                    helpText: t2("map.customers.cpd.help")
                  }
                )
              ] })
            ] }) }),
            /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.tax") }),
              /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("map.tax.detail") }),
              /* @__PURE__ */ jsxs(FormLayout, { children: [
                /* @__PURE__ */ jsxs(FormLayout.Group, { children: [
                  /* @__PURE__ */ jsx(
                    TextField,
                    {
                      label: t2("map.tax.homeCountry"),
                      name: "homeCountry",
                      value: homeCountry,
                      onChange: (v) => setHomeCountry(v.toUpperCase()),
                      autoComplete: "off",
                      maxLength: 2,
                      helpText: t2("map.tax.homeCountry.help")
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    TextField,
                    {
                      label: t2("map.tax.tolerance"),
                      name: "taxToleranceCents",
                      type: "number",
                      value: tolerance,
                      onChange: setTolerance,
                      autoComplete: "off",
                      helpText: t2("map.tax.tolerance.help")
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(
                  BoolField,
                  {
                    label: t2("map.tax.oss"),
                    name: "ossRegistered",
                    checked: ossRegistered,
                    onChange: setOssRegistered,
                    helpText: t2("map.tax.oss.help")
                  }
                ),
                SCOPE_FIELDS.map((f) => /* @__PURE__ */ jsx(
                  Select,
                  {
                    label: TAX_CASE_LABEL[f.taxCase],
                    name: f.field,
                    options: scopeOptions,
                    value: scopes[f.field] ?? "",
                    onChange: (v) => setScopes((prev) => ({ ...prev, [f.field]: v })),
                    helpText: f.help,
                    disabled: data.vatScopes.length === 0
                  },
                  f.field
                ))
              ] }),
              data.vatScopes.length === 0 && !data.masterDataError && /* @__PURE__ */ jsx(Banner, { tone: "warning", children: /* @__PURE__ */ jsx("p", { children: t2("map.tax.noScopes") }) })
            ] }) }),
            /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.delivery") }),
              /* @__PURE__ */ jsx(
                Select,
                {
                  label: t2("map.delivery.label"),
                  name: "deliveryMode",
                  options: [
                    { label: t2("map.delivery.csv"), value: "csv" },
                    { label: t2("map.delivery.api"), value: "api" }
                  ],
                  value: deliveryMode,
                  onChange: setDeliveryMode,
                  helpText: t2("map.delivery.help")
                }
              ),
              deliveryMode === "api" && /* @__PURE__ */ jsx(Banner, { tone: "critical", title: t2("map.delivery.apiWarning"), children: /* @__PURE__ */ jsx("p", { children: t2("map.delivery.apiWarning.detail") }) })
            ] }) }),
            /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.documents") }),
              /* @__PURE__ */ jsx(
                BoolField,
                {
                  label: t2("map.documents.copyVat"),
                  name: "copyVatFromProduct",
                  checked: copyVat,
                  onChange: setCopyVat,
                  helpText: t2("map.documents.copyVat.help")
                }
              ),
              /* @__PURE__ */ jsx(
                BoolField,
                {
                  label: t2("map.documents.copyAccounts"),
                  name: "copyAccountsFromProduct",
                  checked: copyAccounts,
                  onChange: setCopyAccounts,
                  helpText: t2("map.documents.copyAccounts.help")
                }
              ),
              /* @__PURE__ */ jsx(
                TextField,
                {
                  label: t2("map.documents.template"),
                  name: "documentTemplate",
                  value: template,
                  onChange: setTemplate,
                  autoComplete: "off",
                  helpText: t2("map.documents.template.help")
                }
              )
            ] }) }),
            /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "save" }),
            /* @__PURE__ */ jsx(InlineStack, { gap: "300", children: /* @__PURE__ */ jsx(Button, { submit: true, variant: "primary", loading: busy, children: t2("map.save") }) })
          ] }) }) }),
          /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
            /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t2("map.masterData") }),
            /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("map.masterData.detail") }),
            /* @__PURE__ */ jsxs(InlineStack, { gap: "300", children: [
              /* @__PURE__ */ jsxs(Form, { method: "post", children: [
                /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "readiness" }),
                /* @__PURE__ */ jsx(Button, { submit: true, loading: busy, variant: "primary", children: t2("map.readiness.run") })
              ] }),
              /* @__PURE__ */ jsxs(Form, { method: "post", children: [
                /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "refresh" }),
                /* @__PURE__ */ jsx(Button, { submit: true, loading: busy, children: t2("map.masterData.refresh") })
              ] })
            ] })
          ] }) }) }),
          readiness && readiness.rows.length > 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
            /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
              /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("map.readiness.title") }),
              /* @__PURE__ */ jsx(Badge, { tone: readiness.blockedCount === 0 ? "success" : "attention", children: t2("map.readiness.count", { ready: readiness.readyCount, total: readiness.rows.length }) })
            ] }),
            /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: readiness.learnedFrom === "orders" ? t2("map.readiness.fromOrders") : t2("map.readiness.fromDefaults") }),
            /* @__PURE__ */ jsx(BlockStack, { gap: "300", children: readiness.rows.map((row) => /* @__PURE__ */ jsx(
              Box,
              {
                padding: "300",
                background: "bg-surface-secondary",
                borderRadius: "200",
                children: /* @__PURE__ */ jsxs(BlockStack, { gap: "150", children: [
                  /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
                    /* @__PURE__ */ jsx(Badge, { tone: row.ok ? "success" : "attention", children: row.ok ? t2("map.readiness.ready") : t2("map.readiness.willHold") }),
                    /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: row.label }),
                    row.scopeName && /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: row.scopeName })
                  ] }),
                  /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: row.destinations.map(
                    (d) => d.ok ? `${d.country} → ${d.account} / ${d.vatKey}` : `${d.country} → ${d.problem}`
                  ).join("  ·  ") }),
                  row.advice && /* @__PURE__ */ jsx(Text, { as: "p", variant: "bodySm", children: row.advice })
                ] })
              },
              row.taxCase
            )) }),
            /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("map.readiness.footnote") })
          ] }) }) }),
          /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "200", children: [
            /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
              /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t2("map.why.title") }),
              /* @__PURE__ */ jsx(Badge, { tone: "info", children: "Info" })
            ] }),
            /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: "A 0% line in Shopify could be an intra-EU B2B supply, a third-country export, a reverse-charge supply or a small-business exemption. Those are four different Steuersachverhalte, four different UStVA lines and four different revenue accounts — the legal reason cannot be recovered from the number. So Shopify's calculated tax is only ever used as a cross-check before posting." })
          ] }) }) })
        ] })
      ]
    }
  );
}
const route17 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3,
  default: MappingPage,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
const loader$2 = async ({ request }) => {
  var _a2, _b, _c;
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const connection = await getConnection(shop);
  const [counts, events] = await Promise.all([
    orderCounts(shop),
    recentEvents(shop, 8)
  ]);
  return {
    shop,
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    connected: Boolean(connection),
    status: (connection == null ? void 0 : connection.status) ?? "none",
    statusDetail: (connection == null ? void 0 : connection.statusDetail) ?? null,
    organisation: (connection == null ? void 0 : connection.organisation) ?? null,
    syncEnabled: ((_a2 = connection == null ? void 0 : connection.settings) == null ? void 0 : _a2.syncEnabled) ?? false,
    onboardingDone: Boolean(
      connection && connection.settings && connection.status === "connected" && missingSettings(connection.settings).length === 0 && connection.settings.syncEnabled
    ),
    onboardingDismissed: Boolean((_b = connection == null ? void 0 : connection.settings) == null ? void 0 : _b.onboardingDismissedAt),
    // A reachable support contact and privacy policy. Not review-gated for a
    // custom app, but the merchant still needs both, and level 1 protected-data
    // handling requires telling them what we process and why.
    // Kept in the environment so the URLs can change without a code deploy.
    supportUrl: process.env.SUPPORT_URL || "",
    privacyUrl: process.env.PRIVACY_POLICY_URL || "",
    autoPost: ((_c = connection == null ? void 0 : connection.settings) == null ? void 0 : _c.autoPost) ?? false,
    gaps: connection ? missingSettings(connection.settings) : [],
    counts,
    events: events.map((e) => ({
      id: e.id,
      level: e.level,
      message: e.message,
      createdAt: e.createdAt.toISOString()
    }))
  };
};
const action$2 = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent")) === "dismissOnboarding") {
    await prisma.scopevisioSettings.updateMany({
      where: { shop: session.shop },
      data: { onboardingDismissedAt: /* @__PURE__ */ new Date() }
    });
  }
  return { ok: true };
};
function Onboarding({
  connected,
  mappingComplete,
  syncEnabled,
  done,
  locale
}) {
  const t2 = makeT(locale);
  const steps = [
    {
      label: t2("overview.onboarding.step1"),
      detail: t2("overview.onboarding.step1.detail"),
      complete: connected,
      url: "/app/connection"
    },
    {
      label: t2("overview.onboarding.step2"),
      detail: t2("overview.onboarding.step2.detail"),
      complete: mappingComplete,
      url: "/app/mapping"
    },
    {
      label: t2("overview.onboarding.step3"),
      detail: t2("overview.onboarding.step3.detail"),
      complete: syncEnabled,
      url: "/app/mapping"
    }
  ];
  const next = steps.find((s) => !s.complete);
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
    /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
      /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: done ? t2("overview.onboarding.done") : t2("overview.onboarding.title") }),
      /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Badge, { tone: done ? "success" : "attention", children: t2("overview.onboarding.progress", {
          done: steps.filter((s) => s.complete).length
        }) }),
        done && /* @__PURE__ */ jsxs(Form, { method: "post", children: [
          /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "dismissOnboarding" }),
          /* @__PURE__ */ jsx(Button, { submit: true, variant: "plain", children: t2("overview.onboarding.dismiss") })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(BlockStack, { gap: "300", children: steps.map((step, i) => /* @__PURE__ */ jsxs(InlineStack, { gap: "300", blockAlign: "start", children: [
      /* @__PURE__ */ jsx(Badge, { tone: step.complete ? "success" : void 0, children: step.complete ? t2("overview.step.done") : String(i + 1) }),
      /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
        /* @__PURE__ */ jsx(Text, { as: "span", variant: "bodyMd", children: step.label }),
        /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: step.detail })
      ] })
    ] }, step.label)) }),
    next && /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { url: next.url, variant: "primary", children: next.label }) })
  ] }) });
}
function Stat({ label, value, tone }) {
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "100", children: [
    /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: label }),
    /* @__PURE__ */ jsx(Text, { as: "p", variant: "heading2xl", tone, children: String(value) })
  ] }) });
}
function Overview() {
  const data = useLoaderData();
  const t2 = makeT(data.locale);
  const needsAttention = data.counts.held + data.counts.pending;
  const toExport = data.counts.ready_to_export;
  const awaitingConfirm = data.counts.exported;
  return /* @__PURE__ */ jsx(
    Page,
    {
      title: t2("overview.title"),
      subtitle: data.organisation ? t2("overview.subtitle.connected", { org: data.organisation }) : t2("overview.subtitle.disconnected"),
      children: /* @__PURE__ */ jsxs(Layout, { children: [
        !(data.onboardingDone && data.onboardingDismissed) && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(
          Onboarding,
          {
            connected: data.connected && data.status === "connected",
            mappingComplete: data.connected && data.gaps.length === 0,
            syncEnabled: data.syncEnabled,
            done: data.onboardingDone,
            locale: data.locale
          }
        ) }),
        data.status === "error" && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(Banner, { tone: "critical", title: t2("overview.connection.broken"), children: [
          /* @__PURE__ */ jsx("p", { children: data.statusDetail }),
          /* @__PURE__ */ jsx("p", { children: t2("overview.connection.broken.detail") }),
          /* @__PURE__ */ jsx(Box, { paddingBlockStart: "300", children: /* @__PURE__ */ jsx(Button, { url: "/app/connection", children: t2("overview.connection.fix") }) })
        ] }) }),
        /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(InlineGrid, { columns: { xs: 2, md: 4 }, gap: "400", children: [
          /* @__PURE__ */ jsx(Stat, { label: t2("overview.stat.booked"), value: data.counts.booked, tone: "success" }),
          /* @__PURE__ */ jsx(
            Stat,
            {
              label: t2("overview.stat.attention"),
              value: needsAttention,
              tone: needsAttention > 0 ? "critical" : void 0
            }
          ),
          /* @__PURE__ */ jsx(Stat, { label: t2("overview.stat.toExport"), value: toExport }),
          /* @__PURE__ */ jsx(Stat, { label: t2("overview.stat.awaiting"), value: awaitingConfirm })
        ] }) }),
        data.connected && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
          /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
            /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("overview.mode.title") }),
            /* @__PURE__ */ jsxs(InlineStack, { gap: "200", children: [
              /* @__PURE__ */ jsx(Badge, { tone: data.syncEnabled ? "success" : "attention", children: data.syncEnabled ? t2("overview.mode.syncOn") : t2("overview.mode.syncOff") }),
              /* @__PURE__ */ jsx(Badge, { tone: data.autoPost ? "success" : "info", children: data.autoPost ? t2("overview.mode.autoPost") : t2("overview.mode.manualPost") })
            ] })
          ] }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: data.autoPost ? t2("overview.mode.autoPost.detail") : t2("overview.mode.manualPost.detail") })
        ] }) }) }),
        (toExport > 0 || awaitingConfirm > 0) && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
          /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: toExport > 0 ? t2("overview.export.ready", { n: toExport }) : t2("overview.export.awaiting", { n: awaitingConfirm }) }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: toExport > 0 ? t2("overview.export.ready.detail") : t2("overview.export.awaiting.detail") }),
          /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { url: "/app/export", variant: "primary", children: t2("overview.export.open") }) })
        ] }) }) }),
        needsAttention > 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
          /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("overview.attention.title", { n: needsAttention }) }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("overview.attention.detail") }),
          /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { url: "/app/orders", variant: "primary", children: t2("overview.attention.open") }) })
        ] }) }) }),
        (data.supportUrl || data.privacyUrl) && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsxs(FooterHelp, { children: [
          t2("overview.footer.help"),
          " ",
          data.supportUrl && /* @__PURE__ */ jsx(Link$1, { url: data.supportUrl, target: "_blank", children: t2("overview.footer.support") }),
          data.supportUrl && data.privacyUrl && " · ",
          data.privacyUrl && /* @__PURE__ */ jsx(Link$1, { url: data.privacyUrl, target: "_blank", children: t2("overview.footer.privacy") })
        ] }) }),
        data.events.length > 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
          /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
            /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("overview.activity.title") }),
            /* @__PURE__ */ jsx(Link, { to: "/app/journal", children: t2("overview.activity.all") })
          ] }),
          /* @__PURE__ */ jsx(BlockStack, { gap: "200", children: data.events.map((e) => (
            // Stacks on mobile: the timestamp sits above the message
            // rather than pinning a fixed-width column (BFS 4.1.2).
            /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
              /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: new Date(e.createdAt).toLocaleString("de-DE") }),
              /* @__PURE__ */ jsx(
                Text,
                {
                  as: "span",
                  variant: "bodySm",
                  tone: e.level === "error" ? "critical" : void 0,
                  children: e.message
                }
              )
            ] }, e.id)
          )) })
        ] }) }) })
      ] })
    }
  );
}
const route18 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2,
  default: Overview,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
const loader$1 = async ({ request }) => {
  var _a2;
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [pending, batches, connection] = await Promise.all([
    pendingExport(shop),
    openBatches(shop),
    getConnection(shop)
  ]);
  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    deliveryMode: ((_a2 = connection == null ? void 0 : connection.settings) == null ? void 0 : _a2.deliveryMode) ?? "csv",
    organisation: (connection == null ? void 0 : connection.organisation) ?? null,
    pending: pending.map((r) => ({
      id: r.id,
      orderName: r.orderName ?? r.orderGid,
      countryUsed: r.countryUsed,
      resolvedAccount: r.resolvedAccount,
      resolvedVatKey: r.resolvedVatKey,
      personalAccount: r.personalAccount,
      createdAt: r.createdAt.toISOString()
    })),
    batches: batches.map((b) => {
      var _a3;
      return {
        batchId: b.batchId,
        count: b.count,
        exportedAt: ((_a3 = b.exportedAt) == null ? void 0 : _a3.toISOString()) ?? null
      };
    })
  };
};
const action$1 = async ({ request }) => {
  var _a2, _b;
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const t2 = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const batchId = String(form.get("batchId") ?? "");
  const who = ((_b = (_a2 = session.onlineAccessInfo) == null ? void 0 : _a2.associated_user) == null ? void 0 : _b.email) ?? "a user";
  try {
    if (intent === "confirm") {
      const n = await confirmImported(shop, batchId, who);
      return { ok: true, message: t2("export.confirmed", { n }) };
    }
    if (intent === "return") {
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) {
        return { ok: false, message: t2("export.failed.needReason") };
      }
      const n = await returnBatchToQueue(shop, batchId, reason);
      return { ok: true, message: t2("export.returned", { n }) };
    }
    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t2("common.error")
    };
  }
};
function ReturnForm({
  batchId,
  busy,
  locale
}) {
  const t2 = makeT(locale);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return /* @__PURE__ */ jsx(Button, { variant: "plain", tone: "critical", onClick: () => setOpen(true), children: t2("export.failed") });
  }
  return /* @__PURE__ */ jsxs(Form, { method: "post", children: [
    /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "return" }),
    /* @__PURE__ */ jsx("input", { type: "hidden", name: "batchId", value: batchId }),
    /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
      /* @__PURE__ */ jsx(
        TextField,
        {
          label: t2("export.failed.why"),
          name: "reason",
          value: reason,
          onChange: setReason,
          autoComplete: "off",
          helpText: t2("export.failed.why.help")
        }
      ),
      /* @__PURE__ */ jsxs(InlineStack, { gap: "200", children: [
        /* @__PURE__ */ jsx(Button, { submit: true, tone: "critical", loading: busy, children: t2("export.failed.confirm") }),
        /* @__PURE__ */ jsx(Button, { variant: "plain", onClick: () => setOpen(false), children: t2("common.cancel") })
      ] })
    ] })
  ] });
}
function ExportPage() {
  const { pending, batches, deliveryMode, organisation, locale } = useLoaderData();
  const t2 = makeT(locale);
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  return /* @__PURE__ */ jsx(
    Page,
    {
      title: t2("export.title"),
      subtitle: organisation ? t2("export.subtitle", { org: organisation }) : t2("export.subtitle.plain"),
      children: /* @__PURE__ */ jsxs(Layout, { children: [
        (actionData == null ? void 0 : actionData.message) && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: actionData.ok ? "success" : "critical", children: /* @__PURE__ */ jsx("p", { children: actionData.message }) }) }),
        deliveryMode !== "csv" && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: "warning", title: t2("export.apiMode"), children: /* @__PURE__ */ jsx("p", { children: t2("export.apiMode.detail") }) }) }),
        pending.length > 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
          /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
            /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("export.ready", { n: pending.length }) }),
            /* @__PURE__ */ jsx(Badge, { tone: "success", children: t2("export.vatResolved") })
          ] }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("export.ready.detail") }),
          /* @__PURE__ */ jsx(BlockStack, { gap: "150", children: pending.map((p) => (
            // Order name above its detail line, so a long account
            // summary wraps instead of scrolling (BFS 4.1.2).
            /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
              /* @__PURE__ */ jsx(Text, { as: "span", variant: "bodyMd", fontWeight: "medium", children: p.orderName }),
              /* @__PURE__ */ jsxs(Text, { as: "span", tone: "subdued", variant: "bodySm", children: [
                p.countryUsed ?? "-",
                " · Debitor ",
                p.personalAccount ?? "-",
                " · Konto ",
                p.resolvedAccount ?? "-",
                " · ",
                p.resolvedVatKey ?? "-"
              ] })
            ] }, p.id)
          )) }),
          /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsx(Button, { url: "/app/export.csv", variant: "primary", download: true, children: t2("export.download", { n: pending.length }) }) }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("export.download.note") })
        ] }) }) }),
        batches.length > 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
          /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("export.awaiting.title") }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t2("export.awaiting.detail") }),
          batches.map((b) => /* @__PURE__ */ jsx(
            Box,
            {
              padding: "300",
              background: "bg-surface-secondary",
              borderRadius: "200",
              children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
                /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
                  /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: b.batchId }),
                  /* @__PURE__ */ jsxs(Text, { as: "span", tone: "subdued", variant: "bodySm", children: [
                    b.count,
                    " invoice",
                    b.count === 1 ? "" : "s",
                    " ·",
                    " ",
                    b.exportedAt ? new Date(b.exportedAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB") : "—"
                  ] })
                ] }),
                /* @__PURE__ */ jsxs(InlineStack, { gap: "300", blockAlign: "center", children: [
                  /* @__PURE__ */ jsxs(Form, { method: "post", children: [
                    /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "confirm" }),
                    /* @__PURE__ */ jsx("input", { type: "hidden", name: "batchId", value: b.batchId }),
                    /* @__PURE__ */ jsx(Button, { submit: true, variant: "primary", loading: busy, children: t2("export.confirm") })
                  ] }),
                  /* @__PURE__ */ jsx(Button, { url: `/app/export.csv?batch=${b.batchId}`, download: true, variant: "plain", children: t2("export.again") }),
                  /* @__PURE__ */ jsx(ReturnForm, { batchId: b.batchId, busy, locale })
                ] })
              ] })
            },
            b.batchId
          ))
        ] }) }) }),
        pending.length === 0 && batches.length === 0 && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
          EmptyState,
          {
            heading: t2("export.empty"),
            image: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
            children: /* @__PURE__ */ jsx("p", { children: t2("export.empty.detail") })
          }
        ) }) }),
        /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "200", children: [
          /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingSm", children: t2("export.how") }),
          /* @__PURE__ */ jsxs(List, { type: "number", children: [
            /* @__PURE__ */ jsx(List.Item, { children: t2("export.how.1") }),
            /* @__PURE__ */ jsx(List.Item, { children: t2("export.how.2") }),
            /* @__PURE__ */ jsx(List.Item, { children: t2("export.how.3") }),
            /* @__PURE__ */ jsx(List.Item, { children: t2("export.how.4") })
          ] }),
          /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("export.how.note") })
        ] }) }) })
      ] })
    }
  );
}
const route19 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: ExportPage,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
const ORDER_QUERY = `#graphql
  query ConnectorOrder($id: ID!) {
    order(id: $id) {
      id
      name
      number
      createdAt
      processedAt
      email
      currencyCode
      totalTaxSet { shopMoney { amount } }
      paymentGatewayNames
      customAttributes { key value }
      customer {
        id
        firstName
        lastName
        email
        phone
      }
      billingAddress {
        firstName lastName company address1 address2 zip city countryCodeV2 phone
      }
      shippingAddress {
        firstName lastName company address1 address2 zip city countryCodeV2 phone
      }
      lineItems(first: 250) {
        nodes {
          title
          sku
          quantity
          product { id }
          originalUnitPriceSet { shopMoney { amount } }
          taxLines { rate priceSet { shopMoney { amount } } }
        }
      }
    }
  }
`;
const VAT_ID_KEYS$1 = [
  "vat_id",
  "vatid",
  "vat",
  "ustid",
  "ust-id",
  "ustidnr",
  "umsatzsteuer-id",
  "tax_id",
  "vat_number"
];
async function fetchOrder(admin, orderGid) {
  var _a2, _b;
  const response = await admin.graphql(ORDER_QUERY, {
    variables: { id: orderGid }
  });
  const body = await response.json();
  const order = (_a2 = body == null ? void 0 : body.data) == null ? void 0 : _a2.order;
  if (!order) return null;
  return {
    id: order.id,
    name: order.name ?? void 0,
    orderNumber: order.number ?? void 0,
    createdAt: order.createdAt ?? void 0,
    processedAt: order.processedAt ?? order.createdAt ?? void 0,
    currencyCode: order.currencyCode ?? "EUR",
    email: order.email ?? null,
    customer: order.customer ? {
      id: order.customer.id ?? void 0,
      firstName: order.customer.firstName ?? null,
      lastName: order.customer.lastName ?? null,
      email: order.customer.email ?? null,
      phone: order.customer.phone ?? null
    } : null,
    billingAddress: order.billingAddress ?? null,
    shippingAddress: order.shippingAddress ?? null,
    totalTaxCents: moneyToCents$1(order.totalTaxSet),
    vatId: extractVatId$1(order.customAttributes),
    paymentGatewayNames: order.paymentGatewayNames ?? [],
    lineItems: (((_b = order.lineItems) == null ? void 0 : _b.nodes) ?? []).map(mapLine$1)
  };
}
function mapLine$1(line) {
  var _a2, _b, _c, _d, _e;
  const taxCents = (line.taxLines ?? []).reduce(
    (sum, t2) => sum + (moneyToCents$1(t2.priceSet) ?? 0),
    0
  );
  return {
    title: line.title ?? "Position",
    sku: line.sku ?? null,
    quantity: line.quantity ?? 1,
    unitAmount: Number(((_b = (_a2 = line.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.amount) ?? 0),
    taxCents,
    taxRate: ((_d = (_c = line.taxLines) == null ? void 0 : _c[0]) == null ? void 0 : _d.rate) ?? null,
    productId: ((_e = line.product) == null ? void 0 : _e.id) ?? null
  };
}
function moneyToCents$1(money2) {
  var _a2;
  const amount = (_a2 = money2 == null ? void 0 : money2.shopMoney) == null ? void 0 : _a2.amount;
  if (amount === void 0 || amount === null || amount === "") return void 0;
  const num = Number(amount);
  return Number.isFinite(num) ? Math.round(num * 100) : void 0;
}
function extractVatId$1(attrs) {
  for (const attr of attrs ?? []) {
    const key2 = (attr.key ?? "").toLowerCase().replace(/\s+/g, "_");
    if (VAT_ID_KEYS$1.includes(key2) && attr.value) return attr.value.trim();
  }
  return null;
}
const OVERLAP_MS = 5 * 60 * 1e3;
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1e3;
const ORDERS_QUERY = `#graphql
  query ConnectorPaidOrders($query: String!, $cursor: String) {
    orders(first: 50, query: $query, sortKey: PROCESSED_AT, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        number
        createdAt
        processedAt
        email
        currencyCode
        displayFinancialStatus
        totalTaxSet { shopMoney { amount } }
        paymentGatewayNames
        customAttributes { key value }
        customer { id firstName lastName email phone }
        billingAddress {
          firstName lastName company address1 address2 zip city countryCodeV2 phone
        }
        shippingAddress {
          firstName lastName company address1 address2 zip city countryCodeV2 phone
        }
        lineItems(first: 250) {
          nodes {
            title
            sku
            quantity
            product { id }
            originalUnitPriceSet { shopMoney { amount } }
            taxLines { rate priceSet { shopMoney { amount } } }
          }
        }
      }
    }
  }
`;
const VAT_ID_KEYS = [
  "vat_id",
  "vatid",
  "vat",
  "ustid",
  "ust-id",
  "ustidnr",
  "umsatzsteuer-id",
  "tax_id",
  "vat_number"
];
function mapGraphqlOrder(node) {
  var _a2, _b;
  return {
    id: node.id,
    name: node.name ?? void 0,
    orderNumber: node.number ?? void 0,
    createdAt: node.createdAt ?? void 0,
    processedAt: node.processedAt ?? node.createdAt ?? void 0,
    currencyCode: node.currencyCode ?? "EUR",
    email: node.email ?? null,
    customer: ((_a2 = node.customer) == null ? void 0 : _a2.id) ? {
      id: node.customer.id,
      firstName: node.customer.firstName ?? null,
      lastName: node.customer.lastName ?? null,
      email: node.customer.email ?? null,
      phone: node.customer.phone ?? null
    } : null,
    billingAddress: node.billingAddress ?? null,
    shippingAddress: node.shippingAddress ?? null,
    totalTaxCents: moneyToCents(node.totalTaxSet),
    vatId: extractVatId(node.customAttributes),
    paymentGatewayNames: node.paymentGatewayNames ?? [],
    lineItems: (((_b = node.lineItems) == null ? void 0 : _b.nodes) ?? []).map(mapLine)
  };
}
function mapLine(line) {
  var _a2, _b, _c, _d, _e;
  const taxCents = (line.taxLines ?? []).reduce(
    (sum, t2) => sum + (moneyToCents(t2.priceSet) ?? 0),
    0
  );
  return {
    title: line.title ?? "Position",
    sku: line.sku ?? null,
    quantity: line.quantity ?? 1,
    unitAmount: Number(((_b = (_a2 = line.originalUnitPriceSet) == null ? void 0 : _a2.shopMoney) == null ? void 0 : _b.amount) ?? 0),
    taxCents,
    taxRate: ((_d = (_c = line.taxLines) == null ? void 0 : _c[0]) == null ? void 0 : _d.rate) ?? null,
    productId: ((_e = line.product) == null ? void 0 : _e.id) ?? null
  };
}
function moneyToCents(money2) {
  var _a2;
  const amount = (_a2 = money2 == null ? void 0 : money2.shopMoney) == null ? void 0 : _a2.amount;
  if (amount === void 0 || amount === null || amount === "") return void 0;
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : void 0;
}
function extractVatId(attrs) {
  for (const attr of attrs ?? []) {
    const key2 = (attr.key ?? "").toLowerCase().replace(/\s+/g, "_");
    if (VAT_ID_KEYS.includes(key2) && attr.value) return attr.value.trim();
  }
  return null;
}
function buildOrderQuery(since) {
  return `financial_status:paid processed_at:>='${since.toISOString()}'`;
}
async function pollOrders(shop, admin, opts = {}) {
  var _a2, _b, _c, _d, _e;
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  const since = opts.since ?? ((settings == null ? void 0 : settings.lastPolledAt) ? new Date(settings.lastPolledAt.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS));
  const query = buildOrderQuery(since);
  const result = {
    scanned: 0,
    prepared: 0,
    skipped: 0,
    held: 0,
    errors: [],
    since: since.toISOString(),
    pages: 0
  };
  const runStartedAt = /* @__PURE__ */ new Date();
  const maxPages = opts.maxPages ?? 10;
  let cursor = null;
  do {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { query, cursor }
    });
    const body = await response.json();
    if ((_a2 = body.errors) == null ? void 0 : _a2.length) {
      const messages = body.errors.map((e) => e.message ?? "unknown").join("; ");
      result.errors.push(messages);
      await logEvent(shop, {
        level: "error",
        event: "intake.query_failed",
        message: `Could not read orders from Shopify: ${messages}`
      });
      break;
    }
    const nodes = ((_c = (_b = body.data) == null ? void 0 : _b.orders) == null ? void 0 : _c.nodes) ?? [];
    result.pages += 1;
    for (const node of nodes) {
      result.scanned += 1;
      try {
        const outcome = await syncOrder(shop, mapGraphqlOrder(node));
        if (outcome.state === "ready_to_export" || outcome.state === "booked") {
          result.prepared += 1;
        } else if (outcome.state === "held") {
          result.held += 1;
        } else {
          result.skipped += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${node.name ?? node.id}: ${message}`);
      }
    }
    const pageInfo = (_e = (_d = body.data) == null ? void 0 : _d.orders) == null ? void 0 : _e.pageInfo;
    cursor = (pageInfo == null ? void 0 : pageInfo.hasNextPage) ? pageInfo.endCursor ?? null : null;
  } while (cursor && result.pages < maxPages);
  if (settings) {
    await prisma.scopevisioSettings.update({
      where: { shop },
      data: { lastPolledAt: runStartedAt }
    });
  }
  await logEvent(shop, {
    level: result.errors.length ? "warn" : "info",
    event: "intake.polled",
    message: `Checked Shopify for paid orders since ${since.toLocaleString("de-DE")}: ${result.scanned} found, ${result.prepared} prepared, ${result.held} held, ${result.skipped} already handled.`,
    data: result
  });
  return result;
}
const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [rows, counts] = await Promise.all([
    heldOrders(shop, 100),
    orderCounts(shop)
  ]);
  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      orderGid: r.orderGid,
      orderName: r.orderName,
      state: r.state,
      reason: r.reason,
      detail: r.detail,
      documentNumber: r.documentNumber,
      countryUsed: r.countryUsed,
      shopifyTaxCents: r.shopifyTaxCents,
      erpTaxCents: r.erpTaxCents,
      attempts: r.attempts,
      createdAt: r.createdAt.toISOString()
    }))
  };
};
const action = async ({ request }) => {
  var _a2, _b;
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const t2 = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const orderGid = String(form.get("orderGid") ?? "");
  try {
    if (intent === "decline") {
      const note = String(form.get("note") ?? "").trim();
      if (!note) {
        return { ok: false, message: t2("orders.decline.needReason") };
      }
      await declineOrder(shop, orderGid, ((_b = (_a2 = session.onlineAccessInfo) == null ? void 0 : _a2.associated_user) == null ? void 0 : _b.email) ?? "a user", note);
      return { ok: true, message: t2("orders.decline.done") };
    }
    if (intent === "retry") {
      await requeueOrder(shop, orderGid);
      const order = await fetchOrder(admin, orderGid);
      if (!order) {
        return { ok: false, message: t2("orders.retry.gone") };
      }
      const outcome = await syncOrder(shop, order);
      if (outcome.state === "booked") {
        return { ok: true, message: `Booked as ${outcome.documentNumber}.` };
      }
      if (outcome.state === "held") {
        return { ok: false, message: outcome.detail };
      }
      if (outcome.state === "ready_to_export") {
        return { ok: true, message: t2("orders.retry.prepared") };
      }
      return { ok: false, message: `Skipped: ${outcome.reason}.` };
    }
    if (intent === "poll") {
      const r = await pollOrders(shop, admin);
      if (r.errors.length) {
        return {
          ok: false,
          message: `Checked Shopify: ${r.scanned} order(s) found, ${r.prepared} prepared. Problems: ${r.errors.slice(0, 3).join("; ")}`
        };
      }
      return {
        ok: true,
        message: r.scanned === 0 ? t2("orders.check.none") : t2("orders.check.result", {
          scanned: r.scanned,
          prepared: r.prepared,
          held: r.held,
          skipped: r.skipped
        })
      };
    }
    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t2("common.error")
    };
  }
};
function OrderRow({
  row,
  busy,
  locale
}) {
  const t2 = makeT(locale);
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
    /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
      /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [
        /* @__PURE__ */ jsx(Text, { as: "h3", variant: "headingMd", children: row.orderName ?? row.orderGid }),
        /* @__PURE__ */ jsx(Badge, { tone: row.reason === "awaiting_manual_post" ? "info" : "attention", children: HOLD_REASON_LABEL[row.reason ?? ""] ?? row.reason ?? row.state }),
        row.countryUsed && /* @__PURE__ */ jsx(Badge, { children: row.countryUsed })
      ] }),
      /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: new Date(row.createdAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB") })
    ] }),
    row.detail && /* @__PURE__ */ jsx(Text, { as: "p", children: row.detail }),
    row.shopifyTaxCents !== null && row.erpTaxCents !== null && /* @__PURE__ */ jsx(
      Box,
      {
        background: "bg-surface-secondary",
        padding: "300",
        borderRadius: "200",
        children: /* @__PURE__ */ jsxs(InlineStack, { gap: "500", children: [
          /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
            /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: t2("orders.tax.shopify") }),
            /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: (row.shopifyTaxCents / 100).toFixed(2) })
          ] }),
          /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
            /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: t2("orders.tax.erp") }),
            /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", children: (row.erpTaxCents / 100).toFixed(2) })
          ] }),
          /* @__PURE__ */ jsxs(BlockStack, { gap: "050", children: [
            /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", variant: "bodySm", children: t2("orders.tax.diff") }),
            /* @__PURE__ */ jsx(Text, { as: "span", variant: "headingSm", tone: "critical", children: ((row.erpTaxCents - row.shopifyTaxCents) / 100).toFixed(2) })
          ] })
        ] })
      }
    ),
    row.documentNumber && /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("orders.doc.unposted", { n: row.documentNumber ?? "" }) }),
    row.attempts > 1 && /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("orders.attempts", { n: row.attempts }) }),
    /* @__PURE__ */ jsxs(InlineStack, { gap: "300", children: [
      /* @__PURE__ */ jsxs(Form, { method: "post", children: [
        /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "retry" }),
        /* @__PURE__ */ jsx("input", { type: "hidden", name: "orderGid", value: row.orderGid }),
        /* @__PURE__ */ jsx(Button, { submit: true, loading: busy, children: t2("orders.retry") })
      ] }),
      !declining ? /* @__PURE__ */ jsx(Button, { variant: "plain", tone: "critical", onClick: () => setDeclining(true), children: t2("orders.decline") }) : /* @__PURE__ */ jsxs(Form, { method: "post", children: [
        /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "decline" }),
        /* @__PURE__ */ jsx("input", { type: "hidden", name: "orderGid", value: row.orderGid }),
        /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: t2("orders.decline.why"),
              name: "note",
              value: note,
              onChange: setNote,
              autoComplete: "off",
              helpText: t2("orders.decline.why.help")
            }
          ),
          /* @__PURE__ */ jsxs(InlineStack, { gap: "200", children: [
            /* @__PURE__ */ jsx(Button, { submit: true, tone: "critical", loading: busy, children: t2("orders.decline.confirm") }),
            /* @__PURE__ */ jsx(Button, { variant: "plain", onClick: () => setDeclining(false), children: t2("common.cancel") })
          ] })
        ] })
      ] })
    ] })
  ] }) });
}
function OrdersPage() {
  const { rows, counts, locale } = useLoaderData();
  const t2 = makeT(locale);
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  return /* @__PURE__ */ jsx(
    Page,
    {
      title: t2("orders.title"),
      subtitle: t2("orders.subtitle", {
        booked: counts.booked,
        waiting: counts.held + counts.pending,
        declined: counts.declined
      }),
      children: /* @__PURE__ */ jsxs(Layout, { children: [
        (actionData == null ? void 0 : actionData.message) && /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Banner, { tone: actionData.ok ? "success" : "critical", children: /* @__PURE__ */ jsx("p", { children: actionData.message }) }) }),
        /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(BlockStack, { gap: "300", children: /* @__PURE__ */ jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [
          /* @__PURE__ */ jsxs(BlockStack, { gap: "100", children: [
            /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t2("orders.check.title") }),
            /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", variant: "bodySm", children: t2("orders.check.detail") })
          ] }),
          /* @__PURE__ */ jsxs(Form, { method: "post", children: [
            /* @__PURE__ */ jsx("input", { type: "hidden", name: "intent", value: "poll" }),
            /* @__PURE__ */ jsx(Button, { submit: true, loading: busy, children: t2("orders.check.button") })
          ] })
        ] }) }) }) }),
        /* @__PURE__ */ jsx(Layout.Section, { children: rows.length === 0 ? /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
          EmptyState,
          {
            heading: t2("orders.empty"),
            image: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
            children: /* @__PURE__ */ jsx("p", { children: t2("orders.empty.detail") })
          }
        ) }) : /* @__PURE__ */ jsx(BlockStack, { gap: "400", children: rows.map((row) => /* @__PURE__ */ jsx(OrderRow, { row, busy, locale }, row.id)) }) })
      ] })
    }
  );
}
const route20 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: OrdersPage,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-Dhu8gEyC.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/root-Cx75lOc4.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js"], "css": [] }, "routes/webhooks.customers.data_request": { "id": "routes/webhooks.customers.data_request", "parentId": "root", "path": "webhooks/customers/data_request", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.data_request-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.app.scopes_update": { "id": "routes/webhooks.app.scopes_update", "parentId": "root", "path": "webhooks/app/scopes_update", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.scopes_update-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.customers.redact": { "id": "routes/webhooks.customers.redact", "parentId": "root", "path": "webhooks/customers/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.redact-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.app.uninstalled": { "id": "routes/webhooks.app.uninstalled", "parentId": "root", "path": "webhooks/app/uninstalled", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.uninstalled-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.refunds.create": { "id": "routes/webhooks.refunds.create", "parentId": "root", "path": "webhooks/refunds/create", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.refunds.create-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.orders.paid": { "id": "routes/webhooks.orders.paid", "parentId": "root", "path": "webhooks/orders/paid", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.orders.paid-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/webhooks.shop.redact": { "id": "routes/webhooks.shop.redact", "parentId": "root", "path": "webhooks/shop/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.shop.redact-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/screenshots.$view": { "id": "routes/screenshots.$view", "parentId": "root", "path": "screenshots/:view", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/screenshots._view-3UpZAjI1.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/de-lWiDC-7d.js", "/assets/styles-BLN5rIIE.js", "/assets/i18n-BjooSoZn.js", "/assets/components-CPqbnSvQ.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/List-BbYnXTh1.js", "/assets/FormLayout-9VZXUKMe.js", "/assets/Select-Df4TkmM1.js", "/assets/InlineGrid-iBPIpSsD.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/auth.login": { "id": "routes/auth.login", "parentId": "root", "path": "auth/login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/route-BHXntfdl.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/styles-BLN5rIIE.js", "/assets/components-CPqbnSvQ.js", "/assets/Page-DGkovL0o.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/healthz": { "id": "routes/healthz", "parentId": "root", "path": "healthz", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/healthz-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/route-Dw0bt3c7.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js"], "css": ["/assets/route-Xpdx9QZl.css"] }, "routes/auth.$": { "id": "routes/auth.$", "parentId": "root", "path": "auth/*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/auth._-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/app": { "id": "routes/app", "parentId": "root", "path": "app", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": true, "module": "/assets/app-T2brw5nh.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js", "/assets/styles-BLN5rIIE.js", "/assets/de-lWiDC-7d.js", "/assets/i18n-BjooSoZn.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app.export[.]csv": { "id": "routes/app.export[.]csv", "parentId": "routes/app", "path": "export.csv", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.export_._csv-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/app.connection": { "id": "routes/app.connection", "parentId": "routes/app", "path": "connection", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.connection-CiV3Rgyg.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js", "/assets/i18n-BjooSoZn.js", "/assets/tax-rules-HSxLYkA0.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/Banner-DU5rG1kC.js", "/assets/FormLayout-9VZXUKMe.js", "/assets/Link-DAvUM-df.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app.journal": { "id": "routes/app.journal", "parentId": "routes/app", "path": "journal", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.journal-DCBjVvM9.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/i18n-BjooSoZn.js", "/assets/components-CPqbnSvQ.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/EmptyState-n82C89U5.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app.mapping": { "id": "routes/app.mapping", "parentId": "routes/app", "path": "mapping", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.mapping-B6pSpU2n.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js", "/assets/tax-rules-HSxLYkA0.js", "/assets/i18n-BjooSoZn.js", "/assets/Page-DGkovL0o.js", "/assets/Banner-DU5rG1kC.js", "/assets/Layout-Cjs8li6l.js", "/assets/List-BbYnXTh1.js", "/assets/FormLayout-9VZXUKMe.js", "/assets/Select-Df4TkmM1.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app._index": { "id": "routes/app._index", "parentId": "routes/app", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app._index-UJVOmYEV.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/i18n-BjooSoZn.js", "/assets/components-CPqbnSvQ.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/Banner-DU5rG1kC.js", "/assets/InlineGrid-iBPIpSsD.js", "/assets/Link-DAvUM-df.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app.export": { "id": "routes/app.export", "parentId": "routes/app", "path": "export", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.export-Cykde5F3.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js", "/assets/i18n-BjooSoZn.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/Banner-DU5rG1kC.js", "/assets/EmptyState-n82C89U5.js", "/assets/List-BbYnXTh1.js", "/assets/context-BXBMOLBD.js"], "css": [] }, "routes/app.orders": { "id": "routes/app.orders", "parentId": "routes/app", "path": "orders", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app.orders-B3ki_tHF.js", "imports": ["/assets/jsx-runtime-0DLF9kdB.js", "/assets/components-CPqbnSvQ.js", "/assets/tax-rules-HSxLYkA0.js", "/assets/i18n-BjooSoZn.js", "/assets/Page-DGkovL0o.js", "/assets/Layout-Cjs8li6l.js", "/assets/Banner-DU5rG1kC.js", "/assets/EmptyState-n82C89U5.js", "/assets/context-BXBMOLBD.js"], "css": [] } }, "url": "/assets/manifest-5be6aaec.js", "version": "5be6aaec" };
const mode = "production";
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "v3_fetcherPersist": true, "v3_relativeSplatPath": true, "v3_throwAbortReason": true, "v3_routeConfig": true, "v3_singleFetch": false, "v3_lazyRouteDiscovery": true, "unstable_optimizeDeps": false };
const isSpaMode = false;
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/webhooks.customers.data_request": {
    id: "routes/webhooks.customers.data_request",
    parentId: "root",
    path: "webhooks/customers/data_request",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/webhooks.app.scopes_update": {
    id: "routes/webhooks.app.scopes_update",
    parentId: "root",
    path: "webhooks/app/scopes_update",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/webhooks.customers.redact": {
    id: "routes/webhooks.customers.redact",
    parentId: "root",
    path: "webhooks/customers/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/webhooks.app.uninstalled": {
    id: "routes/webhooks.app.uninstalled",
    parentId: "root",
    path: "webhooks/app/uninstalled",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/webhooks.refunds.create": {
    id: "routes/webhooks.refunds.create",
    parentId: "root",
    path: "webhooks/refunds/create",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/webhooks.orders.paid": {
    id: "routes/webhooks.orders.paid",
    parentId: "root",
    path: "webhooks/orders/paid",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/webhooks.shop.redact": {
    id: "routes/webhooks.shop.redact",
    parentId: "root",
    path: "webhooks/shop/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/screenshots.$view": {
    id: "routes/screenshots.$view",
    parentId: "root",
    path: "screenshots/:view",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/auth.login": {
    id: "routes/auth.login",
    parentId: "root",
    path: "auth/login",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/healthz": {
    id: "routes/healthz",
    parentId: "root",
    path: "healthz",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route11
  },
  "routes/auth.$": {
    id: "routes/auth.$",
    parentId: "root",
    path: "auth/*",
    index: void 0,
    caseSensitive: void 0,
    module: route12
  },
  "routes/app": {
    id: "routes/app",
    parentId: "root",
    path: "app",
    index: void 0,
    caseSensitive: void 0,
    module: route13
  },
  "routes/app.export[.]csv": {
    id: "routes/app.export[.]csv",
    parentId: "routes/app",
    path: "export.csv",
    index: void 0,
    caseSensitive: void 0,
    module: route14
  },
  "routes/app.connection": {
    id: "routes/app.connection",
    parentId: "routes/app",
    path: "connection",
    index: void 0,
    caseSensitive: void 0,
    module: route15
  },
  "routes/app.journal": {
    id: "routes/app.journal",
    parentId: "routes/app",
    path: "journal",
    index: void 0,
    caseSensitive: void 0,
    module: route16
  },
  "routes/app.mapping": {
    id: "routes/app.mapping",
    parentId: "routes/app",
    path: "mapping",
    index: void 0,
    caseSensitive: void 0,
    module: route17
  },
  "routes/app._index": {
    id: "routes/app._index",
    parentId: "routes/app",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route18
  },
  "routes/app.export": {
    id: "routes/app.export",
    parentId: "routes/app",
    path: "export",
    index: void 0,
    caseSensitive: void 0,
    module: route19
  },
  "routes/app.orders": {
    id: "routes/app.orders",
    parentId: "routes/app",
    path: "orders",
    index: void 0,
    caseSensitive: void 0,
    module: route20
  }
};
export {
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  mode,
  publicPath,
  routes
};
