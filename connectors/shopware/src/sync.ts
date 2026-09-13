import {
  createInvoice,
  determineTaxTreatment,
  formatGermanDate,
  postInvoice,
  ScopevisioError,
  taxChecksum,
  upsertCustomer,
  type InvoiceDraft,
  type OrderLike,
  type ResolvedTaxTreatment,
} from "@erp/scopevisio-core";

import prisma from "./db.js";
import { scopevisioContext } from "./store.js";
import { vatIdValidator } from "./vat.js";

/**
 * Order → Faktura orchestration for Shopware.
 *
 * Deliberately the same shape as the Shopify connector's, because the rules are
 * the ERP's rules, not the shop's: every paid order ends in exactly one of
 * three visible states — booked, held or declined. There is no fourth state and
 * no silent drop.
 *
 * Idempotency is enforced by the unique key on (shopId, externalId). A webhook
 * delivered twice does nothing the second time, which matters because under
 * GoBD a duplicate posting cannot be withdrawn, only corrected.
 */

export type SyncOutcome =
  | { state: "booked"; documentNumber: string }
  | { state: "ready_to_export"; detail: string }
  | { state: "held"; reason: string; detail: string }
  | { state: "declined"; reason: string; detail: string }
  | { state: "skipped"; reason: string };

export interface ShopwareSettings {
  syncEnabled: boolean;
  autoPost: boolean;
  homeCountry: string;
  ossRegistered: boolean;
  customerGroup: string;
  guestCustomerGroup: string;
  guestUseCpd: boolean;
  numberRangeNumber: number | null;
  taxToleranceCents: number;
  vatScopeDomestic: number | null;
  vatScopeEuB2c: number | null;
  vatScopeEuB2cOss: number | null;
  vatScopeEuB2bReverse: number | null;
  vatScopeThirdCountry: number | null;
}

