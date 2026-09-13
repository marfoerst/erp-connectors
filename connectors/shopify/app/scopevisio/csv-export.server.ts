import crypto from "node:crypto";

import type { InvoiceDraft , OrderLike, ResolvedTaxTreatment } from "@erp/scopevisio-core";

import prisma from "../db.server";
import { formatGermanDate } from "./masterdata.server";
import { logEvent } from "./log.server";

export type { InvoiceDraft };

/**
 * CSV delivery — the shipping path for getting invoices into Scopevisio.
 *
 * The connector does everything that requires judgement: creates the contact
 * and debitor, classifies the Steuersachverhalt, resolves the Erlöskonto and
 * Steuerschlüssel from the tenant's own Steuermatrix, and cross-checks the VAT.
 * It then produces a CSV that the bookkeeper imports in the Scopevisio client
 * under Abrechnung → Abrechnungsbelege. That import creates real
 * Abrechnungsbelege, so the Faktura module can render and send them exactly as
 * for a manually entered invoice.
 *
 * Why not the API: `POST /outgoinginvoices/import` is the only document-create
 * endpoint and its XML schema is undocumented (OQ-10). Journal postings would
 * book the revenue but produce no sendable document, so they are not a
 * substitute.
 *
 * The honest boundary: the connector cannot observe whether an import
 * succeeded. So an exported order stays `exported` until a human confirms it —
 * it is never silently promoted to `booked`.
 */

/** Build the draft that either delivery path consumes. */
export function buildDraft(
  order: OrderLike,
  treatment: ResolvedTaxTreatment,
  documentDate: Date,
  contactId: number | null,
  personalAccount: string | null,
): InvoiceDraft {
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
    positions: order.lineItems.map((l) => ({
      name: l.title,
      number: l.sku ?? null,
      quantity: l.quantity,
      singleAmount: l.unitAmount,
    })),
    sourceTaxCents: order.totalTaxCents ?? null,
  };
}

/**
 * Column headers use the Scopevisio field names so the mapping step in the
 * client importer is one-to-one wherever possible. The importer lets the
 * bookkeeper remap columns, which is what makes this robust to any naming
 * difference.
 */
const COLUMNS = [
  "customerContactId",
  "customerPersonalAccountNumber",
  "documentDate",
  "reference",
  "text",
  "currency",
  "taxCountryCodeIso2",
  "number",
  "name",
  "quantity",
  "singleAmount",
  "account",
  "vatKey",
] as const;

function escapeCsv(s: string): string {
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain text or an id — never reformatted as a decimal. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return escapeCsv(String(value));
}

/** A money amount: always two decimals, German comma separator. */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return escapeCsv(value.toFixed(2).replace(".", ","));
}

/** A quantity: integers stay integral, fractions use a comma. */
function qty(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return escapeCsv(
    Number.isInteger(value) ? String(value) : String(value).replace(".", ","),
  );
}

