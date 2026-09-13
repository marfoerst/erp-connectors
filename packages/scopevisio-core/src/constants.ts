import type { TaxCase } from "./types";

/**
 * Values shared by server code and the embedded UI.
 *
 * Deliberately NOT a `.server` module: Remix only strips server code from a
 * route's `loader`, `action` and `headers` exports, so anything a component
 * renders must live somewhere the client bundle can safely import.
 */

export const DEFAULT_BASE_URL = "https://appload.scopevisio.com";

/** How each tax case is named for a bookkeeper. */
export const TAX_CASE_LABEL: Record<TaxCase, string> = {
  domestic: "Domestic",
  eu_b2c: "EU B2C (domestic VAT, below threshold)",
  eu_b2c_oss: "EU B2C via OSS (destination VAT)",
  eu_b2b_reverse: "EU B2B — reverse charge",
  third_country: "Third-country export",
};

/** EU member states, ISO-3166 alpha-2, as of 2026. */
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
]);

/** Why a document was held, in the bookkeeper's language. */
export const HOLD_REASON_LABEL: Record<string, string> = {
  vat_id_unvalidated: "VAT ID could not be validated",
  vat_scope_unconfigured: "Tax case not configured",
  no_revenue_account: "No matching revenue account",
  revenue_account_lookup_failed: "Could not reach the Steuermatrix",
  tax_mismatch: "Shopify and Scopevisio disagree on VAT",
  awaiting_manual_post: "Waiting for you to post it",
  no_document_number: "No document number returned",
  scopevisio_rejected: "Scopevisio refused the request",
  sync_error: "Unexpected error",
  sync_disabled: "Sync was switched off",
  refunded_before_posting: "Refunded before it was posted",
  unknown_order: "Refund for an unbooked order",
  credit_failed: "Credit note could not be created",
  missing_contact: "No contact recorded on the original booking",
};

/**
 * The tax cases the merchant configures, in the order they are presented.
 * Shared so the settings form and the server-side validation cannot drift.
 */
export const SCOPE_FIELDS: Array<{
  field: string;
  taxCase: TaxCase;
  help: string;
}> = [
  {
    field: "vatScopeDomestic",
    taxCase: "domestic",
    help: "Orders shipped inside your own country of taxation.",
  },
  {
    field: "vatScopeEuB2c",
    taxCase: "eu_b2c",
    help: "Consumers in other EU states while you are below the €10,000 threshold — your domestic VAT applies.",
  },
  {
    field: "vatScopeEuB2cOss",
    taxCase: "eu_b2c_oss",
    help: "Consumers in other EU states once you are OSS-registered — destination VAT applies.",
  },
  {
    field: "vatScopeEuB2bReverse",
    taxCase: "eu_b2b_reverse",
    help: "Businesses in other EU states with a VAT ID that validates. Reverse charge.",
  },
  {
    field: "vatScopeThirdCountry",
    taxCase: "third_country",
    help: "Deliveries outside the EU — normally a tax-free export.",
  },
];
