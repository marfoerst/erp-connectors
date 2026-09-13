import type { LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { createExportBatch, rebuildBatch } from "../scopevisio/csv-export.server";

/**
 * Downloads prepared invoices as a CSV for import through Scopevisio's
 * Abrechnungsbelege importer.
 *
 * No `batch` parameter → create a new batch from the queue and mark those
 * orders exported. With `batch` → re-render an existing batch without touching
 * any state, so a repeat download cannot skip or duplicate anything.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const requested = new URL(request.url).searchParams.get("batch");
  const { csv, batchId, count } = requested
    ? await rebuildBatch(session.shop, requested)
    : await createExportBatch(session.shop);

  const filename = `scopevisio-abrechnungsbelege-${batchId}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      // Explicit charset: the file carries a BOM and German umlauts.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-batch-id": batchId,
      "x-invoice-count": String(count),
      "cache-control": "no-store",
    },
  });
};
