import { tryDecrypt } from "@erp/scopevisio-core";

import prisma from "./db.js";
import type { ShopwareOrder } from "./order-mapper.js";

/**
 * Shopware Admin API client, scoped to one shop.
 *
 * Auth is OAuth2 client_credentials against the shop's own
 * `/api/oauth/token`, using the apiKey/secretKey pair Shopware handed us during
 * registration. Note what is NOT here: the merchant's Shopware login. Shopware
 * never shares it, which is the property an ERP marketplace needs and the one
 * OpenScope's password grant currently gives up.
 */

export class ShopwareApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ShopwareApiError";
  }
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokens = new Map<string, TokenCache>();

/** Refresh this many ms before the token actually expires. */
const SKEW_MS = 30_000;

export class ShopwareClient {
  private constructor(
    private readonly shopId: string,
    private readonly shopUrl: string,
    private readonly apiKey: string,
    private readonly secretKey: string,
  ) {}

  static async forShop(shopId: string): Promise<ShopwareClient> {
    const shop = await prisma.shopwareShop.findUnique({ where: { shopId } });
    if (!shop) throw new ShopwareApiError(`Unknown Shopware shop ${shopId}.`);

    const apiKey = tryDecrypt(shop.apiKeyEnc);
    const secretKey = tryDecrypt(shop.secretKeyEnc);
    if (!apiKey || !secretKey) {
      throw new ShopwareApiError(
        `Shop ${shopId} has no usable Admin API credentials. It has to be reinstalled.`,
      );
    }
    return new ShopwareClient(shopId, shop.shopUrl.replace(/\/+$/, ""), apiKey, secretKey);
  }

  private async accessToken(force = false): Promise<string> {
    const cached = tokens.get(this.shopId);
    if (!force && cached && cached.expiresAt - SKEW_MS > Date.now()) return cached.token;

    const res = await fetch(`${this.shopUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.apiKey,
        client_secret: this.secretKey,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new ShopwareApiError(
        `Shopware rejected the Admin API credentials for ${this.shopId} (HTTP ${res.status}).`,
        res.status,
        text.slice(0, 1000),
      );
    }

    const body = JSON.parse(text) as { access_token: string; expires_in?: number };
    const entry: TokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
    };
    tokens.set(this.shopId, entry);
    return entry.token;
  }

  private async request<T>(
    method: string,
    path: string,
    json?: unknown,
    retryOn401 = true,
  ): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${this.shopUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });

    // A 401 mid-flight means the cached token died early; refresh once.
    if (res.status === 401 && retryOn401) {
      await this.accessToken(true);
      return this.request<T>(method, path, json, false);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new ShopwareApiError(
        `Shopware request to ${path} failed (HTTP ${res.status}).`,
        res.status,
        text.slice(0, 2000),
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Fetch one order with everything the mapper needs.
   *
   * Shopware returns only scalar fields unless associations are asked for by
   * name, and a missing association is silently absent rather than an error —
   * so an order fetched without `deliveries` looks exactly like an order with
   * no shipping address. Every association the mapper reads is listed here.
   */
  async fetchOrder(orderId: string): Promise<ShopwareOrder | null> {
    const body = {
      ids: [orderId],
      associations: {
        orderCustomer: {},
        billingAddress: { associations: { country: {} } },
        deliveries: {
          associations: { shippingOrderAddress: { associations: { country: {} } } },
        },
        lineItems: {},
        transactions: { associations: { paymentMethod: {} } },
        currency: {},
      },
    };

    const res = await this.request<{ data?: ShopwareOrder[] }>(
      "POST",
      "/api/search/order",
      body,
    );
    return res?.data?.[0] ?? null;
  }

}
