import { ScopevisioClient } from "./client";
import { EU_COUNTRIES, TAX_CASE_LABEL } from "./constants";
import { formatGermanDate } from "./format";
import {
  classify,
  destinationCountry,
  normaliseVatId,
  pickRevenueAccount,
  SCOPE_FIELD_FOR_CASE,
} from "./tax-rules";
import type {
  OrderLike,
  RecordsResponse,
  ResolvedTaxTreatment,
  RevenueAccount,
} from "./types";

/**
 * VAT determination — shared by every connector.
 *
 * The connector does NOT compute tax. It decides one thing, the
 * Steuersachverhalt, and then asks Scopevisio which Erlöskonto and
 * Steuerschlüssel that case implies for that destination on that date.
 *
 * The shop's own tax figures are a checksum only, never an input: a 0% line is
 * ambiguous across intra-EU B2B supply, third-country export, reverse charge
 * and Kleinunternehmer — four legal cases, four UStVA lines, four accounts. The
 * reason is not recoverable from the number.
 */

export interface TaxSettings {
  homeCountry: string;
  ossRegistered: boolean;
  vatScopeDomestic: number | null;
  vatScopeEuB2c: number | null;
  vatScopeEuB2cOss: number | null;
  vatScopeEuB2bReverse: number | null;
  vatScopeThirdCountry: number | null;
}

export interface VatIdCheck {
  valid: boolean;
  /** False means VIES could not be reached — which is not the same as invalid. */
  reachable: boolean;
  checkedAt: Date;
}

/**
 * Supplied by the connector so it can cache results in its own schema.
 *
 * The timestamp is part of the record on purpose: validity *at the time of
 * supply* is what the law cares about, not validity today.
 */
export interface VatIdValidator {
  validate(vatId: string): Promise<VatIdCheck>;
}

function records<T>(res: RecordsResponse<T> | T[] | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.records ?? [];
}

/**
 * Ask the tenant's Steuermatrix which accounts apply.
 *
 * Both sources are needed. `/revenueaccounts/products` returns only accounts
 * created for a specific product and explicitly EXCLUDES products using the
 * standard accounts; `/revenueaccounts/standard` returns the rest. Querying
 * products alone missed most of a real tenant's accounts — 7 of 12 for DE, and
 * 12 of 85 across all tax cases.
 *
 * Product-specific accounts are listed first so they win when both match: a
 * per-product account is the more specific configuration.
 */
export async function resolveRevenueAccounts(
  client: ScopevisioClient,
  args: { country: string; vatScope: number; servicesRenderedDate: Date },
): Promise<RevenueAccount[]> {
  const query = {
    country: args.country,
    vatScope: args.vatScope,
    servicesRenderedDate: formatGermanDate(args.servicesRenderedDate),
    active: true,
    pageSize: 500,
  };

  const [productAccounts, standardAccounts] = await Promise.all([
    client
      .get<RecordsResponse<RevenueAccount>>("/revenueaccounts/products", query)
      .then(records)
      .catch(() => [] as RevenueAccount[]),
    client
      .get<RecordsResponse<RevenueAccount>>("/revenueaccounts/standard", query)
      .then(records)
      .catch(() => [] as RevenueAccount[]),
  ]);

  return [...productAccounts, ...standardAccounts];
}

/**
 * VIES validation without caching. A connector normally wraps this in its own
 * cache and persists the result with its timestamp.
 */
export async function checkVatIdAgainstVies(vatId: string): Promise<VatIdCheck> {
  const countryCode = vatId.slice(0, 2);
  const number = vatId.slice(2);
  try {
    const res = await fetch(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ countryCode, vatNumber: number }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return { valid: false, reachable: false, checkedAt: new Date() };
    const body = (await res.json()) as { valid?: boolean };
    return { valid: Boolean(body.valid), reachable: true, checkedAt: new Date() };
  } catch {
    // Unreachable is not invalid. The caller must never treat a network failure
    // as grounds for reverse charge.
    return { valid: false, reachable: false, checkedAt: new Date() };
  }
}

