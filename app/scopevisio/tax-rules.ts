import { EU_COUNTRIES } from "./constants";
import type { OrderLike, TaxCase } from "./types";

/**
 * The pure part of VAT determination — no database, no network, no ERP.
 *
 * Kept separate from `vat.server.ts` deliberately: this is the highest-risk
 * logic in the connector, and isolating it means it can be tested exhaustively
 * without stubbing Prisma, VIES or Scopevisio.
 */

/**
 * Pick the destination country. Physical goods follow the shipping address; we
 * fall back to billing when there is none (digital-only or pickup orders),
 * which is also the correct rule for digital services.
 */
export function destinationCountry(order: OrderLike, fallback: string): string {
  return (
    order.shippingAddress?.countryCodeV2 ||
    order.billingAddress?.countryCodeV2 ||
    fallback
  ).toUpperCase();
}

/**
 * Decide the tax case. This is the only VAT *judgement* the connector makes;
 * everything downstream is a lookup against the merchant's Steuermatrix.
 *
 * `hasValidVatId` must mean "validated against VIES", not "the customer typed
 * something". An unvalidated ID may never produce `eu_b2b_reverse`, because
 * reverse charge shifts the liability and the merchant owes the domestic VAT if
 * the ID turns out to be invalid at the time of supply.
 */
export function classify(args: {
  destination: string;
  homeCountry: string;
  ossRegistered: boolean;
  hasValidVatId: boolean;
}): TaxCase {
  const dest = args.destination.toUpperCase();
  const home = args.homeCountry.toUpperCase();

  if (dest === home) return "domestic";

  if (EU_COUNTRIES.has(dest)) {
    if (args.hasValidVatId) return "eu_b2b_reverse";
    return args.ossRegistered ? "eu_b2c_oss" : "eu_b2c";
  }

  return "third_country";
}

/** Which settings field holds the Steuersachverhalt for each case. */
export const SCOPE_FIELD_FOR_CASE = {
  domestic: "vatScopeDomestic",
  eu_b2c: "vatScopeEuB2c",
  eu_b2c_oss: "vatScopeEuB2cOss",
  eu_b2b_reverse: "vatScopeEuB2bReverse",
  third_country: "vatScopeThirdCountry",
} as const satisfies Record<TaxCase, string>;

/**
 * VAT-ID country prefixes. Mostly ISO-3166 alpha-2, with the two standard
 * exceptions: EL for Greece and XI for Northern Ireland.
 */
const VAT_PREFIXES = new Set([...EU_COUNTRIES, "EL", "XI"]);

/**
 * Normalise a claimed VAT ID, returning null when it is not even structurally
 * a VAT ID. Rejecting early keeps junk out of the VIES call and out of the
 * audit trail.
 *
 * A shape check alone is not enough: stripping separators from free text turns
 * "yes please" into "YESPLEASE", which matches any all-letters pattern. So the
 * prefix must be a real VAT country and the remainder must contain a digit —
 * no national scheme issues a letters-only number.
 */
export function normaliseVatId(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = value.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(cleaned)) return null;

  const prefix = cleaned.slice(0, 2);
  const rest = cleaned.slice(2);

  if (!VAT_PREFIXES.has(prefix)) return null;
  if (!/\d/.test(rest)) return null;

  return cleaned;
}

/**
 * Pre-post checksum against a rate. Used when the ERP gives us a rate rather
 * than a computed amount.
 */
export function taxChecksum(args: {
  shopifyTaxCents: number;
  netCents: number;
  expectedRate: number | undefined;
  toleranceCents: number;
}): { ok: boolean; erpTaxCents: number | null; detail?: string } {
  if (args.expectedRate === undefined) {
    return { ok: true, erpTaxCents: null };
  }
  const erpTaxCents = Math.round((args.netCents * args.expectedRate) / 100);
  const delta = Math.abs(erpTaxCents - args.shopifyTaxCents);
  if (delta <= args.toleranceCents) {
    return { ok: true, erpTaxCents };
  }
  return {
    ok: false,
    erpTaxCents,
    detail:
      `Shopify calculated ${(args.shopifyTaxCents / 100).toFixed(2)} tax, ` +
      `your Steuermatrix implies ${(erpTaxCents / 100).toFixed(2)} ` +
      `(${args.expectedRate}%). The document was not posted.`,
  };
}

/**
 * Prefer a revenue account whose country matches the destination exactly —
 * that is how OSS destination accounts are distinguished from generic ones.
 */
export function pickRevenueAccount<
  T extends { countryIso?: string | null },
>(accounts: T[], country: string): T | null {
  if (accounts.length === 0) return null;
  const exact = accounts.find(
    (a) => (a.countryIso ?? "").toUpperCase() === country.toUpperCase(),
  );
  return exact ?? accounts[0];
}