/** Build the delivery-agnostic draft. Same shape both connectors produce. */
export function buildDraft(args: {
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

async function recordSkip(
  shopId: string,
  order: OrderLike,
  reason: string,
  detail: string,
): Promise<SyncOutcome> {
  await prisma.syncEvent.create({
    data: {
      shopId,
      level: "warn",
      event: `order.skipped.${reason}`,
      message: `Order ${order.name ?? order.id} was not processed: ${detail}`,
      externalId: order.id,
    },
  });
  return { state: "skipped", reason };
}

async function hold(
  shopId: string,
  order: OrderLike,
  reason: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Promise<SyncOutcome> {
  await prisma.syncRecord.upsert({
    where: { shopId_externalId: { shopId, externalId: order.id } },
    create: {
      shopId,
      externalId: order.id,
      externalRef: order.name ?? null,
      state: "held",
      reason,
      detail,
      ...extra,
    },
    update: { state: "held", reason, detail, ...extra },
  });
  return { state: "held", reason, detail };
}

export async function syncOrder(shopId: string, order: OrderLike): Promise<SyncOutcome> {
  const settings = (await prisma.scopevisioSettings.findUnique({
    where: { shopId },
  })) as ShopwareSettings | null;

  // A skip must leave a trace. An order that silently disappears is the one
  // thing a bookkeeper cannot reconcile, and "nothing happened" is indis-
  // tinguishable from "the connector is broken".
  if (!settings) return recordSkip(shopId, order, "not_configured",
    "The Scopevisio connection is not configured for this shop yet.");
  if (!settings.syncEnabled) return recordSkip(shopId, order, "sync_disabled",
    "Syncing is switched off for this shop.");

  // Claim the order. Already booked means another delivery of the same webhook
  // got there first, and we must do nothing at all.
  const existing = await prisma.syncRecord.findUnique({
    where: { shopId_externalId: { shopId, externalId: order.id } },
  });
  if (existing?.state === "booked") {
    // Not an error: a redelivered webhook. Recorded so the trail is complete.
    await prisma.syncEvent.create({
      data: {
        shopId,
        level: "info",
        event: "order.duplicate_ignored",
        message: `Order ${order.name ?? order.id} is already booked; this delivery was ignored.`,
        externalId: order.id,
      },
    });
    return { state: "skipped", reason: "already_booked" };
  }

  try {
    // Built inside the try on purpose: a shop with settings but no Scopevisio
    // connection must be held with an explanation, not throw out of a webhook.
    const ctx = await scopevisioContext(shopId);

    const documentDate = order.processedAt ? new Date(order.processedAt) : new Date();

    // 1. Tax case first. If it cannot be classified, nothing else should happen.
    const treatment = await determineTaxTreatment({
      client: ctx.client,
      order,
      settings,
      servicesRenderedDate: documentDate,
      vatIds: vatIdValidator(shopId),
    });

    if (treatment.hold) {
      return hold(shopId, order, treatment.hold.reason, treatment.hold.detail, {
        vatScopeUsed: treatment.vatScope ?? null,
        countryUsed: treatment.country ?? null,
      });
    }

    // 2. Customer becomes a contact with a debitor account. Core decides guest
    //    handling from the absence of a customer id, keyed on the order instead
    //    so a retry never creates a second contact.
    const customer = await upsertCustomer(ctx, order, {
      source: "shopware",
      customerGroup: settings.customerGroup,
      guestCustomerGroup: settings.guestCustomerGroup,
      numberRangeNumber: settings.numberRangeNumber,
      guestUseCpd: settings.guestUseCpd,
    });

    // Record the contact IMMEDIATELY. It exists in Scopevisio now, so if
    // anything downstream fails we must still know — otherwise a retry of a
    // guest order creates a second contact and the debitor master drifts.
    await prisma.syncRecord.upsert({
      where: { shopId_externalId: { shopId, externalId: order.id } },
      create: {
        shopId,
        externalId: order.id,
        externalRef: order.name ?? null,
        state: "pending",
        contactId: customer.contactId,
        personalAccount: customer.personalAccount,
        vatScopeUsed: treatment.vatScope ?? null,
        countryUsed: treatment.country ?? null,
      },
      update: {
        contactId: customer.contactId,
        personalAccount: customer.personalAccount,
        vatScopeUsed: treatment.vatScope ?? null,
        countryUsed: treatment.country ?? null,
      },
    });

    const draft = buildDraft({
      order,
      treatment,
      documentDate,
      contactId: customer.contactId,
      personalAccount: customer.personalAccount ?? null,
    });

    // 3. Checksum before anything is created. The shop's tax is the
    //    cross-check, never the input — a disagreement means one side is
    //    misconfigured, and posting either number would be a guess.
    const netCents = Math.round(
      order.lineItems.reduce((sum, li) => sum + li.unitAmount * li.quantity, 0) * 100,
    );
    const check = taxChecksum({
      sourceTaxCents: order.totalTaxCents ?? 0,
      netCents,
      expectedRate: order.lineItems[0]?.taxRate ?? undefined,
      toleranceCents: settings.taxToleranceCents,
    });
    if (!check.ok) {
      return hold(shopId, order, "tax_mismatch", check.detail ?? "Tax checksum failed.", {
        draftJson: JSON.stringify(draft),
        sourceTaxCents: order.totalTaxCents ?? null,
        erpTaxCents: check.erpTaxCents,
      });
    }

    // 4. Create the document, unposted.
    //
    // ⚠️ The OpenScope import schema is still unverified (docs/API-FINDINGS.md
    // §7): the endpoint answers HTTP 200 with an empty `invoices` array for a
    // document it did not understand, so success and total failure look
    // identical. `createInvoice` treats an empty array as failure, which is why
    // this path holds rather than silently reporting success.
    let documentNumber: string | null;
    try {
      const created = await createInvoice(
        ctx,
        {
          order,
          contactId: customer.contactId,
          personalAccount: customer.personalAccount ?? undefined,
          treatment,
          documentDate,
          externalReference: order.name ?? order.id,
          deriveFromProduct: false,
        },
        { copyProductFields: false },
      );
      documentNumber = created.documentNumber;
    } catch (err) {
      return hold(
        shopId,
        order,
        "invoice_create_failed",
        `Scopevisio did not accept the invoice document: ${(err as Error).message}`,
        { draftJson: JSON.stringify(draft) },
      );
    }

    // The import endpoint answers HTTP 200 with an empty `invoices` array for a
    // document it did not understand, so a missing number is a silent failure,
    // not a success with no number. Treating it as success would lose invoices.
    if (!documentNumber) {
      return hold(
        shopId,
        order,
        "invoice_not_created",
        "Scopevisio accepted the request but created no document. The import " +
          "format was not understood — see docs/API-FINDINGS.md §7.",
        { draftJson: JSON.stringify(draft) },
      );
    }

    await prisma.syncRecord.update({
      where: { shopId_externalId: { shopId, externalId: order.id } },
      data: { documentNumber, draftJson: JSON.stringify(draft) },
    });

    // 5. Post only when the merchant has explicitly asked for it. A posted
    //    document cannot be withdrawn.
    if (!settings.autoPost) {
      await ctx.journal.event({
        event: "invoice.created",
        message: `Invoice ${documentNumber} created and left unposted.`,
        externalId: order.id,
      });
      await prisma.syncRecord.update({
        where: { shopId_externalId: { shopId, externalId: order.id } },
        data: { state: "ready_to_export", reason: null, detail: null },
      });
      return {
        state: "ready_to_export",
        detail: `Invoice ${documentNumber} created, not posted.`,
      };
    }

    await postInvoice(ctx, documentNumber);
    await prisma.syncRecord.update({
      where: { shopId_externalId: { shopId, externalId: order.id } },
      data: { state: "booked", reason: null, detail: null },
    });
    return { state: "booked", documentNumber };
  } catch (err) {
    const merchantActionable =
      err instanceof ScopevisioError ? err.merchantActionable : false;
    const detail = (err as Error).message;

    if (merchantActionable) {
      return hold(shopId, order, "scopevisio_rejected", detail);
    }

    await prisma.syncRecord.upsert({
      where: { shopId_externalId: { shopId, externalId: order.id } },
      create: {
        shopId,
        externalId: order.id,
        externalRef: order.name ?? null,
        state: "declined",
        reason: "unexpected_error",
        detail,
        attempts: 1,
        lastTriedAt: new Date(),
      },
      update: {
        state: "declined",
        reason: "unexpected_error",
        detail,
        attempts: { increment: 1 },
        lastTriedAt: new Date(),
      },
    });
    return { state: "declined", reason: "unexpected_error", detail };
  }
}