/**
 * Full determination for one order.
 *
 * Returns a `hold` wherever it refuses to guess. Holding is always preferable
 * to posting a wrong document, because a posted document cannot be unposted
 * under GoBD — only corrected with a credit note.
 */
export async function determineTaxTreatment(args: {
  client: ScopevisioClient;
  order: OrderLike;
  settings: TaxSettings;
  servicesRenderedDate: Date;
  vatIds: VatIdValidator;
}): Promise<ResolvedTaxTreatment> {
  const { client, order, settings, servicesRenderedDate, vatIds } = args;
  const country = destinationCountry(order, settings.homeCountry);

  let hasValidVatId = false;
  let vatIdProblem: string | null = null;
  const claimedVatId = normaliseVatId(order.vatId);

  if (claimedVatId) {
    const check = await vatIds.validate(claimedVatId);
    hasValidVatId = check.valid;
    if (!check.valid) {
      vatIdProblem = check.reachable
        ? `The VAT ID ${claimedVatId} was rejected by VIES.`
        : `The VAT ID ${claimedVatId} could not be validated — VIES was unreachable.`;
    }
  }

  const taxCase = classify({
    destination: country,
    homeCountry: settings.homeCountry,
    ossRegistered: settings.ossRegistered,
    hasValidVatId,
  });

  // A claimed but unvalidated VAT ID on a cross-border EU order is exactly the
  // case where guessing is expensive: reverse charge shifts the liability, and
  // if the ID turns out invalid the merchant owes the domestic VAT.
  if (vatIdProblem && EU_COUNTRIES.has(country) && country !== settings.homeCountry) {
    return {
      taxCase,
      vatScope: settings[SCOPE_FIELD_FOR_CASE[taxCase]] as number | null,
      country,
      hold: {
        reason: "vat_id_unvalidated",
        detail:
          `${vatIdProblem} Reverse charge requires an ID that is valid at the time of supply, ` +
          `so this order was not booked. Book it with ${settings.homeCountry} VAT, or hold it ` +
          `until the customer supplies a valid ID.`,
      },
    };
  }

  const vatScope = settings[SCOPE_FIELD_FOR_CASE[taxCase]] as number | null;
  if (!vatScope) {
    return {
      taxCase,
      vatScope: null,
      country,
      hold: {
        reason: "vat_scope_unconfigured",
        detail:
          `No Steuersachverhalt is configured for "${TAX_CASE_LABEL[taxCase]}". ` +
          `Choose one in the tax mapping settings, then reprocess this order.`,
      },
    };
  }

  let accounts: RevenueAccount[];
  try {
    accounts = await resolveRevenueAccounts(client, {
      country,
      vatScope,
      servicesRenderedDate,
    });
  } catch (err) {
    return {
      taxCase,
      vatScope,
      country,
      hold: {
        reason: "revenue_account_lookup_failed",
        detail:
          `Scopevisio could not be asked which Erlöskonto applies to ` +
          `"${TAX_CASE_LABEL[taxCase]}" for ${country}: ${(err as Error).message}`,
      },
    };
  }

  const account = pickRevenueAccount(accounts, country);
  if (!account) {
    return {
      taxCase,
      vatScope,
      country,
      hold: {
        reason: "no_revenue_account",
        detail:
          `Your Steuermatrix has no active Erlöskonto for "${TAX_CASE_LABEL[taxCase]}" ` +
          `and destination ${country} on ${servicesRenderedDate.toLocaleDateString("de-DE")}. ` +
          `Add one in Scopevisio, then reprocess.`,
      },
    };
  }

  return {
    taxCase,
    vatScope,
    country,
    account: account.accountNumber,
    vatKey: account.vatKey,
    reverseCharge: account.reverseCharge ?? false,
  };
}
