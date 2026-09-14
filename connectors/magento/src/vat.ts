import { checkVatIdAgainstVies, type VatIdCheck, type VatIdValidator } from "@erp/scopevisio-core";

import prisma from "./db.js";

/**
 * VIES validation, cached per store. The decision logic is core's; only the
 * cache is local, because only the schema is local.
 */
export function vatIdValidator(storeId: string): VatIdValidator {
  return {
    async validate(vatId: string): Promise<VatIdCheck> {
      const maxAge = 24 * 60 * 60 * 1000;
      const previous = await prisma.vatIdCheck.findFirst({
        where: { storeId, vatId },
        orderBy: { checkedAt: "desc" },
      });
      if (previous && Date.now() - previous.checkedAt.getTime() < maxAge) {
        return { valid: previous.valid, reachable: true, checkedAt: previous.checkedAt };
      }

      const check = await checkVatIdAgainstVies(vatId);
      // Caching "unreachable" would turn a transient outage into a day of
      // wrong decisions.
      if (!check.reachable) return check;

      const record = await prisma.vatIdCheck.create({
        data: { storeId, vatId, valid: check.valid },
      });
      return { valid: record.valid, reachable: true, checkedAt: record.checkedAt };
    },
  };
}
