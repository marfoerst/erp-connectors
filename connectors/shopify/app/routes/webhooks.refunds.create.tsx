import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { mapRefund, type ShopifyRefundPayload } from "../scopevisio/order-mapper.server";
import { syncRefund } from "../scopevisio/refunds.server";
import { logEvent } from "../scopevisio/log.server";

/**
 * A posted Faktura is immutable under GoBD, so a refund becomes a Gutschrift
 * referencing the original document — never an edit of it.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    const refund = mapRefund(payload as ShopifyRefundPayload);

    if (!refund.orderGid) {
      await logEvent(shop, {
        level: "error",
        event: "webhook.malformed",
        message: `${topic} arrived without an order reference; no credit note was created.`,
      });
      return new Response();
    }

    await syncRefund(shop, refund);
  } catch (err) {
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
