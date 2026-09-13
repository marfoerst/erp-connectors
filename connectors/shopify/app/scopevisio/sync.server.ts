import prisma from "../db.server";
import { scopevisioContext } from "./core.server";
import {
  ScopevisioError,
  upsertCustomer,
  createInvoice,
  getInvoiceTaxCents,
  postInvoice,
  TAX_CASE_LABEL,
  type OrderLike,
} from "@erp/scopevisio-core";
import { logEvent } from "./log.server";
import { buildDraft } from "./csv-export.server";
import { determineTaxTreatment } from "./vat.server";

/**
 * Order → Faktura orchestration.
 *
 * Every paid order ends in exactly one of three visible states — booked, held,
 * or declined. There is deliberately no fourth state and no silent drop
 * (PRD C-009, and the GoBD completeness guardrail).
 *
 * Idempotency (PRD C-007) is enforced twice: the unique key on
 * OrderSync(shop, orderGid) here, and `skipDuplicates` on the ERP import.
 */

export type SyncOutcome =
  | { state: "booked"; documentNumber: string }
  /** The draft is complete and queued for CSV delivery. A success, not an error. */
  | { state: "ready_to_export"; documentNumber: null }
  | { state: "held"; reason: string; detail: string }
  | { state: "skipped"; reason: string };

