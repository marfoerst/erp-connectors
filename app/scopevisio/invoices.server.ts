import { ScopevisioClient, ScopevisioError } from "./client.server";
import { formatGermanDate } from "./masterdata.server";
import type {
  ImportResult,
  OrderLike,
  OutgoingInvoiceImportForm,
  ResolvedTaxTreatment,
} from "./types";

/**
 * Outgoing invoice (Faktura) creation.
 *
 * `POST /outgoinginvoices/import` takes an **XML** document in its `data`
 * field — the OpenAPI spec types it only as `string`, so the element names
 * below are NOT machine-verifiable from the spec.
 *
 * ⚠️ CONFIRMED BROKEN — tested live 2026-09-08. The import returns HTTP 200
 * with {"message":"Importierte Abrechnungsbelege: []","invoices":[]}, i.e. it
 * silently recognises nothing. The element names below are informed guesses
 * taken from `OutgoingInvoiceForm` / `OutgoingInvoicePositionForm`, but the
 * root element and nesting are unknown and the endpoint returns no error to
 * iterate against, so they cannot be derived by experiment.
 *
 * `POST /outgoinginvoice/{number}` is NOT an alternative: it is update-only and
 * answers 404 for any number that does not already exist, whatever the payload.
 * So XML import is the only create path and this is a hard blocker.
 *
 * What is needed: the import-document schema from whoever owns OpenScope.
 * Tracked as OQ-10 in docs/PRD.md.
 *
 * Two deliberate choices that are NOT provisional:
 *  - `doPost: false` always. Create, verify the tax checksum, then post
 *    separately, because a posted document cannot be unposted (GoBD).
 *  - `skipDuplicates: true` always. The ERP's own duplicate guard is a second
 *    line of defence behind our OrderSync unique key.
 */

export interface InvoiceBuildArgs {
  order: OrderLike;
  contactId: number;
  personalAccount?: string;
  treatment: ResolvedTaxTreatment;
  documentDate: Date;
  /** Our own reference, so a document can always be traced back to its order. */
  externalReference: string;
  /** When true, omit account/vatKey and let the ERP derive them. */
  deriveFromProduct: boolean;
}

export function buildInvoiceXml(args: InvoiceBuildArgs): string {
  const { order, treatment } = args;

  const positions = order.lineItems
    .map((line) => {
      const fields: string[] = [
        el("name", line.title),
        el("quantity", String(line.quantity)),
        el("singleAmount", line.unitAmount.toFixed(2)),
      ];
      // "number" is the Produktnummer field name in OutgoingInvoicePositionForm.
      if (line.sku) fields.push(el("number", line.sku));
      // When the product master is authoritative we send neither the account
      // nor the tax key and let copyVatKeyAndTaxRateToPosition fill them in.
      if (!args.deriveFromProduct) {
        if (treatment.account) fields.push(el("account", treatment.account));
        if (treatment.vatKey) fields.push(el("vatKey", treatment.vatKey));
      }
      return `      <position>\n${fields.map((f) => `        ${f}`).join("\n")}\n      </position>`;
    })
    .join("\n");

  const header: string[] = [
    el("customerContactId", String(args.contactId)),
    el("documentDate", formatGermanDate(args.documentDate)),
    el("externalReference", args.externalReference),
    el("currency", order.currencyCode ?? "EUR"),
  ];
  if (args.personalAccount) {
    header.push(el("customerPersonalAccountNumber", args.personalAccount));
  }
  if (order.name) header.push(el("text", `Shopify ${order.name}`));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<outgoingInvoices>",
    "  <outgoingInvoice>",
    ...header.map((h) => `    ${h}`),
    "    <positionsForm>",
    positions,
    "    </positionsForm>",
    "  </outgoingInvoice>",
    "</outgoingInvoices>",
  ].join("\n");
}

