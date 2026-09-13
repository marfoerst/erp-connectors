/**
 * Shopware webhook payloads.
 *
 * `data.payload` for a state-machine transition carries the entity that
 * changed, which for `state_enter.order_transaction.state.paid` is the
 * TRANSACTION, not the order. The order id has to be resolved from it — a
 * detail that is easy to miss and produces a connector that silently books
 * nothing.
 */
export interface ShopwareWebhookBody {
  source?: { url?: string; appVersion?: string; shopId?: string; eventId?: string };
  data?: {
    event?: string;
    payload?: unknown;
  };
  timestamp?: number;
}

/**
 * Pull transaction ids out of a state-transition payload.
 *
 * Shopware has shipped this payload as both an object and an array of objects
 * across versions, so both are accepted rather than assuming one.
 */
export function transactionIdsFrom(body: ShopwareWebhookBody): string[] {
  const payload = body.data?.payload;
  const items = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const ids: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = rec.id ?? rec.entityId ?? (rec.primaryKey as string | undefined);
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

export function shopIdFrom(body: ShopwareWebhookBody): string | null {
  const id = body.source?.shopId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
