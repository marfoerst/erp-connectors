import prisma from "../db.server";
import { encrypt, tryDecrypt } from "./crypto.server";
import type { TokenResponse } from "./types";

/**
 * Scopevisio OpenScope REST client, scoped to one Shopify shop.
 *
 * Auth flow (docs/API-FINDINGS.md §2): POST /rest/token with grant_type=password
 * returns a short-lived access token and a long-lived refresh token. Once we
 * hold a refresh token we drop the stored password, so a compromise of the
 * database does not hand over the merchant's Scopevisio login.
 */

export class ScopevisioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
    /** True when the merchant has to act (bad credentials, missing profile). */
    readonly merchantActionable = false,
  ) {
    super(message);
    this.name = "ScopevisioError";
  }
}

/** Access tokens are refreshed this many seconds before they actually expire. */
const EXPIRY_SKEW_SECONDS = 60;

export interface ConnectionInput {
  baseUrl?: string;
  customer: string;
  /**
   * Optional. The token endpoint resolves the organisation from the customer
   * number and user, and returns its name — so this is only needed when a user
   * belongs to more than one organisation.
   */
  organisation?: string;
  username: string;
  password: string;
}

type ConnectionRow = NonNullable<
  Awaited<ReturnType<typeof prisma.scopevisioConnection.findUnique>>
>;

export class ScopevisioClient {
  private constructor(
    private readonly shop: string,
    private conn: ConnectionRow,
  ) {}

  static async forShop(shop: string): Promise<ScopevisioClient> {
    const conn = await prisma.scopevisioConnection.findUnique({ where: { shop } });
    if (!conn) {
      throw new ScopevisioError(
        "No Scopevisio connection configured for this shop.",
        undefined,
        undefined,
        true,
      );
    }
    return new ScopevisioClient(shop, conn);
  }

  /** Build a client from credentials that are not saved yet, to test them. */
  static ephemeral(shop: string, input: ConnectionInput): ScopevisioClient {
    const now = new Date();
    const row = {
      id: "ephemeral",
      shop,
      baseUrl: input.baseUrl ?? "https://appload.scopevisio.com",
      customer: input.customer,
      organisation: input.organisation ?? "",
      username: input.username,
      passwordEnc: encrypt(input.password),
      refreshTokenEnc: null,
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      status: "unverified",
      statusDetail: null,
      lastCheckAt: null,
      createdAt: now,
      updatedAt: now,
    } as ConnectionRow;
    return new ScopevisioClient(shop, row);
  }

  get baseUrl() {
    return this.conn.baseUrl.replace(/\/+$/, "");
  }

  get organisation() {
    return this.conn.organisation;
  }

  private get isPersisted() {
    return this.conn.id !== "ephemeral";
  }

  // --- token handling -------------------------------------------------------

  private async persistTokens(token: TokenResponse) {
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : new Date(Date.now() + 15 * 60 * 1000);

    const data: Record<string, unknown> = {
      accessTokenEnc: encrypt(token.access_token),
      accessTokenExpiresAt: expiresAt,
    };
    if (token.refresh_token) {
      data.refreshTokenEnc = encrypt(token.refresh_token);
      // We have a refresh token now; the password is no longer needed.
      data.passwordEnc = null;
    }
    // The endpoint tells us which organisation it authenticated against. Record
    // it when the merchant did not supply one, so the UI can show it back.
    if (token.organisationName && !this.conn.organisation) {
      data.organisation = token.organisationName;
    }

    this.conn = { ...this.conn, ...data } as ConnectionRow;

    if (this.isPersisted) {
      await prisma.scopevisioConnection.update({
        where: { shop: this.shop },
        data,
      });
    }
  }

  private async requestToken(params: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/rest/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(params).toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new ScopevisioError(
        res.status === 401 || res.status === 400
          ? "Scopevisio rejected these credentials. Check the customer number, organisation, user and password."
          : `Scopevisio token request failed (HTTP ${res.status}).`,
        res.status,
        text,
        res.status === 400 || res.status === 401 || res.status === 403,
      );
    }