function el(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface CreateInvoiceResult {
  documentNumber: string | null;
  raw: ImportResult;
}

/** Create the invoice, unposted. */
export async function createInvoice(
  shop: string,
  args: InvoiceBuildArgs,
  opts: { template?: string | null; copyProductFields: boolean },
): Promise<CreateInvoiceResult> {
  const client = await ScopevisioClient.forShop(shop);

  const form: OutgoingInvoiceImportForm = {
    data: buildInvoiceXml(args),
    generateDocumentNumbers: true,
    // Never post on import. The checksum runs between create and post.
    doPost: false,
    skipDuplicates: true,
    createPdf: Boolean(opts.template),
    template: opts.template ?? undefined,
    copyProductToPosition: opts.copyProductFields,
    copyVatKeyAndTaxRateToPosition: args.deriveFromProduct,
    copyImpersonalAccountFieldsToPosition: args.deriveFromProduct,
  };

  const raw = await client.post<ImportResult>("/outgoinginvoices/import", form);

  if (raw?.errors?.length) {
    throw new ScopevisioError(
      `Scopevisio rejected the invoice import: ${raw.errors.join("; ")}`,
      undefined,
      JSON.stringify(raw),
      true,
    );
  }

  // The endpoint returns 200 with an empty `invoices` array when it does not
  // recognise the document, so this is the only reliable success signal.
  const imported = raw?.invoices ?? [];
  if (imported.length === 0) {
    throw new ScopevisioError(
      "Scopevisio accepted the import request but created no invoice " +
        `(${raw?.message ?? "no message"}). The import document was not recognised.`,
      undefined,
      JSON.stringify(raw),
      true,
    );
  }

  const documentNumber = extractNumber(imported[0]);

  return { documentNumber, raw };
}

/** Commit to the ledger. Irreversible — only call after the checksum passes. */
export async function postInvoice(shop: string, documentNumber: string) {
  const client = await ScopevisioClient.forShop(shop);
  return client.post(`/outgoinginvoice/${encodeURIComponent(documentNumber)}/post`);
}

export async function getInvoice(shop: string, documentNumber: string) {
  const client = await ScopevisioClient.forShop(shop);
  return client.get(`/outgoinginvoice/${encodeURIComponent(documentNumber)}`);
}

/**
 * Read back the created document to obtain the ERP's own tax figure. This is
 * the authoritative side of the checksum — better than recomputing a rate
 * ourselves, when the endpoint gives it to us.
 */
export async function getInvoiceTaxCents(
  shop: string,
  documentNumber: string,
): Promise<number | null> {
  try {
    const doc = (await getInvoice(shop, documentNumber)) as Record<string, unknown>;
    for (const key of ["vatAmount", "taxAmount", "totalVat", "vatTotal"]) {
      const value = doc?.[key];
      if (typeof value === "number") return Math.round(value * 100);
    }
    return null;
  } catch {
    return null;
  }
}

function extractNumber(
  entry: string | { number?: string; documentNumber?: string } | undefined,
): string | null {
  if (!entry) return null;
  if (typeof entry === "string") return entry || null;
  return entry.documentNumber ?? entry.number ?? null;
}

// --- Credit notes (refunds) -------------------------------------------------

export interface CreditBuildArgs extends InvoiceBuildArgs {
  /** The invoice this credit note corrects. */
  originalDocumentNumber: string;
}

/**
 * A posted Faktura cannot be edited, so a refund is always a Gutschrift that
 * references the original document (PRD C-008).
 */
export function buildCreditXml(args: CreditBuildArgs): string {
  const base = buildInvoiceXml(args);
  return base
    .replace("<outgoingInvoices>", "<credits>")
    .replace("</outgoingInvoices>", "</credits>")
    .replace("<outgoingInvoice>", "<credit>")
    .replace("</outgoingInvoice>", "</credit>")
    .replace(
      "    <positionsForm>",
      `    ${el("parentDocumentNumber", args.originalDocumentNumber)}\n    <positionsForm>`,
    );
}
