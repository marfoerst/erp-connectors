import prisma from "./db.js";
import { MagentoApiError, MagentoClient } from "./magento-api.js";
import { INVOICE_STATE_PAID, mapInvoice } from "./order-mapper.js";
import { syncCreditMemo } from "./refunds.js";
import { recordEvent } from "./store.js";
import {
  acceptInvoice,
  FINISHED_STATES,
  MAX_AUTOMATIC_ATTEMPTS,
  RETRYABLE_REASONS,
  syncInvoice,
  type SyncOutcome,
} from "./sync.js";

/**
 * Getting paid invoices from Magento — two paths, deliberately.
 *
 *   webhook  the module's outbox, delivered by Magento cron within a minute
 *   polling  this service asks Magento's REST API on an interval
 *
 * Polling needs nothing from the module and recovers anything the webhook
 * path lost, e.g. while this service was down past the outbox's retries. Both
 * are safe together: sync is idempotent per invoice.
 *
 * Either way the invoice and order are fetched fresh from Magento. A webhook
 * only says *which* invoice; it is never trusted for *what* to book.
 */

export async function processInvoice(storeId: string, invoiceId: number): Promise<SyncOutcome> {
  const store = await prisma.magentoStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error(`Unknown store ${storeId}.`);
  const externalId = `invoice:${invoiceId}`;

  try {
    const client = await MagentoClient.forStore(storeId);
    const invoice = await client.getInvoice(invoiceId);
    if (!invoice) {
      await recordEvent(storeId, {
        level: "warn",
        event: "intake.invoice_not_found",
        message: `Rechnung ${invoiceId} wurde gemeldet, existiert in Magento aber nicht.`,
        externalId,
      });
      return { state: "skipped", reason: "invoice_not_found" };
    }
    if (invoice.state !== INVOICE_STATE_PAID) {
      await recordEvent(storeId, {
        level: "warn",
        event: "intake.invoice_not_paid",
        message: `Rechnung ${invoice.increment_id ?? invoiceId} ist nicht bezahlt (Status ${invoice.state}) und wird nicht übergeben.`,
        externalId,
      });
      return { state: "skipped", reason: "invoice_not_paid" };
    }
    const order = await client.getOrder(invoice.order_id);
    if (!order) {
      await acceptInvoice(storeId, externalId, { orderId: invoice.order_id, orderRef: null });
      await prisma.syncRecord.update({
        where: { storeId_externalId: { storeId, externalId } },
        data: {
          state: "held",
          reason: "order_not_found",
          detail: `Die Bestellung ${invoice.order_id} zur Rechnung ist in Magento nicht lesbar.`,
        },
      });
      return { state: "held", reason: "order_not_found", detail: "Bestellung nicht gefunden." };
    }

    const mapped = mapInvoice({ invoice, order, storeBaseUrl: store.storeBaseUrl });
    return await syncInvoice(storeId, mapped, {
      orderId: order.entity_id,
      orderRef: order.increment_id ?? null,
    });
  } catch (err) {
    // Magento unreachable or the integration was deactivated. Keep a visible,
    // retryable record rather than losing the event.
    if (!(err instanceof MagentoApiError)) throw err;
    await acceptInvoice(storeId, externalId, { orderId: null, orderRef: null });
    await prisma.syncRecord.update({
      where: { storeId_externalId: { storeId, externalId } },
      data: {
        state: "declined",
        reason: "magento_unreachable",
        detail: err.message,
        attempts: { increment: 1 },
        lastTriedAt: new Date(),
      },
    });
    await recordEvent(storeId, {
      level: "error",
      event: "intake.magento_failed",
      message: err.message,
      externalId,
      data: { status: err.status, body: err.body },
    });
    return { state: "declined", reason: "magento_unreachable", detail: err.message };
  }
}

/** Overlap between polls, so an invoice written during a run is not skipped. */
const OVERLAP_MS = 5 * 60 * 1000;

export async function pollStore(storeId: string) {
  const store = await prisma.magentoStore.findUnique({ where: { id: storeId } });
  const summary = { invoices: 0, processed: 0, retried: 0, creditMemos: 0 };
  if (!store || store.status !== "active") return summary;

  // The cursor is the START of the run, so anything that lands mid-run is
  // inside the next window. The first poll starts at activation: invoices from
  // before the store was connected are not this connector's to book.
  const runStartedAt = new Date();
  const since = store.lastPolledAt
    ? new Date(store.lastPolledAt.getTime() - OVERLAP_MS)
    : store.createdAt;

  const client = await MagentoClient.forStore(storeId);

  for (let page = 1; ; page++) {
    const res = await client.paidInvoicesSince(since, page);
    for (const invoice of res.items) {
      summary.invoices++;
      const existing = await prisma.syncRecord.findUnique({
        where: { storeId_externalId: { storeId, externalId: `invoice:${invoice.entity_id}` } },
      });
      // Held and declined records wait for a human, or for the bounded retry
      // below. Re-running them every poll would flood the journal.
      if (existing && existing.state !== "pending") continue;
      if (existing && FINISHED_STATES.has(existing.state)) continue;
      await processInvoice(storeId, invoice.entity_id);
      summary.processed++;
    }
    if (res.items.length === 0 || page * 50 >= res.total_count) break;
  }

  const retryable = await prisma.syncRecord.findMany({
    where: {
      storeId,
      OR: [
        { state: "pending", updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
        { state: "declined", reason: { in: RETRYABLE_REASONS }, attempts: { lt: MAX_AUTOMATIC_ATTEMPTS } },
      ],
    },
    take: 50,
  });
  for (const record of retryable) {
    const id = Number(record.externalId.replace("invoice:", ""));
    if (!Number.isFinite(id)) continue;
    await processInvoice(storeId, id);
    summary.retried++;
  }

  for (let page = 1; ; page++) {
    const res = await client.creditMemosSince(since, page);
    for (const memo of res.items) {
      const outcome = await syncCreditMemo(storeId, memo.entity_id);
      if (outcome.outcome !== "duplicate") summary.creditMemos++;
    }
    if (res.items.length === 0 || page * 50 >= res.total_count) break;
  }

  await prisma.magentoStore.update({ where: { id: storeId }, data: { lastPolledAt: runStartedAt } });
  return summary;
}

export function startPolling(intervalMinutes: number) {
  if (!intervalMinutes || intervalMinutes <= 0) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stores = await prisma.magentoStore.findMany({ where: { status: "active" } });
      for (const store of stores) {
        try {
          await pollStore(store.id);
        } catch (err) {
          await recordEvent(store.id, {
            level: "error",
            event: "intake.poll_failed",
            message: (err as Error).message,
          });
        }
      }
    } finally {
      running = false;
    }
  };
  return setInterval(tick, intervalMinutes * 60 * 1000);
}
