import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { mapOrder, type ShopifyOrderPayload } from "../scopevisio/order-mapper.server";
import { syncOrder } from "../scopevisio/sync.server";
import { logEvent } from "../scopevisio/log.server";

/**
 * `orders/paid` is the trigger, not `orders/create`: an invoice should follow
 * the payment, not the intent to buy.
 *
 * Shopify delivers webhooks at least once, so this handler must be safe to run
 * repeatedly for the same order. Idempotency lives in syncOrder (unique key on
 * OrderSync) rather than here.
 *
 * We always answer 200. A non-2xx would make Shopify retry, and for a
 * business-logic hold — a tax case we refuse to guess at — retrying changes
 * nothing. The order is recorded as held instead, which is visible in the app.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    const order = mapOrder(payload as ShopifyOrderPayload);

    if (!order.id) {
      await logEvent(shop, {
        level: "error",
        event: "webhook.malformed",
        message: `${topic} arrived without an order id; nothing was booked.`,
      });
      return new Response();
    }

    await syncOrder(shop, order);
  } catch (err) {
    // Never let an exception reach Shopify as a 5xx — that would spin the
    // retry machinery on something a retry cannot fix.
    await logEvent(shop, {
      level: "error",
      event: "webhook.failed",
      message: `${topic} could not be processed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  return new Response();
};
