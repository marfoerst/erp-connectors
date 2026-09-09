/**
 * Types for the parts of the Scopevisio OpenScope REST API this connector uses.
 * Field names mirror the OpenAPI spec exactly — see docs/API-FINDINGS.md.
 */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  /**
   * The token endpoint resolves and returns the organisation even when the
   * request omits it — so the merchant never has to know or type it.
   */
  organisationId?: number;
  organisationName?: string;
  uid?: string;
  customerId?: string;
  publicId?: string;
}

/** GET /vatscopes — Steuersachverhalte */
export interface VatScope {
  id: number;
  area?: number;
  active: boolean;
  caseId: number;
  caseName: string;
  caseDescription?: string;
}

/** GET /vatmatrixentries — the Steuermatrix */
export interface VatMatrixEntry {
  id: number;
  vatRate: number;
  vatKey: string;
  vatKeyDescription?: string;
  vatCode?: string;
  datevKey?: string;
  datevKeyReduced?: string;
  purchaseAccount?: string;
  salesAccount?: string;
  salesNotDueAccount?: string;
  cashDiscountAccount?: string;
}

/** GET /revenueaccounts/* — Erlöskonten */
export interface RevenueAccount {
  id: number;
  accountNumber: string;
  accountId?: number;
  vatKey: string;
  taxKey?: string;
  taxCaseId?: number;
  taxCaseName?: string;
  countryCode?: string;
  countryIso?: string;
  originalCountryIso?: string;
  productId?: number;
  productType?: number;
  merchandiseGroupId?: number;
  validFrom?: number;
  validTill?: number;
  reverseCharge?: boolean;
  matrix?: boolean;
  advance?: boolean;
  description?: string;
}

/** Envelope used by most list endpoints. */
export interface RecordsResponse<T> {
  records?: T[];
}

/** POST /contact/new — KontaktForm (the subset we set) */
export interface KontaktForm {
  /** true = Person, false = Gesellschaft. Evaluated ONLY at creation. */
  person: boolean;
  lastname: string;
  firstname?: string;
  salutation?: "Herr" | "Frau" | "Familie" | "Eheleute";
  email?: string;
  phone?: string;
  mobile?: string;
  street1?: string;
  addressExtra1?: string;
  postcode1?: string;
  city1?: string;
  country1?: string;
  /** "ID Vorsystem" — we store the Shopify customer GID here. */
  legacyNumber?: string;
  /** Schlagwörter, single free-text field. */
  tags?: string;
  vatId?: string;
  currency?: string;
  language?: string;
  website?: string;
  description?: string;
  paymentTypeName?: string;
  customerNumber?: string;
}

export interface ContactNewResponse {
  id?: number;
  /** Some endpoints return the master id under a different name. */
  masterId?: number;
  contactId?: number;
}

/** POST /createdebitor — PersonalAccountForm (the subset we set) */
export interface PersonalAccountForm {
  contactId?: number;
  customerNumber?: string;
  externalNumber?: string;
  email?: string;
  personalAccountNumber?: string;
  sumAccountNumber?: string;
  numberRangeNumber?: number;
  /** Kundengruppe — created by the ERP if it does not exist. */
  group?: string;
  vatCode?: string;
  paymentType?: string;
  vatNumber?: string;
  vatId?: string;
  currency?: string;
  language?: string;
  paymentTermId?: number;
  /** Conto pro Diverse — the native one-off-customer construct. */
  contoProDiverse?: boolean;
}

export interface PersonalAccountResponse {
  personalAccountNumber?: string;
  accountNumber?: string;
  number?: string;
  id?: number;
}

/** POST /outgoinginvoices/import — OutgoingInvoiceImportForm */
export interface OutgoingInvoiceImportForm {
  /** XML import document. */
  data: string;
  generateDocumentNumbers?: boolean;
  doPost?: boolean;
  /** Built-in idempotency. */
  skipDuplicates?: boolean;
  createPdf?: boolean;
  template?: string;
  copyProductToPosition?: boolean;
  copyProductToPositionOverwriteMode?: boolean;
  copyImpersonalAccountFieldsToPosition?: boolean;
  copyVatKeyAndTaxRateToPosition?: boolean;
}

/**
 * Actual response shape of POST /outgoinginvoices/import, observed live on
 * 2026-09-08:
 *   {"message":"Importierte Abrechnungsbelege: []","invoices":[],
 *    "customers":[],"vendors":[]}
 *
 * ⚠️ It answers HTTP 200 with `invoices: []` when it does not recognise the
 * document — success and total failure are indistinguishable by status code.
 * So an empty `invoices` array MUST be treated as a failure.
 */
export interface ImportResult {
  message?: string;
  invoices?: Array<string | { number?: string; documentNumber?: string }>;
  customers?: unknown[];
  vendors?: unknown[];
  errors?: string[];
  [key: string]: unknown;
}

/** The tax cases this connector distinguishes. */
export type TaxCase =
  | "domestic"
  | "eu_b2c"
  | "eu_b2c_oss"
  | "eu_b2b_reverse"
  | "third_country";

export interface ResolvedTaxTreatment {
  taxCase: TaxCase;
  /** Steuersachverhalt id passed to GET /revenueaccounts/products. */
  vatScope: number | null;
  /** Destination country, ISO-3166 alpha-2. */
  country: string;
  /** Resolved from the ERP, when a lookup succeeded. */
  account?: string;
  vatKey?: string;
  expectedRate?: number;
  reverseCharge?: boolean;
  /** Set when we refuse to decide — the document must be held. */
  hold?: { reason: string; detail: string };
}

/** A minimal view of the Shopify order fields the connector consumes. */
export interface OrderLike {
  id: string;
  name?: string;
  orderNumber?: number | string;
  createdAt?: string;
  processedAt?: string;
  currencyCode?: string;
  customer?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  email?: string | null;
  billingAddress?: AddressLike | null;
  shippingAddress?: AddressLike | null;
  totalTaxCents?: number;
  lineItems: OrderLineLike[];
  /** Company VAT ID, when the merchant collects one. */
  vatId?: string | null;
  paymentGatewayNames?: string[];
}

export interface AddressLike {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
}

export interface OrderLineLike {
  title: string;
  sku?: string | null;
  quantity: number;
  /** Net or gross per unit depending on the shop's tax settings. */
  unitAmount: number;
  taxCents?: number;
  taxRate?: number | null;
  productId?: string | null;
}
