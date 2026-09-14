import prisma from "./db.js";
import { MagentoClient } from "./magento-api.js";
import { recordEvent } from "./store.js";
import { awaitInvoiceSync } from "./sync.js";

/**
 * Magento credit memo → what it means for the invoice it refunds.
 *
 * A booked Faktura is immutable under GoBD; the only correction is a
 * Gutschrift. The connector cannot create one — every billing document goes
 * through the same blocked XML import (docs/API-FINDINGS.md §7), and a CSV
 * credit note import has not been verified — so it makes sure a human sees it.
 *
 *   invoice not delivered yet, fully refunded  → withdrawn (declined), nothing to correct
 *   invoice not delivered yet, partly refunded → held: the draft no longer matches
 *   invoice exported or booked                 → flagged: a Gutschrift is required
 *
 * A partial refund never withdraws. Withdrawing a whole invoice because one
 * line was returned would lose the revenue that was kept.
 */

export type RefundOutcome =
  | "withdrawn"
  | "held"
  | "credit_note_required"
  | "unknown_invoice"
  | "not_found"
  | "duplicate";

const NOT_DELIVERED = new Set(["pending", "held", "declined", "ready_to_export"]);

export async function syncCreditMemo(
  storeId: string,
  creditMemoId: number,
): Promise<{ outcome: RefundOutcome; detail: string }> {
  const externalId = `creditmemo:${creditMemoId}`;
  const seen = await prisma.refundRecord.findUnique({
    where: { storeId_externalId: { storeId, externalId } },
  });
  if (seen) return { outcome: "duplicate", detail: seen.detail };

  const client = await MagentoClient.forStore(storeId);
  const memo = await client.getCreditMemo(creditMemoId);

  const finish = async (
    outcome: RefundOutcome,
    detail: string,
    extra: { invoiceExternalId?: string | null; orderId?: number | null; ref?: string | null } = {},
  ) => {
    await prisma.refundRecord.create({
      data: {
        storeId,
        externalId,
        externalRef: extra.ref ?? null,
        invoiceExternalId: extra.invoiceExternalId ?? null,
        orderId: extra.orderId ?? null,
        outcome,
        detail,
      },
    });
    await recordEvent(storeId, {
      level: outcome === "withdrawn" ? "info" : "warn",
      event: `refund.${outcome}`,
      message: detail,
      externalId: extra.invoiceExternalId ?? externalId,
    });
    return { outcome, detail };
  };

  if (!memo) {
    return finish("not_found", `Gutschrift ${creditMemoId} existiert in Magento nicht (mehr).`);
  }
  const ref = memo.increment_id ?? String(memo.entity_id);

  // The credit memo names its invoice when it was created from one. An offline
  // refund created from the order does not; then the order decides, but only
  // when it has exactly one invoice — otherwise guessing is exactly the wrong
  // thing to do.
  let record = memo.invoice_id
    ? await prisma.syncRecord.findUnique({
        where: { storeId_externalId: { storeId, externalId: `invoice:${memo.invoice_id}` } },
      })
    : null;
  if (!record) {
    const byOrder = await prisma.syncRecord.findMany({ where: { storeId, orderId: memo.order_id } });
    if (byOrder.length === 1) record = byOrder[0];
  }

  if (!record) {
    return finish(
      "unknown_invoice",
      `Gutschrift ${ref} gehört zu keiner Rechnung, die der Connector verarbeitet hat. In Scopevisio wurde nichts geändert.`,
      { orderId: memo.order_id, ref },
    );
  }

  // The credit memo is delivered right behind its invoice. Let a sync of that
  // invoice finish and read the record again, or the refund decides on a
  // `pending` that is about to change (see settle() in sync.ts).
  await awaitInvoiceSync(storeId, record.externalId);
  record = (await prisma.syncRecord.findUnique({ where: { id: record.id } })) ?? record;

  const invoiceId = Number(record.externalId.replace("invoice:", ""));
  const invoice = Number.isFinite(invoiceId) ? await client.getInvoice(invoiceId) : null;
  const refunded = memo.grand_total ?? 0;
  const invoiced = invoice?.grand_total ?? null;
  const full = invoiced !== null && refunded >= invoiced - 0.005;
  const amounts = `${refunded.toFixed(2)} von ${invoiced !== null ? invoiced.toFixed(2) : "?"}`;
  const link = { invoiceExternalId: record.externalId, orderId: record.orderId, ref };

  if (NOT_DELIVERED.has(record.state)) {
    if (full) {
      await prisma.syncRecord.update({
        where: { id: record.id },
        data: {
          state: "declined",
          reason: "refunded_before_export",
          detail: `Vollständig erstattet (Gutschrift ${ref}), bevor die Rechnung übergeben wurde. Es wird kein Beleg erzeugt.`,
        },
      });
      return finish("withdrawn",
        `Rechnung ${record.externalRef}: vollständig erstattet vor der Übergabe (${amounts}) – zurückgezogen.`, link);
    }
    await prisma.syncRecord.update({
      where: { id: record.id },
      data: {
        state: "held",
        reason: "partial_refund_before_export",
        detail: `Teilweise erstattet (Gutschrift ${ref}, ${amounts}), bevor die Rechnung übergeben wurde. Rechnung und Gutschrift bitte gemeinsam in Scopevisio erfassen.`,
      },
    });
    return finish("held",
      `Rechnung ${record.externalRef}: Teilerstattung vor der Übergabe (${amounts}) – zurückgehalten.`, link);
  }

  // Exported or booked: the invoice stands; only a credit note can correct it.
  await prisma.syncRecord.update({
    where: { id: record.id },
    data: {
      reason: "credit_note_required",
      detail:
        record.state === "exported"
          ? `Erstattet (Gutschrift ${ref}, ${amounts}), nachdem die Rechnung exportiert wurde. Falls der Import noch nicht erfolgt ist: Batch zurückgeben. Sonst Gutschrift in Scopevisio erstellen.`
          : `Erstattet (Gutschrift ${ref}, ${amounts}) nach der Buchung. Bitte Gutschrift in Scopevisio erstellen.`,
    },
  });
  return finish("credit_note_required",
    `Rechnung ${record.externalRef}: erstattet nach der Übergabe (${amounts}) – Gutschrift in Scopevisio erforderlich.`, link);
}
