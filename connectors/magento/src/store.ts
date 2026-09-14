import {
  scrub,
  scrubValue,
  ScopevisioClient,
  type ConnectionRecord,
  type ConnectionStore,
  type Journal,
  type JournalEntry,
  type ScopevisioContext,
} from "@erp/scopevisio-core";

import prisma from "./db.js";

/**
 * Binds `@erp/scopevisio-core` to this connector's storage — the same two
 * ports as the Shopify and Shopware connectors, keyed by our own store id.
 */

export function connectionStore(storeId: string): ConnectionStore {
  return {
    async load(): Promise<ConnectionRecord | null> {
      const row = await prisma.scopevisioConnection.findUnique({ where: { storeId } });
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
      // Called on every token refresh; a store deleted mid-flight must not throw.
      await prisma.scopevisioConnection.updateMany({ where: { storeId }, data: patch });
    },
  };
}

export async function recordEvent(storeId: string, entry: JournalEntry) {
  await prisma.syncEvent.create({
    data: {
      storeId,
      level: entry.level ?? "info",
      event: entry.event,
      message: scrubValue(entry.message).slice(0, 2000),
      externalId: entry.externalId ?? null,
      data: entry.data === undefined ? null : JSON.stringify(scrub(entry.data)).slice(0, 8000),
    },
  });
}

export function journal(storeId: string): Journal {
  return { event: (entry) => recordEvent(storeId, entry) };
}

export async function scopevisioContext(storeId: string): Promise<ScopevisioContext> {
  return {
    client: await ScopevisioClient.fromStore(connectionStore(storeId)),
    journal: journal(storeId),
  };
}
