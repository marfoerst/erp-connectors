import {
  buildInvoiceDraft,
  createInvoice,
  determineTaxTreatment,
  postInvoice,
  ScopevisioError,
  upsertCustomer,
  type OrderLike,
} from "@erp/scopevisio-core";

import prisma from "./db.js";
import { checksumByRate } from "./order-mapper.js";
import { recordEvent, scopevisioContext } from "./store.js";
import { vatIdValidator } from "./vat.js";

/**
 * Magento invoice → Scopevisio orchestration.
 *
 * The same rules as the other connectors, because they are the ERP's rules:
 * every paid invoice ends in exactly one visible state, and nothing is dropped
 * silently. `(storeId, externalId)` is unique, so a redelivered webhook or a
 * poll that overlaps it does nothing the second time.
 *
 *   pending          accepted, not finished (or interrupted mid-way)
 *   ready_to_export  a complete draft, waiting for the bookkeeper's CSV batch
 *   exported         in a downloaded batch, waiting for import confirmation
 *   booked           in Scopevisio, confirmed
 *   held             needs a human — the reason says what to do
 *   declined         failed unexpectedly or withdrawn by a refund
 *
 * Magento specifics are handled before this point (see order-mapper.ts): the
 * amounts are net, shipping is a position, and the document is the invoice.
 */

export type SyncOutcome =
  | { state: "booked"; documentNumber: string }
  | { state: "ready_to_export"; detail: string }
  | { state: "held"; reason: string; detail: string }
  | { state: "declined"; reason: string; detail: string }
  | { state: "skipped"; reason: string };

/** A record in one of these states has done its job; never process it again. */
export const FINISHED_STATES = new Set(["ready_to_export", "exported", "booked"]);

/** Also final: an invoice withdrawn by a refund must never be revived by a redelivery. */
export function isFinal(record: { state: string; reason: string | null }): boolean {
  return FINISHED_STATES.has(record.state) || record.reason === "refunded_before_export";
}

/** Declines that are worth retrying automatically, a bounded number of times. */
export const RETRYABLE_REASONS = ["unexpected_error", "magento_unreachable"];
export const MAX_AUTOMATIC_ATTEMPTS = 5;

export interface SourceRef {
  orderId: number | null;
  orderRef: string | null;
}

const key = (storeId: string, externalId: string) => ({
  storeId_externalId: { storeId, externalId },
});

/**
 * Write a final state — but only over `pending`.
 *
 * Magento's outbox delivers a credit memo right behind its invoice, so a refund
 * can land while the invoice is still being synced. Found live: the refund
 * withdrew the pending invoice, the sync then finished and wrote
 * `ready_to_export` over it, and a refunded invoice went out in the CSV. Every
 * final write is therefore conditional, which also holds across processes.
 */
async function settle(storeId: string, order: OrderLike, data: Record<string, unknown>): Promise<boolean> {
  const res = await prisma.syncRecord.updateMany({
    where: { storeId, externalId: order.id, state: "pending" },
    data,
  });
  if (res.count === 1) return true;
  const current = await prisma.syncRecord.findUnique({ where: key(storeId, order.id) });
  await recordEvent(storeId, {
    level: "warn",
    event: "invoice.superseded",
    message:
      `Rechnung ${order.name ?? order.id}: Ergebnis verworfen, weil sich der Datensatz währenddessen geändert hat ` +
      `(jetzt ${current?.state}${current?.reason ? `, ${current.reason}` : ""}).`,
    externalId: order.id,
  });
  return false;
}

