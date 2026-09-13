import {
  checkVatIdAgainstVies,
  type VatIdCheck,
  type VatIdValidator,
} from "@erp/scopevisio-core";

import prisma from "./db.js";

/**
 * VIES validation, cached per shop.
 *
 * The decision logic lives in core and is shared with every other connector.
 * Only the cache is local, because only the schema is local.
 */
export function vatIdValidator(shopId: string): VatIdValidator {
  return {
    async validate(vatId: string): Promise<VatIdCheck> {
      const maxAge = 24 * 60 * 60 * 1000;

      const previous = await prisma.vatIdCheck.findFirst({
        where: { shopId, vatId },
        orderBy: { checkedAt: "desc" },
      });
      if (previous && Date.now() - previous.checkedAt.getTime() < maxAge) {
        return { valid: previous.valid, reachable: true, checkedAt: previous.checkedAt };
      }

      const check = await checkVatIdAgainstVies(vatId);
      // Only a reachable answer is cached. Caching "unreachable" would turn a
      // transient network failure into a day of wrong decisions.
      if (!check.reachable) return check;

      const record = await prisma.vatIdCheck.create({
        data: { shopId, vatId, valid: check.valid },
      });
      return { valid: record.valid, reachable: true, checkedAt: record.checkedAt };
    },
  };
}