    try {
      return JSON.parse(text) as TokenResponse;
    } catch {
      throw new ScopevisioError(
        "Scopevisio returned an unreadable token response.",
        res.status,
        text,
      );
    }
  }

  private async accessToken(force = false): Promise<string> {
    if (!force) {
      const cached = tryDecrypt(this.conn.accessTokenEnc);
      const exp = this.conn.accessTokenExpiresAt;
      if (
        cached &&
        exp &&
        exp.getTime() - EXPIRY_SKEW_SECONDS * 1000 > Date.now()
      ) {
        return cached;
      }
    }

    const refresh = tryDecrypt(this.conn.refreshTokenEnc);
    if (refresh) {
      try {
        const token = await this.requestToken({
          grant_type: "refresh_token",
          refresh_token: refresh,
          customer: this.conn.customer,
          ...(this.conn.organisation ? { organisation: this.conn.organisation } : {}),
        });
        await this.persistTokens(token);
        return token.access_token;
      } catch (err) {
        // Refresh token expired or revoked. Fall through to the password if we
        // still have one; otherwise the merchant must reconnect.
        if (!tryDecrypt(this.conn.passwordEnc)) {
          throw new ScopevisioError(
            "The Scopevisio connection needs to be re-authorised. Open Settings and reconnect.",
            (err as ScopevisioError).status,
            (err as ScopevisioError).body,
            true,
          );
        }
      }
    }

    const password = tryDecrypt(this.conn.passwordEnc);
    if (!password) {
      throw new ScopevisioError(
        "The Scopevisio connection needs to be re-authorised. Open Settings and reconnect.",
        undefined,
        undefined,
        true,
      );
    }

    const token = await this.requestToken({
      grant_type: "password",
      customer: this.conn.customer,
      ...(this.conn.organisation ? { organisation: this.conn.organisation } : {}),
      username: this.conn.username,
      password,
    });
    await this.persistTokens(token);
    return token.access_token;
  }

  // --- request plumbing -----------------------------------------------------

  private async raw(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string | number | boolean | undefined | null>;
      json?: unknown;
      retryOn401?: boolean;
    } = {},
  ): Promise<{ status: number; text: string }> {
    const token = await this.accessToken();

    const url = new URL(`${this.baseUrl}/rest${path.startsWith("/") ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "*/*",
    };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = typeof opts.json === "string" ? opts.json : JSON.stringify(opts.json);
    }

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();

    // A 401 mid-flight means the cached token died early; refresh once.
    if (res.status === 401 && opts.retryOn401 !== false) {
      await this.accessToken(true);
      return this.raw(method, path, { ...opts, retryOn401: false });
    }

    return { status: res.status, text };
  }

  private parse<T>(status: number, text: string, path: string): T {
    if (status < 200 || status >= 300) {
      const merchantActionable = status === 403 || status === 401;
      throw new ScopevisioError(
        merchantActionable
          ? `Scopevisio denied access to ${path}. The connector user is probably missing a profile — see the required profiles for this endpoint.`
          : `Scopevisio request to ${path} failed (HTTP ${status}).`,
        status,
        text.slice(0, 2000),
        merchantActionable,
      );
    }
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some endpoints answer with a bare string or XML; hand it back as-is.
      return text as unknown as T;
    }
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): Promise<T> {
    const { status, text } = await this.raw("GET", path, { query });
    return this.parse<T>(status, text, path);
  }

  async post<T>(
    path: string,
    json?: unknown,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): Promise<T> {
    const { status, text } = await this.raw("POST", path, { json, query });
    return this.parse<T>(status, text, path);
  }

  /**
   * `POST /{plural}` endpoints are queries whose body is a search filter, not
   * a JSON object — the spec types the body as a plain string.
   * See docs/API-FINDINGS.md §6.
   */
  async search<T>(path: string, filter: unknown): Promise<T> {
    return this.post<T>(path, JSON.stringify(filter));
  }

  /**
   * Cheap reachability probe used by the settings screen. Returns the
   * organisation the token endpoint resolved, so the UI can confirm which
   * Scopevisio organisation it actually connected to.
   */
  async verify(): Promise<{ ok: true; account: unknown; organisation: string }> {
    const account = await this.get<unknown>("/myaccount");
    return { ok: true, account, organisation: this.conn.organisation };
  }
}
