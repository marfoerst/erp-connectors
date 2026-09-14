import type { InvoiceDraft } from "./types";

/**
 * CSV rendering of invoice drafts — the delivery path that works today.
 *
 * Importing this file in the Scopevisio client under Abrechnung →
 * Abrechnungsbelege creates real billing documents, which the Faktura module
 * renders and sends like any manually entered invoice. The API's only
 * document-create endpoint has an undocumented XML schema
 * (docs/API-FINDINGS.md §7), so this is the shipping path, not a fallback.
 *
 * Pure: no database, no network. Batching, the `exported` state and the human
 * import confirmation are bound to each connector's schema and stay there.
 */

/**
 * Column headers use the Scopevisio field names so the mapping step in the
 * client importer is one-to-one wherever possible. The importer lets the
 * bookkeeper remap columns, which is what makes this robust to any naming
 * difference.
 */
export const CSV_COLUMNS = [
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
  return escapeCsv(Number.isInteger(value) ? String(value) : String(value).replace(".", ","));
}

export interface CsvOptions {
  /** Shown in the document text before the reference, e.g. "Shopify", "Magento". */
  sourceLabel: string;
}

export function draftsToCsv(drafts: InvoiceDraft[], opts: CsvOptions): string {
  const lines: string[] = [CSV_COLUMNS.join(";")];

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
          cell(d.externalRef ? `${opts.sourceLabel} ${d.externalRef}` : ""),
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
