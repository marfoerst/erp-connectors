import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { logEvent } from "../scopevisio/log.server";

/**
 * GDPR mandatory topic. Shopify requires the app to respond; the merchant is
 * the controller and must fulfil the request. We record that it arrived so the
 * merchant has the audit trail, and so the request is not silently dropped.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  await logEvent(shop, {
    level: "warn",
    event: "gdpr.data_request",
    message:
      "A customer data request arrived from Shopify. The connector stores order sync state and, in Scopevisio, contact and document data. Booked documents are subject to GoBD retention and cannot be deleted.",
    data: { topic, payload },
  });

  return new Response();
};
