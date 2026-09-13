import prisma from "../db.server";
import { EU_COUNTRIES, TAX_CASE_LABEL ,
  classify,
  destinationCountry,
  normaliseVatId,
  pickRevenueAccount,
  SCOPE_FIELD_FOR_CASE,
} from "@erp/scopevisio-core";
import { resolveRevenueAccounts } from "./masterdata.server";
import type { OrderLike, ResolvedTaxTreatment } from "@erp/scopevisio-core";

/**
 * VAT determination.
 *
 * The connector does NOT compute tax. It decides one thing — the
 * Steuersachverhalt (tax case) — and then asks Scopevisio which Erlöskonto and
 * Steuerschlüssel that case implies for that destination on that date.
 *
 * Shopify's own tax figures are used only as a checksum before posting, never
 * as an input, because a 0% line is ambiguous across intra-EU B2B supply,
 * third-country export, reverse charge and Kleinunternehmer — four different
 * legal cases with four different UStVA lines. See docs/API-FINDINGS.md §5.
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


/**
 * Full determination for one order. Returns a `hold` when we refuse to guess —
 * holding is always preferred to posting a wrong document, because a posted
 * document cannot be unposted (PRD C-006).
 */
export async function determineTaxTreatment(
  shop: string,
  order: OrderLike,
  settings: TaxSettings,
  servicesRenderedDate: Date,
): Promise<ResolvedTaxTreatment> {
  const country = destinationCountry(order, settings.homeCountry);

  // A VAT ID only counts if it was valid at the time of supply.
  let hasValidVatId = false;
  let vatIdProblem: string | null = null;
  const claimedVatId = normaliseVatId(order.vatId);

  if (claimedVatId) {
    const check = await validateVatId(shop, claimedVatId);
    hasValidVatId = check.valid;
    if (!check.valid) {
      vatIdProblem =
        check.reachable
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
  // case where guessing is expensive: reverse charge would shift the liability,
  // and if the ID turns out invalid the merchant owes the domestic VAT.
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
          `Choose one in Settings → Tax mapping, then reprocess this order.`,
      },
    };
  }

  // Ask the ERP what this case means for this country on this date.
  let accounts;
  try {
    accounts = await resolveRevenueAccounts(shop, {
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

/**
 * VIES validation, with the result and its timestamp persisted — the timestamp
 * is part of the record because validity *at the time of supply* is what the
 * law cares about.
 */
export async function validateVatId(
  shop: string,
  vatId: string,
  opts: { maxAgeMs?: number } = {},
): Promise<{ valid: boolean; reachable: boolean; checkedAt: Date }> {
  const maxAge = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;

  const previous = await prisma.vatIdCheck.findFirst({
    where: { shop, vatId },
    orderBy: { checkedAt: "desc" },
  });
  if (previous && Date.now() - previous.checkedAt.getTime() < maxAge) {
    return { valid: previous.valid, reachable: true, checkedAt: previous.checkedAt };
  }

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

    if (!res.ok) {
      return { valid: false, reachable: false, checkedAt: new Date() };
    }

    const body = (await res.json()) as { valid?: boolean; userError?: string };
    const record = await prisma.vatIdCheck.create({
      data: {
        shop,
        vatId,
        valid: Boolean(body.valid),
        detail: body.userError ?? null,
      },
    });
    return { valid: record.valid, reachable: true, checkedAt: record.checkedAt };
  } catch {
    // Unreachable is not the same as invalid. The caller must not treat a
    // network failure as grounds for reverse charge.
    return { valid: false, reachable: false, checkedAt: new Date() };
  }
}

// Re-exported so callers need only one import site.
export { classify, destinationCountry, normaliseVatId, taxChecksum } from "@erp/scopevisio-core";
