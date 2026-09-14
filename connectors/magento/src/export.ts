import crypto from "node:crypto";

import { draftsToCsv, type InvoiceDraft } from "@erp/scopevisio-core";

import prisma from "./db.js";
import { recordEvent } from "./store.js";

/**
 * CSV batches — the lifecycle around core's renderer.
 *
 * Downloading marks the batch's invoices `exported`, so the next download
 * cannot include them again: a double import means duplicate invoices. The
 * connector cannot observe the import in the Scopevisio client, so nothing is
 * `booked` until a person confirms it.
 */

function parseDrafts(rows: Array<{ draftJson: string | null }>): InvoiceDraft[] {
  const drafts: InvoiceDraft[] = [];
  for (const row of rows) {
    if (!row.draftJson) continue;
    try {
      drafts.push(JSON.parse(row.draftJson) as InvoiceDraft);
    } catch {
      // One corrupt draft must not take the batch down.
    }
  }
  return drafts;
}

const render = (drafts: InvoiceDraft[]) => draftsToCsv(drafts, { sourceLabel: "Magento" });

export function pendingExport(storeId: string) {
  return prisma.syncRecord.findMany({
    where: { storeId, state: "ready_to_export", draftJson: { not: null } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createExportBatch(storeId: string, by: string) {
  const rows = await pendingExport(storeId);
  const batchId = `M-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
  const drafts = parseDrafts(rows);

  if (rows.length > 0) {
    // Only rows still ready — a concurrent download must not re-export them.
    await prisma.syncRecord.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, state: "ready_to_export" },
      data: { state: "exported", exportBatch: batchId, exportedAt: new Date() },
    });
  }
  await recordEvent(storeId, {
    event: "export.batch_created",
    message: `${by} hat ${drafts.length} Rechnung(en) als Batch ${batchId} exportiert.`,
    data: { batchId, invoices: drafts.map((d) => d.externalRef ?? d.externalId) },
  });
  return { batchId, count: drafts.length, csv: render(drafts) };
}

export async function rebuildBatch(storeId: string, batchId: string) {
  const rows = await prisma.syncRecord.findMany({
    where: { storeId, exportBatch: batchId },
    orderBy: { createdAt: "asc" },
  });
  return { batchId, count: rows.length, csv: render(parseDrafts(rows)) };
}

export async function confirmImported(storeId: string, batchId: string, by: string) {
  const result = await prisma.syncRecord.updateMany({
    where: { storeId, exportBatch: batchId, state: "exported" },
    data: { state: "booked", importConfirmedAt: new Date(), importConfirmedBy: by },
  });
  await recordEvent(storeId, {
    event: "export.import_confirmed",
    message: `${by} hat den Import von Batch ${batchId} bestätigt (${result.count} Rechnung(en)).`,
    data: { batchId, count: result.count },
  });
  return result.count;
}

export async function returnBatchToQueue(storeId: string, batchId: string, reason: string, by: string) {
  const result = await prisma.syncRecord.updateMany({
    where: { storeId, exportBatch: batchId, state: "exported" },
    data: { state: "ready_to_export", exportBatch: null, exportedAt: null },
  });
  await recordEvent(storeId, {
    level: "warn",
    event: "export.batch_returned",
    message: `${by} hat Batch ${batchId} zurückgegeben (${result.count} Rechnung(en)): ${reason}`,
    data: { batchId, count: result.count, reason },
  });
  return result.count;
}

export async function openBatches(storeId: string) {
  const rows = await prisma.syncRecord.findMany({
    where: { storeId, state: "exported", exportBatch: { not: null } },
    orderBy: { exportedAt: "desc" },
  });
  const byBatch = new Map<string, { batchId: string; count: number; exportedAt: Date | null }>();
  for (const row of rows) {
    const entry = byBatch.get(row.exportBatch!);
    if (entry) entry.count++;
    else byBatch.set(row.exportBatch!, { batchId: row.exportBatch!, count: 1, exportedAt: row.exportedAt });
  }
  return [...byBatch.values()];
}
