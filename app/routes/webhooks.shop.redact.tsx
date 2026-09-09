import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * The shop is gone for good, 48 hours after uninstall. Remove everything this
 * app holds about it — including the encrypted Scopevisio credentials.
 *
 * Documents already booked in Scopevisio belong to the merchant's own ledger
 * and are untouched; they are subject to GoBD retention there.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  await db.$transaction([
    db.scopevisioConnection.deleteMany({ where: { shop } }),
    db.masterDataCache.deleteMany({ where: { shop } }),
    db.vatIdCheck.deleteMany({ where: { shop } }),
    db.orderSync.deleteMany({ where: { shop } }),
    db.syncEvent.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
