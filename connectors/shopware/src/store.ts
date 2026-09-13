import {
  ScopevisioClient,
  type ConnectionRecord,
  type ConnectionStore,
  type Journal,
  type ScopevisioContext,
} from "@erp/scopevisio-core";

import prisma from "./db.js";

/**
 * Binds `@erp/scopevisio-core` to this connector's storage.
 *
 * The mirror image of the Shopify connector's `core.server.ts`. Same two ports,
 * different key: a Shopware shop is identified by the `shopId` Shopware handed
 * us at registration, not by a myshopify domain.
 */

export function connectionStore(shopId: string): ConnectionStore {
  return {
    async load(): Promise<ConnectionRecord | null> {
      const row = await prisma.scopevisioConnection.findUnique({ where: { shopId } });
      if (!row) return null;
      return {
        baseUrl: row.baseUrl,
        customer: row.customer,
        organisation: row.organisation,
        username: row.username,
        passwordEnc: row.passwordEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        accessTokenEnc: row.accessTokenEnc,
        accessTokenExpiresAt: row.accessTokenExpiresAt,
      };
    },
    async save(patch) {
      // Called on every token refresh. A shop that uninstalled mid-flight must
      // not throw here — updateMany matches nothing and returns quietly.
      await prisma.scopevisioConnection.updateMany({ where: { shopId }, data: patch });
    },
  };
}

/**
 * Redacts credentials before anything reaches the journal.
 *
 * Key-only redaction is not enough: access tokens have turned up embedded in
 * URLs (`?access_token=…`) and inside error bodies (`Bearer …`). This scrubs
 * values as well as keys, which is the lesson the Shopify connector learned the
 * expensive way.
 */
const SENSITIVE_KEY = /pass|secret|token|authorization|apikey|api_key/i;

export function scrubValue(value: string): string {
  return value
    .replace(/(access_token|refresh_token|password|secret|api_key|apiKey)=[^&\s"']+/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer ***");
}

export function scrub(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof input === "string") return scrubValue(input);
  if (Array.isArray(input)) return input.map((v) => scrub(v, depth + 1));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "***" : scrub(v, depth + 1);
    }
    return out;
  }
  return input;
}

export function journal(shopId: string): Journal {
  return {
    async event(entry) {
      await prisma.syncEvent.create({
        data: {
          shopId,
          level: entry.level ?? "info",
          event: entry.event,
          message: scrubValue(entry.message),
          externalId: entry.externalId ?? null,
          data:
            entry.data === undefined ? null : JSON.stringify(scrub(entry.data)).slice(0, 8000),
        },
      });
    },
  };
}

export async function scopevisioContext(shopId: string): Promise<ScopevisioContext> {
  return {
    client: await ScopevisioClient.fromStore(connectionStore(shopId)),
    journal: journal(shopId),
  };
}