export function draftsToCsv(drafts: InvoiceDraft[]): string {
  const lines: string[] = [COLUMNS.join(";")];

  for (const d of drafts) {
    // One row per position; document fields repeat, which is how flat
    // billing-document imports are shaped.
    for (const p of d.positions) {
      lines.push(
        [
          cell(d.contactId),
          cell(d.personalAccount),
          cell(d.documentDate),
          cell(d.externalId),
          cell(d.externalRef ? `Shopify ${d.externalRef}` : ""),
          cell(d.currency),
          cell(d.country),
          cell(p.number),
          cell(p.name),
          qty(p.quantity),
          money(p.singleAmount),
          cell(d.account),
          cell(d.vatKey),
        ].join(";"),
      );
    }
  }

  // A BOM so Excel on Windows reads it as UTF-8 rather than mangling umlauts.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Orders whose draft is complete and which are waiting to be delivered. */
export async function pendingExport(shop: string) {
  return prisma.orderSync.findMany({
    where: { shop, state: "ready_to_export", draftJson: { not: null } },
    orderBy: { createdAt: "asc" },
  });
}

/** Orders already in a downloaded batch, awaiting confirmation. */
export async function awaitingConfirmation(shop: string) {
  return prisma.orderSync.findMany({
    where: { shop, state: "exported" },
    orderBy: { exportedAt: "desc" },
  });
}

function parseDrafts(
  rows: Array<{ draftJson: string | null }>,
): InvoiceDraft[] {
  const drafts: InvoiceDraft[] = [];
  for (const row of rows) {
    if (!row.draftJson) continue;
    try {
      drafts.push(JSON.parse(row.draftJson) as InvoiceDraft);
    } catch {
      // A single corrupt draft must not take the whole batch down.
    }
  }
  return drafts;
}

export interface ExportBatch {
  csv: string;
  batchId: string;
  count: number;
  orderNames: string[];
}

/**
 * Produce a batch and mark its orders `exported`, so the next download does
 * not include them again — a duplicate import would mean duplicate invoices.
 */
export async function createExportBatch(shop: string): Promise<ExportBatch> {
  const rows = await pendingExport(shop);
  const drafts = parseDrafts(rows);
  const batchId = `B-${new Date().toISOString().slice(0, 10)}-${crypto
    .randomBytes(3)
    .toString("hex")}`;

  const csv = draftsToCsv(drafts);

  if (rows.length > 0) {
    await prisma.orderSync.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { state: "exported", exportBatch: batchId, exportedAt: new Date() },
    });
  }

  await logEvent(shop, {
    event: "export.batch_created",
    message: `Exported ${drafts.length} invoice(s) as batch ${batchId} for import into Scopevisio.`,
    data: { batchId, orders: drafts.map((d) => d.externalRef ?? d.externalId) },
  });

  return {
    csv,
    batchId,
    count: drafts.length,
    orderNames: drafts.map((d) => d.externalRef ?? d.externalId),
  };
}

/** Re-render a batch without changing any state, for a repeat download. */
export async function rebuildBatch(
  shop: string,
  batchId: string,
): Promise<ExportBatch> {
  const rows = await prisma.orderSync.findMany({
    where: { shop, exportBatch: batchId },
    orderBy: { createdAt: "asc" },
  });
  const drafts = parseDrafts(rows);
  return {
    csv: draftsToCsv(drafts),
    batchId,
    count: drafts.length,
    orderNames: drafts.map((d) => d.externalRef ?? d.externalId),
  };
}

/**
 * The bookkeeper confirms the import went through. Only a human can know this,
 * which is why it is an explicit action rather than an assumption.
 */
export async function confirmImported(
  shop: string,
  batchId: string,
  by: string,
) {
  const result = await prisma.orderSync.updateMany({
    where: { shop, exportBatch: batchId, state: "exported" },
    data: {
      state: "booked",
      reason: null,
      detail: null,
      importConfirmedAt: new Date(),
      importConfirmedBy: by,
    },
  });

  await logEvent(shop, {
    event: "export.import_confirmed",
    message: `${by} confirmed batch ${batchId} was imported into Scopevisio (${result.count} invoice(s)).`,
    data: { batchId, count: result.count },
  });

  return result.count;
}

/**
 * The import failed or was abandoned — put the orders back in the queue so the
 * next batch picks them up.
 */
export async function returnBatchToQueue(
  shop: string,
  batchId: string,
  reason: string,
) {
  const result = await prisma.orderSync.updateMany({
    where: { shop, exportBatch: batchId, state: "exported" },
    data: {
      state: "ready_to_export",
      exportBatch: null,
      exportedAt: null,
      detail: `Returned to the queue: ${reason}`,
    },
  });

  await logEvent(shop, {
    level: "warn",
    event: "export.batch_returned",
    message: `Batch ${batchId} returned to the queue (${result.count} invoice(s)): ${reason}`,
    data: { batchId, count: result.count, reason },
  });

  return result.count;
}

/** Distinct batches awaiting confirmation, newest first. */
export async function openBatches(shop: string) {
  const rows = await prisma.orderSync.findMany({
    where: { shop, state: "exported", exportBatch: { not: null } },
    orderBy: { exportedAt: "desc" },
  });

  const byBatch = new Map<
    string,
    { batchId: string; count: number; exportedAt: Date | null }
  >();
  for (const row of rows) {
    const id = row.exportBatch!;
    const entry = byBatch.get(id);
    if (entry) entry.count += 1;
    else byBatch.set(id, { batchId: id, count: 1, exportedAt: row.exportedAt });
  }
  return [...byBatch.values()];
}
