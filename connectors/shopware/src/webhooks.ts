/**
 * Shopware webhook payloads.
 *
 * ⚠️ Corrected against Shopware 6.7.2.2 after a live install. The first
 * implementation assumed `state_enter.order_transaction.state.paid` carried the
 * TRANSACTION and resolved the order from it. It does not: `data.payload` is an
 * object holding the whole order under `order`. The old code found no id, hit a
 * `continue`, and booked nothing at all — silently, with a 200 response.
 *
 * The captured payload is in `__fixtures__/order-paid-webhook.json`, taken from
 * a real delivery rather than written from documentation.
 *
 * The inline order is NOT sufficient on its own: `billingAddress` comes through
 * as null, and that is what decides the destination country and the invoice
 * recipient. So the order id is taken from the webhook and the full order is
 * then fetched over the Admin API.
 */
export interface ShopwareWebhookBody {
  source?: {
    url?: string;
    appVersion?: string;
    shopId?: string;
    eventId?: string;
    inAppPurchases?: unknown;
  };
  data?: {
    event?: string;
    payload?: unknown;
  };
  timestamp?: number;
}

function idOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  for (const key of ["id", "entityId", "primaryKey"]) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Order ids carried by a state-transition webhook.
 *
 * Handles the shape Shopware actually sends (`payload.order`), the array form
 * other events use, and a bare entity payload — because the payload shape
 * varies by event and assuming one of them is what caused the original bug.
 */
export function orderIdsFrom(body: ShopwareWebhookBody): string[] {
  const payload = body.data?.payload;
  const items = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const ids: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    // The real shape: { order: { id, ... } }
    const fromOrder = idOf(rec.order);
    if (fromOrder) {
      ids.push(fromOrder);
      continue;
    }
    // A bare entity payload, or an orderId reference.
    const orderId = rec.orderId;
    if (typeof orderId === "string" && orderId.length > 0) {
      ids.push(orderId);
      continue;
    }
    const bare = idOf(rec);
    if (bare) ids.push(bare);
  }
  return ids;
}

export function shopIdFrom(body: ShopwareWebhookBody): string | null {
  const id = body.source?.shopId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function eventNameFrom(body: ShopwareWebhookBody): string | null {
  const e = body.data?.event;
  return typeof e === "string" && e.length > 0 ? e : null;
}
