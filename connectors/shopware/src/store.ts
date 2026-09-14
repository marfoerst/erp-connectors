import {
  scrub,
  scrubValue,
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

// Redaction lives in core so the connectors cannot drift apart on it.
export { scrub, scrubValue };

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