async function hold(
  storeId: string,
  order: OrderLike,
  reason: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Promise<SyncOutcome> {
  if (!(await settle(storeId, order, { state: "held", reason, detail, ...extra }))) {
    return { state: "skipped", reason: "superseded" };
  }
  await recordEvent(storeId, {
    level: "warn",
    event: `invoice.held.${reason}`,
    message: `Rechnung ${order.name ?? order.id} zurückgehalten: ${detail}`,
    externalId: order.id,
  });
  return { state: "held", reason, detail };
}

/** Accept an event durably before doing any work, so a crash leaves a trace. */
export async function acceptInvoice(storeId: string, externalId: string, ref: SourceRef) {
  await prisma.syncRecord.upsert({
    where: key(storeId, externalId),
    create: { storeId, externalId, state: "pending", orderId: ref.orderId, orderRef: ref.orderRef },
    update: {},
  });
}

// One sync per invoice at a time: a webhook and a poll can arrive together, and
// two concurrent runs of a guest invoice would create two contacts.
const inFlight = new Map<string, Promise<SyncOutcome>>();

// And one sync per STORE at a time. Found live: the outbox delivers a batch of
// invoices within milliseconds, and concurrent /createdebitor calls against one
// Scopevisio tenant lost debitor accounts — one answered with a number that was
// never persisted. Throughput is not the constraint for a shop's invoices;
// a debitor that does not exist is.
const storeChains = new Map<string, Promise<unknown>>();

function serialised<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
  const previous = storeChains.get(storeId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  storeChains.set(storeId, next);
  next
    .catch(() => undefined)
    .finally(() => {
      if (storeChains.get(storeId) === next) storeChains.delete(storeId);
    });
  return next;
}

export function syncInvoice(storeId: string, order: OrderLike, ref: SourceRef): Promise<SyncOutcome> {
  const k = `${storeId}|${order.id}`;
  const running = inFlight.get(k);
  if (running) return running;
  const run = serialised(storeId, () => doSync(storeId, order, ref)).finally(() => inFlight.delete(k));
  inFlight.set(k, run);
  return run;
}

/** Resolves once no sync of this invoice is running in this process. */
export async function awaitInvoiceSync(storeId: string, externalId: string): Promise<void> {
  await inFlight.get(`${storeId}|${externalId}`)?.catch(() => undefined);
}

async function doSync(storeId: string, order: OrderLike, ref: SourceRef): Promise<SyncOutcome> {
  const existing = await prisma.syncRecord.findUnique({ where: key(storeId, order.id) });
  if (existing && isFinal(existing)) {
    await recordEvent(storeId, {
      event: "invoice.duplicate_ignored",
      message: `Rechnung ${order.name ?? order.id} ist bereits verarbeitet (${existing.state}); diese Zustellung wurde ignoriert.`,
      externalId: order.id,
    });
    return { state: "skipped", reason: `already_${existing.state}` };
  }

  await prisma.syncRecord.upsert({
    where: key(storeId, order.id),
    create: {
      storeId,
      externalId: order.id,
      externalRef: order.name ?? null,
      orderId: ref.orderId,
      orderRef: ref.orderRef,
      state: "pending",
      attempts: 1,
      lastTriedAt: new Date(),
    },
    update: {
      externalRef: order.name ?? null,
      orderId: ref.orderId,
      orderRef: ref.orderRef,
      state: "pending",
      attempts: { increment: 1 },
      lastTriedAt: new Date(),
    },
  });

  // Unconfigured or switched off is a hold, not a skip: the invoice was paid
  // and has to be booked eventually. "Reprocess held invoices" picks it up
  // once the merchant has finished the setup.
  const settings = await prisma.scopevisioSettings.findUnique({ where: { storeId } });
  if (!settings) {
    return hold(storeId, order, "not_configured",
      "Die Scopevisio-Anbindung ist für diesen Shop noch nicht eingerichtet.");
  }
  if (!settings.syncEnabled) {
    return hold(storeId, order, "sync_disabled",
      "Die Übergabe ist in den Einstellungen des Connectors ausgeschaltet.");
  }

  try {
    // 1. Checksum first. It needs no ERP, and a shop whose tax does not add up
    //    must not get as far as creating a contact.
    const check = checksumByRate(order, settings.taxToleranceCents);
    if (!check.ok) {
      return hold(storeId, order, "tax_mismatch", check.detail, {
        sourceTaxCents: order.totalTaxCents ?? null,
        erpTaxCents: check.erpTaxCents,
      });
    }

    const ctx = await scopevisioContext(storeId);
    const documentDate = order.processedAt ? new Date(order.processedAt) : new Date();

    // 2. The tax case, resolved against the tenant's Steuermatrix.
    const treatment = await determineTaxTreatment({
      client: ctx.client,
      order,
      settings,
      servicesRenderedDate: documentDate,
      vatIds: vatIdValidator(storeId),
    });
    if (treatment.hold) {
      return hold(storeId, order, treatment.hold.reason, treatment.hold.detail, {
        vatScopeUsed: treatment.vatScope ?? null,
        countryUsed: treatment.country ?? null,
      });
    }

    // 3. Contact and debitor. Recorded immediately: the contact exists in
    //    Scopevisio from this moment, and a retry must reuse it.
    const customer = await upsertCustomer(ctx, order, {
      source: "magento",
      customerGroup: settings.customerGroup,
      guestCustomerGroup: settings.guestCustomerGroup,
      numberRangeNumber: settings.numberRangeNumber,
      guestUseCpd: settings.guestUseCpd,
    });
    await prisma.syncRecord.update({
      where: key(storeId, order.id),
      data: {
        contactId: customer.contactId,
        personalAccount: customer.personalAccount ?? null,
        vatScopeUsed: treatment.vatScope ?? null,
        countryUsed: treatment.country ?? null,
      },
    });

    const draft = buildInvoiceDraft({
      order,
      treatment,
      documentDate,
      contactId: customer.contactId,
      personalAccount: customer.personalAccount ?? null,
    });

    // 4a. CSV delivery — the path that produces real documents today.
    if (settings.deliveryMode !== "api") {
      const detail = customer.reviewNote ?? null;
      const won = await settle(storeId, order, {
        state: "ready_to_export",
        reason: detail ? "possible_duplicate_contact" : null,
        detail,
        draftJson: JSON.stringify(draft),
        sourceTaxCents: order.totalTaxCents ?? null,
        erpTaxCents: check.erpTaxCents,
      });
      if (!won) return { state: "skipped", reason: "superseded" };
      await ctx.journal.event({
        event: "invoice.draft_ready",
        message: `Rechnung ${order.name ?? order.id}: Entwurf fertig (Kontakt ${customer.contactId}, Erlöskonto ${treatment.account}, ${treatment.vatKey}).`,
        externalId: order.id,
        data: { taxCase: treatment.taxCase, country: treatment.country },
      });
      return { state: "ready_to_export", detail: "Bereit für den CSV-Export." };
    }

    // 4b. API delivery. ⚠️ The OpenScope import schema is unverified
    //     (docs/API-FINDINGS.md §7) and answers HTTP 200 with an empty array
    //     for a document it did not understand, so this holds rather than
    //     report a success it cannot confirm.
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
      return hold(storeId, order, "invoice_create_failed",
        `Scopevisio hat den Beleg nicht angenommen: ${(err as Error).message}`,
        { draftJson: JSON.stringify(draft) });
    }
    if (!documentNumber) {
      return hold(storeId, order, "invoice_not_created",
        "Scopevisio hat die Anfrage angenommen, aber keinen Beleg erzeugt. Nutzen Sie die CSV-Übergabe.",
        { draftJson: JSON.stringify(draft) });
    }

    await prisma.syncRecord.update({
      where: key(storeId, order.id),
      data: { documentNumber, draftJson: JSON.stringify(draft) },
    });
    if (settings.autoPost) await postInvoice(ctx, documentNumber);
    if (!(await settle(storeId, order, { state: "booked", reason: null, detail: null }))) {
      return { state: "skipped", reason: "superseded" };
    }
    return { state: "booked", documentNumber };
  } catch (err) {
    const detail = (err as Error).message;
    if (err instanceof ScopevisioError && err.merchantActionable) {
      return hold(storeId, order, "scopevisio_rejected", detail);
    }
    if (!(await settle(storeId, order, { state: "declined", reason: "unexpected_error", detail }))) {
      return { state: "skipped", reason: "superseded" };
    }
    await recordEvent(storeId, {
      level: "error",
      event: "invoice.failed",
      message: `Rechnung ${order.name ?? order.id}: ${detail}`,
      externalId: order.id,
    });
    return { state: "declined", reason: "unexpected_error", detail };
  }
}
