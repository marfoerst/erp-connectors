import prisma from "../db.server";
import { clientFor } from "./core.server";
import {
  buildCreditXml,
  type ImportResult,
  type OrderLike,
} from "@erp/scopevisio-core";
import { logEvent } from "./log.server";
import type { RefundView } from "./order-mapper.server";

/**
 * Refund → Gutschrift.
 *
 * A posted Faktura is immutable under GoBD, so the only lawful correction is a
 * credit note referencing the original document (PRD C-008).
 *
 * ⚠️ Blocked by the same gap as invoice creation: there is no create endpoint
 * for a credit note either — every billing document goes through
 * `POST /outgoinginvoices/import`, whose XML schema is unknown (OQ-10).
 *
 * Two cases matter:
 *
 *  - The invoice was posted → create a credit note against it.
 *  - The invoice was created but never posted → there is nothing to correct,
 *    so we withdraw the pending document instead of crediting a non-existent
 *    one, and say so in the journal.
 */

export async function syncRefund(
  shop: string,
  refund: RefundView,
): Promise<
  | { state: "credited"; creditNumber: string }
  | { state: "withdrawn" }
  | { state: "held"; reason: string; detail: string }
  | { state: "skipped"; reason: string }
> {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  if (!settings?.syncEnabled) {
    return { state: "skipped", reason: "sync_disabled" };
  }

  const order = await prisma.orderSync.findUnique({
    where: { shop_orderGid: { shop, orderGid: refund.orderGid } },
  });

  if (!order) {
    await logEvent(shop, {
      level: "warn",
      event: "refund.unknown_order",
      orderGid: refund.orderGid,
      message:
        "A refund arrived for an order this connector never booked. No credit note was created.",
    });
    return {
      state: "held",
      reason: "unknown_order",
      detail:
        "This refund belongs to an order that was never booked by the connector, so there is no invoice to correct.",
    };
  }

  if (order.creditNumber) {
    return { state: "credited", creditNumber: order.creditNumber };
  }

  // Created but never posted: withdraw rather than credit.
  if (order.state !== "booked" || !order.documentNumber) {
    await prisma.orderSync.update({
      where: { id: order.id },
      data: {
        state: "declined",
        reason: "refunded_before_posting",
        detail:
          "The order was refunded before its invoice was posted, so the pending invoice was withdrawn instead of being credited.",
        resolvedBy: "connector",
        resolvedAt: new Date(),
      },
    });
    await logEvent(shop, {
      event: "refund.withdrew_pending",
      orderGid: refund.orderGid,
      message:
        "Order refunded before its invoice was posted — the pending document was withdrawn, no Gutschrift created.",
    });
    return { state: "withdrawn" };
  }

  if (!order.contactId) {
    return {
      state: "held",
      reason: "missing_contact",
      detail:
        "The original booking has no Scopevisio contact recorded, so a credit note cannot be addressed.",
    };
  }

  try {
    const client = await clientFor(shop);

    const orderLike: OrderLike = {
      id: refund.orderGid,
      name: order.orderName ?? undefined,
      currencyCode: "EUR",
      lineItems: refund.lines,
    };

    const xml = buildCreditXml({
      order: orderLike,
      contactId: order.contactId,
      personalAccount: order.personalAccount ?? undefined,
      treatment: {
        // The credit must carry the same treatment as the invoice it corrects.
        taxCase: "domestic",
        vatScope: order.vatScopeUsed ?? null,
        country: order.countryUsed ?? settings.homeCountry,
      },
      documentDate: refund.createdAt ? new Date(refund.createdAt) : new Date(),
      externalReference: refund.refundGid,
      deriveFromProduct: settings.copyVatFromProduct,
      originalDocumentNumber: order.documentNumber,
    });

    // `POST /credits` is a SEARCH endpoint (its body is a filter), not an
    // import — posting a document there is silently treated as a query.
    // Billing documents of every type, credit notes included, go through the
    // one Abrechnungsbelege import.
    const result = await client.post<ImportResult>("/outgoinginvoices/import", {
      data: xml,
      generateDocumentNumbers: true,
      doPost: false,
      skipDuplicates: true,
    });

    const created = result?.invoices ?? [];
    const first = created[0];
    const creditNumber =
      typeof first === "string"
        ? first
        : (first?.documentNumber ?? first?.number ?? null);

    if (!creditNumber) {
      return {
        state: "held",
        reason: "credit_not_created",
        detail:
          "Scopevisio accepted the import request but created no credit note " +
          `(${result?.message ?? "no message"}). The import document was not recognised — ` +
          "this is the same blocked XML schema as invoice creation.",
      };
    }

    if (settings.autoPost) {
      await client.post(`/credit/${encodeURIComponent(String(creditNumber))}/post`);
    }

    await prisma.orderSync.update({
      where: { id: order.id },
      data: { creditNumber: String(creditNumber) },
    });

    await logEvent(shop, {
      event: "credit.created",
      orderGid: refund.orderGid,
      message: `Refund booked as credit note ${creditNumber} against invoice ${order.documentNumber}.`,
      data: { creditNumber, invoice: order.documentNumber, posted: settings.autoPost },
    });

    return { state: "credited", creditNumber: String(creditNumber) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unexpected error.";
    await logEvent(shop, {
      level: "error",
      event: "credit.failed",
      orderGid: refund.orderGid,
      message: detail,
    });
    return { state: "held", reason: "credit_failed", detail };
  }
}