export async function syncOrder(
  shop: string,
  order: OrderLike,
): Promise<SyncOutcome> {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });

  if (!settings) {
    return { state: "skipped", reason: "not_configured" };
  }
  if (!settings.syncEnabled) {
    await recordSkip(shop, order, "sync_disabled");
    return { state: "skipped", reason: "sync_disabled" };
  }

  // Claim the order. A unique-constraint violation means another delivery of
  // the same webhook already has it, so we do nothing at all.
  const existing = await prisma.orderSync.findUnique({
    where: { shop_orderGid: { shop, orderGid: order.id } },
  });

  if (existing?.state === "booked") {
    await logEvent(shop, {
      event: "order.duplicate_ignored",
      orderGid: order.id,
      message: `Order ${order.name ?? order.id} is already booked as ${existing.documentNumber}; nothing to do.`,
    });
    return { state: "booked", documentNumber: existing.documentNumber! };
  }
  if (existing?.state === "declined") {
    return { state: "skipped", reason: "declined_by_user" };
  }
  if (existing?.state === "exported") {
    // Already in a downloaded batch — re-preparing it risks a double import.
    return { state: "skipped", reason: "already_exported" };
  }
  if (existing?.state === "ready_to_export") {
    return { state: "skipped", reason: "already_queued" };
  }
  if (existing?.state === "processing") {
    return { state: "skipped", reason: "already_processing" };
  }

  const row = await prisma.orderSync.upsert({
    where: { shop_orderGid: { shop, orderGid: order.id } },
    create: {
      shop,
      orderGid: order.id,
      orderName: order.name ?? null,
      orderNumber: order.orderNumber ? String(order.orderNumber) : null,
      state: "processing",
      attempts: 1,
      lastTriedAt: new Date(),
    },
    update: {
      state: "processing",
      attempts: { increment: 1 },
      lastTriedAt: new Date(),
      reason: null,
      detail: null,
    },
  });

  try {
    // One context for the whole sync: a client bound to this shop's stored
    // connection, and the journal that records what we did to it. Built inside
    // the try on purpose — a shop with settings but no connection must be held
    // with an explanation, not throw out of the webhook.
    const ctx = await scopevisioContext(shop);

    const documentDate = order.processedAt
      ? new Date(order.processedAt)
      : order.createdAt
        ? new Date(order.createdAt)
        : new Date();

    // 1. Tax case first — if we cannot classify it, nothing else should happen.
    const treatment = await determineTaxTreatment(
      shop,
      order,
      settings,
      documentDate,
    );

    if (treatment.hold) {
      return hold(shop, order.id, treatment.hold.reason, treatment.hold.detail, {
        vatScopeUsed: treatment.vatScope,
        countryUsed: treatment.country,
      });
    }

    // 2. Customer.
    const customer = await upsertCustomer(ctx, order, {
      ...settings,
      source: "shopify",
    });

    // Record the contact IMMEDIATELY. The contact now exists in Scopevisio, so
    // if anything downstream fails we must still know about it — otherwise a
    // retry of a guest order (which has no Shopify customer id to look up by)
    // creates a second contact every time.
    const draft = buildDraft(
      order,
      treatment,
      documentDate,
      customer.contactId,
      customer.personalAccount ?? null,
    );

    await prisma.orderSync.update({
      where: { id: row.id },
      data: {
        contactId: customer.contactId,
        personalAccount: customer.personalAccount ?? null,
        vatScopeUsed: treatment.vatScope,
        countryUsed: treatment.country,
        resolvedAccount: treatment.account ?? null,
        resolvedVatKey: treatment.vatKey ?? null,
        // Keep the finished draft: if the document import fails, the order can
        // still be delivered through the CSV export rather than being lost.
        draftJson: JSON.stringify(draft),
      },
    });

    if (customer.reviewNote) {
      await logEvent(shop, {
        level: "warn",
        event: "contact.possible_duplicate",
        orderGid: order.id,
        message: customer.reviewNote,
      });
    }

    // 3. Deliver the document.
    //
    // In CSV mode the draft IS the deliverable: it goes to the export queue and
    // the bookkeeper imports the batch in Scopevisio. We deliberately do not
    // call the API import here — its schema is unknown (OQ-10) and it fails
    // silently, so attempting it would turn every order into a false error.
    if (settings.deliveryMode === "csv") {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: {
          state: "ready_to_export",
          reason: "ready_to_export",
          detail:
            "Ready to import. Download the CSV on the Export page and import it " +
            "in Scopevisio under Abrechnung → Abrechnungsbelege.",
          shopifyTaxCents: order.totalTaxCents ?? null,
        },
      });
      await logEvent(shop, {
        event: "invoice.ready_to_export",
        orderGid: order.id,
        message: `Order ${order.name ?? order.id} prepared for export (${treatment.taxCase}, ${treatment.country}, account ${treatment.account ?? "-"}).`,
        data: {
          taxCase: treatment.taxCase,
          country: treatment.country,
          account: treatment.account,
          vatKey: treatment.vatKey,
          contactId: customer.contactId,
        },
      });
      return {
        state: "ready_to_export",
        documentNumber: null,
      };
    }

    // 4. API mode: create the document, unposted.
    const { documentNumber } = await createInvoice(
      ctx,
      {
        order,
        contactId: customer.contactId,
        personalAccount: customer.personalAccount,
        treatment,
        documentDate,
        externalReference: order.id,
        deriveFromProduct: settings.copyVatFromProduct,
      },
      {
        template: settings.documentTemplate,
        copyProductFields: settings.copyAccountsFromProduct,
      },
    );

    if (!documentNumber) {
      return hold(
        shop,
        order.id,
        "no_document_number",
        "Scopevisio accepted the import but returned no document number, so the invoice could not be posted. Check the Faktura list in Scopevisio before reprocessing.",
        { vatScopeUsed: treatment.vatScope, countryUsed: treatment.country },
      );
    }

    await prisma.orderSync.update({
      where: { id: row.id },
      data: { documentNumber },
    });

    // 5. Checksum before posting. Shopify's tax is the cross-check, never the
    //    input — a disagreement means one side is misconfigured.
    const shopifyTaxCents = order.totalTaxCents ?? null;
    const erpTaxCents = await getInvoiceTaxCents(ctx, documentNumber);

    if (
      shopifyTaxCents !== null &&
      erpTaxCents !== null &&
      Math.abs(shopifyTaxCents - erpTaxCents) > settings.taxToleranceCents
    ) {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: { shopifyTaxCents, erpTaxCents },
      });
      return hold(
        shop,
        order.id,
        "tax_mismatch",
        `Shopify calculated ${fmt(shopifyTaxCents)} VAT, Scopevisio calculated ${fmt(erpTaxCents)} ` +
          `for the "${TAX_CASE_LABEL[treatment.taxCase]}" case in ${treatment.country}. ` +
          `Document ${documentNumber} was created but NOT posted. Resolve the difference, ` +
          `then either post it in Scopevisio or accept it here.`,
        { vatScopeUsed: treatment.vatScope, countryUsed: treatment.country },
      );
    }

    // 6. Post — or leave it for review if the merchant has not enabled autoPost.
    if (!settings.autoPost) {
      await prisma.orderSync.update({
        where: { id: row.id },
        data: {
          state: "held",
          reason: "awaiting_manual_post",
          detail:
            `Invoice ${documentNumber} was created and checked but not posted, because ` +
            `automatic posting is switched off. Review it and post it when you are ready.`,
          shopifyTaxCents,
          erpTaxCents,
        },
      });
      await logEvent(shop, {
        event: "invoice.created_unposted",
        orderGid: order.id,
        message: `Created invoice ${documentNumber} (automatic posting is off).`,
      });
      return {
        state: "held",
        reason: "awaiting_manual_post",
        detail: `Invoice ${documentNumber} created, not posted.`,
      };
    }

    await postInvoice(ctx, documentNumber);

    await prisma.orderSync.update({
      where: { id: row.id },
      data: {
        state: "booked",
        reason: null,
        detail: null,
        shopifyTaxCents,
        erpTaxCents,
      },
    });

    await logEvent(shop, {
      event: "invoice.posted",
      orderGid: order.id,
      message: `Order ${order.name ?? order.id} booked as invoice ${documentNumber}.`,
      data: {
        documentNumber,
        taxCase: treatment.taxCase,
        country: treatment.country,
        contactId: customer.contactId,
      },
    });

    return { state: "booked", documentNumber };
  } catch (err) {
    const actionable = err instanceof ScopevisioError && err.merchantActionable;
    const message =
      err instanceof Error ? err.message : "Unexpected error during sync.";

    return hold(
      shop,
      order.id,
      actionable ? "scopevisio_rejected" : "sync_error",
      message,
      {},
      actionable ? "warn" : "error",
    );
  }
}

