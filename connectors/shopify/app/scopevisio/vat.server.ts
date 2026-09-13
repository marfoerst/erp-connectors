import {
  checkVatIdAgainstVies,
  determineTaxTreatment as coreDetermineTaxTreatment,
  type OrderLike,
  type ResolvedTaxTreatment,
  type TaxSettings,
  type VatIdCheck,
  type VatIdValidator,
} from "@erp/scopevisio-core";

import prisma from "../db.server";

import { clientFor } from "./core.server";

/**
 * VAT determination for this connector.
 *
 * The decision itself lives in `@erp/scopevisio-core` — it is identical for
 * every connector and must never be forked. What belongs here is only the part
 * that is genuinely local: where VIES results are cached.
 */

export type { TaxSettings };

/**
 * VIES validation with the result and its timestamp persisted.
 *
 * The timestamp is part of the record because validity *at the time of supply*
 * is what the law cares about, not validity today.
 */
export function vatIdValidator(shop: string): VatIdValidator {
  return {
    async validate(vatId: string): Promise<VatIdCheck> {
      const maxAge = 24 * 60 * 60 * 1000;

      const previous = await prisma.vatIdCheck.findFirst({
        where: { shop, vatId },
        orderBy: { checkedAt: "desc" },
      });
      if (previous && Date.now() - previous.checkedAt.getTime() < maxAge) {
        return { valid: previous.valid, reachable: true, checkedAt: previous.checkedAt };
      }

      const check = await checkVatIdAgainstVies(vatId);
      // Only a reachable answer is worth caching. Caching "unreachable" would
      // turn a transient network failure into a day of wrong decisions.
      if (!check.reachable) return check;

      const record = await prisma.vatIdCheck.create({
        data: { shop, vatId, valid: check.valid, detail: null },
      });
      return { valid: record.valid, reachable: true, checkedAt: record.checkedAt };
    },
  };
}

export async function validateVatId(shop: string, vatId: string): Promise<VatIdCheck> {
  return vatIdValidator(shop).validate(vatId);
}

export async function determineTaxTreatment(
  shop: string,
  order: OrderLike,
  settings: TaxSettings,
  servicesRenderedDate: Date,
): Promise<ResolvedTaxTreatment> {
  return coreDetermineTaxTreatment({
    client: await clientFor(shop),
    order,
    settings,
    servicesRenderedDate,
    vatIds: vatIdValidator(shop),
  });
}

// Re-exported so callers need only one import site.
export { classify, destinationCountry, normaliseVatId, taxChecksum } from "@erp/scopevisio-core";
