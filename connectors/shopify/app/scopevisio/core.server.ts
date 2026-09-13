import {
  ScopevisioClient,
  type ConnectionRecord,
  type ConnectionStore,
  type Journal,
  type ScopevisioContext,
} from "@erp/scopevisio-core";

import prisma from "../db.server";
import { logEvent } from "./log.server";

/**
 * Binds `@erp/scopevisio-core` to this connector's storage.
 *
 * Core deliberately owns no database: a Shopify shop is keyed by its myshopify
 * domain, a Shopware shop by its shop id, and core should not have to know.
 * These two adapters are the whole of the difference.
 */

export function connectionStore(shop: string): ConnectionStore {
  return {
    async load(): Promise<ConnectionRecord | null> {
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
        accessTokenExpiresAt: row.accessTokenExpiresAt,
      };
    },
    async save(patch) {
      // Called on every token refresh. A shop that uninstalled mid-flight is
      // not an error — updateMany matches nothing and returns quietly.
      await prisma.scopevisioConnection.updateMany({ where: { shop }, data: patch });
    },
  };
}

export function journal(shop: string): Journal {
  return {
    async event(entry) {
      await logEvent(shop, {
        level: entry.level,
        event: entry.event,
        message: entry.message,
        orderGid: entry.externalId ?? null,
        data: entry.data,
      });
    },
  };
}

/** The context every core operation takes. */
export async function scopevisioContext(shop: string): Promise<ScopevisioContext> {
  return {
    client: await ScopevisioClient.fromStore(connectionStore(shop)),
    journal: journal(shop),
  };
}

/** A client without the journal, for read-only calls that log nothing. */
export function clientFor(shop: string): Promise<ScopevisioClient> {
  return ScopevisioClient.fromStore(connectionStore(shop));
}
