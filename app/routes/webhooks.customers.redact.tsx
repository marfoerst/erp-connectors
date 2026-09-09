import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { logEvent } from "../scopevisio/log.server";

/**
 * GDPR erasure vs. GoBD retention.
 *
 * Where a contact is attached to a posted document, German retention law wins:
 * the document — and the debitor it references — must be kept. So this handler
 * deliberately does NOT delete anything in Scopevisio. It records the request
 * and surfaces it, so a human applies restriction-of-processing rather than the
 * connector silently either deleting books or ignoring the law.
 *
 * ⚠️ The written legal position behind this behaviour is still open — see OQ-4
 * in docs/PRD.md. Do not ship publicly without it.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  await logEvent(shop, {
    level: "warn",
    event: "gdpr.customer_redact",
    message:
      "Shopify asked for a customer to be erased. Personal data attached to booked documents is retained under GoBD; restrict processing in Scopevisio instead of deleting. No data was deleted automatically.",
    data: { topic, payload },
  });

  return new Response();
};
