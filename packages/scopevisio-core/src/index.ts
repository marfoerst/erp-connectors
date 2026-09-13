/**
 * @erp/scopevisio-core — everything a connector needs to talk to Scopevisio.
 *
 * No database, no commerce platform, no framework. A connector supplies the two
 * ports in `./ports` and brings its own storage.
 */
export { ScopevisioClient, ScopevisioError } from "./client";
export type { ConnectionInput } from "./client";
export type { ScopevisioContext } from "./context";
export type {
  ConnectionRecord,
  ConnectionStore,
  Journal,
  JournalEntry,
  JournalLevel,
} from "./ports";
export { silentJournal } from "./ports";

export * from "./crypto";
export { formatGermanDate } from "./format";

export * from "./tax-rules";
export * from "./constants";

export { upsertCustomer } from "./contacts";
export type { UpsertResult, CustomerSettings } from "./contacts";

export {
  buildInvoiceXml,
  buildCreditXml,
  escapeXml,
  createInvoice,
  postInvoice,
  getInvoice,
  getInvoiceTaxCents,
} from "./invoices";
export type { InvoiceBuildArgs, CreditBuildArgs, CreateInvoiceResult } from "./invoices";

export { buildPostings, bookPostings, documentNumberForOrder } from "./postings";
export type {
  PostingRow,
  PostingsPayload,
  PostingSettings,
  BuildPostingsArgs,
  PostingsResult,
} from "./postings";

export * from "./tax";
export * from "./types";
