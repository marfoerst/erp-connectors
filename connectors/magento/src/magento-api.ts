import { tryDecrypt } from "@erp/scopevisio-core";

import { loadConfig } from "./config.js";
import prisma from "./db.js";
import { authorizationHeader, parseTokenResponse } from "./oauth1.js";
import type { MagentoCreditMemo, MagentoInvoice, MagentoOrder } from "./order-mapper.js";

/**
 * Magento REST client, scoped to one store and signed with that store's
 * integration tokens (OAuth 1.0a — see oauth1.ts for why not bearer).
 *
 * Note what is NOT here: an admin username or password. Magento mints the
 * integration's tokens when the merchant activates it, and deactivating the
 * integration revokes them.
 */

export class MagentoApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "MagentoApiError";
  }
}

/** The URL to talk to a store at — its own base URL unless dev overrides it. */
export function reachableBaseUrl(storeBaseUrl: string): string {
  return (loadConfig().magentoUrlOverride ?? storeBaseUrl).replace(/\/+$/, "");
}

type Query = Record<string, string | number>;

function withQuery(url: string, query?: Query): string {
  if (!query || Object.keys(query).length === 0) return url;
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${url}?${qs}`;
}

export interface SearchResult<T> {
  items: T[];
  total_count: number;
}

export class MagentoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly token: string,
    private readonly tokenSecret: string,
  ) {}

  static async forStore(storeId: string): Promise<MagentoClient> {
    const store = await prisma.magentoStore.findUnique({ where: { id: storeId } });
    if (!store) throw new MagentoApiError(`Unknown Magento store ${storeId}.`);
    const consumerSecret = tryDecrypt(store.consumerSecretEnc);
    const token = tryDecrypt(store.accessTokenEnc);
    const tokenSecret = tryDecrypt(store.accessTokenSecretEnc);
    if (!consumerSecret || !token || !tokenSecret) {
      throw new MagentoApiError(
        "This store has no usable integration tokens. Reactivate the Scopevisio integration in Magento (System → Integrations).",
      );
    }
    return new MagentoClient(
      reachableBaseUrl(store.storeBaseUrl),
      store.consumerKey,
      consumerSecret,
      token,
      tokenSecret,
    );
  }

  private async request<T>(method: string, path: string, query?: Query): Promise<T | null> {
    const url = withQuery(`${this.baseUrl}${path}`, query);
    const res = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: authorizationHeader({
          method,
          url,
          consumerKey: this.consumerKey,
          consumerSecret: this.consumerSecret,
          token: this.token,
          tokenSecret: this.tokenSecret,
        }),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) {
      const hint =
        res.status === 401
          ? " The integration was probably deactivated or lacks a resource permission."
          : "";
      throw new MagentoApiError(
        `Magento request to ${path} failed (HTTP ${res.status}).${hint}`,
        res.status,
        text.slice(0, 2000),
      );
    }
    return (text ? JSON.parse(text) : null) as T | null;
  }

  getInvoice(id: number) {
    return this.request<MagentoInvoice>("GET", `/rest/V1/invoices/${id}`);
  }

  getOrder(id: number) {
    return this.request<MagentoOrder>("GET", `/rest/V1/orders/${id}`);
  }

  getCreditMemo(id: number) {
    return this.request<MagentoCreditMemo>("GET", `/rest/V1/creditmemo/${id}`);
  }

  /**
   * Paid invoices touched since `since`, oldest first.
   *
   * `state = 2` is Magento's Invoice::STATE_PAID. Dates in searchCriteria are
   * compared against the stored UTC value, so the cursor is formatted in UTC.
   */
  async paidInvoicesSince(since: Date, page: number, pageSize = 50) {
    const utc = since.toISOString().slice(0, 19).replace("T", " ");
    const sc = "searchCriteria";
    const res = await this.request<SearchResult<MagentoInvoice>>("GET", "/rest/V1/invoices", {
      [`${sc}[filter_groups][0][filters][0][field]`]: "state",
      [`${sc}[filter_groups][0][filters][0][value]`]: 2,
      [`${sc}[filter_groups][0][filters][0][condition_type]`]: "eq",
      [`${sc}[filter_groups][1][filters][0][field]`]: "updated_at",
      [`${sc}[filter_groups][1][filters][0][value]`]: utc,
      [`${sc}[filter_groups][1][filters][0][condition_type]`]: "gteq",
      [`${sc}[sortOrders][0][field]`]: "entity_id",
      [`${sc}[sortOrders][0][direction]`]: "ASC",
      [`${sc}[pageSize]`]: pageSize,
      [`${sc}[currentPage]`]: page,
    });
    return res ?? { items: [], total_count: 0 };
  }

  /** Credit memos created since `since`, oldest first. */
  async creditMemosSince(since: Date, page: number, pageSize = 50) {
    const utc = since.toISOString().slice(0, 19).replace("T", " ");
    const sc = "searchCriteria";
    const res = await this.request<SearchResult<MagentoCreditMemo>>("GET", "/rest/V1/creditmemos", {
      [`${sc}[filter_groups][0][filters][0][field]`]: "created_at",
      [`${sc}[filter_groups][0][filters][0][value]`]: utc,
      [`${sc}[filter_groups][0][filters][0][condition_type]`]: "gteq",
      [`${sc}[sortOrders][0][field]`]: "entity_id",
      [`${sc}[sortOrders][0][direction]`]: "ASC",
      [`${sc}[pageSize]`]: pageSize,
      [`${sc}[currentPage]`]: page,
    });
    return res ?? { items: [], total_count: 0 };
  }
}

/**
 * The OAuth 1.0a handshake after Magento posted the consumer credentials:
 * request token (signed with the consumer secret alone), then access token
 * (signed with the request token secret, carrying the verifier).
 */
export async function exchangeTokens(args: {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  verifier: string;
}): Promise<{ token: string; secret: string }> {
  const call = async (path: string, token?: { token: string; secret: string }) => {
    const url = `${args.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/x-www-form-urlencoded, application/json",
        authorization: authorizationHeader({
          method: "POST",
          url,
          consumerKey: args.consumerKey,
          consumerSecret: args.consumerSecret,
          token: token?.token,
          tokenSecret: token?.secret,
          oauthExtra: token ? { oauth_verifier: args.verifier } : undefined,
        }),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const parsed = res.ok ? parseTokenResponse(text) : null;
    if (!parsed) {
      throw new MagentoApiError(
        `Magento refused the OAuth ${path.endsWith("request") ? "request" : "access"} token (HTTP ${res.status}).`,
        res.status,
        text.slice(0, 1000),
      );
    }
    return parsed;
  };

  const request = await call("/oauth/token/request");
  return call("/oauth/token/access", request);
}
