import { formatGermanDate } from "./format";
import type { InvoiceDraft, OrderLike, ResolvedTaxTreatment } from "./types";

/**
 * Build the delivery-agnostic invoice draft.
 *
 * Every connector produced this same shape with its own copy of the same
 * function; it lives here so the CSV renderer, the XML import and any future
 * delivery path all read one definition.
 */
export function buildInvoiceDraft(args: {
  order: OrderLike;
  treatment: ResolvedTaxTreatment;
  documentDate: Date;
  contactId: number | null;
  personalAccount: string | null;
}): InvoiceDraft {
  const { order, treatment, documentDate, contactId, personalAccount } = args;
  return {
    externalId: order.id,
    externalRef: order.name ?? null,
    documentDate: formatGermanDate(documentDate),
    contactId,
    personalAccount,
    country: treatment.country ?? null,
    taxCase: treatment.taxCase ?? null,
    vatScope: treatment.vatScope ?? null,
    account: treatment.account ?? null,
    vatKey: treatment.vatKey ?? null,
    currency: order.currencyCode ?? "EUR",
    positions: order.lineItems.map((li) => ({
      name: li.title,
      number: li.sku ?? null,
      quantity: li.quantity,
      singleAmount: li.unitAmount,
    })),
    sourceTaxCents: order.totalTaxCents ?? null,
  };
}