async function hold(
  shop: string,
  orderGid: string,
  reason: string,
  detail: string,
  extra: { vatScopeUsed?: number | null; countryUsed?: string | null } = {},
  level: "warn" | "error" = "warn",
): Promise<SyncOutcome> {
  await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: { state: "held", reason, detail, ...extra },
  });
  await logEvent(shop, {
    level,
    event: `order.held.${reason}`,
    orderGid,
    message: detail,
  });
  return { state: "held", reason, detail };
}

async function recordSkip(shop: string, order: OrderLike, reason: string) {
  await prisma.orderSync.upsert({
    where: { shop_orderGid: { shop, orderGid: order.id } },
    create: {
      shop,
      orderGid: order.id,
      orderName: order.name ?? null,
      state: "pending",
      reason,
      detail:
        "Sync is switched off, so this order was recorded but not sent to Scopevisio. Enable sync and reprocess to book it.",
    },
    update: {},
  });
}

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}

// --- Queue operations used by the UI ---------------------------------------

export async function heldOrders(shop: string, limit = 100) {
  return prisma.orderSync.findMany({
    where: { shop, state: { in: ["held", "pending"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function orderCounts(shop: string) {
  const rows = await prisma.orderSync.groupBy({
    by: ["state"],
    where: { shop },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {
    booked: 0,
    held: 0,
    declined: 0,
    pending: 0,
    processing: 0,
    ready_to_export: 0,
    exported: 0,
  };
  for (const row of rows) counts[row.state] = row._count._all;
  return counts;
}

/** Mark a held order as deliberately not to be booked, with a reason. */
export async function declineOrder(
  shop: string,
  orderGid: string,
  by: string,
  note: string,
) {
  const row = await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: {
      state: "declined",
      resolvedBy: by,
      resolvedAt: new Date(),
      resolveNote: note,
    },
  });
  await logEvent(shop, {
    level: "warn",
    event: "order.declined",
    orderGid,
    message: `Declined by ${by}: ${note}`,
  });
  return row;
}

/** Put a held order back in line so the next reprocess picks it up. */
export async function requeueOrder(shop: string, orderGid: string) {
  const row = await prisma.orderSync.update({
    where: { shop_orderGid: { shop, orderGid } },
    data: { state: "pending", reason: null, detail: null },
  });
  await logEvent(shop, {
    event: "order.requeued",
    orderGid,
    message: "Queued for reprocessing.",
  });
  return row;
}
