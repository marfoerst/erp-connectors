import prisma from "../db.server";
import { ScopevisioClient } from "./client.server";
import type {
  RecordsResponse,
  RevenueAccount,
  VatMatrixEntry,
  VatScope,
} from "./types";

/**
 * Reads the merchant's own Scopevisio master data so the settings UI can offer
 * real choices instead of free-text fields (PRD C-002). Cached per shop because
 * the settings screen would otherwise hit the ERP on every render.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

type Kind = "vatscopes" | "vatmatrix" | "revenueaccounts";

async function cached<T>(
  shop: string,
  kind: Kind,
  load: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<{ data: T; fetchedAt: Date; stale: boolean }> {
  const row = await prisma.masterDataCache.findUnique({
    where: { shop_kind: { shop, kind } },
  });

  const fresh =
    row && Date.now() - row.fetchedAt.getTime() < CACHE_TTL_MS && !opts.force;

  if (fresh) {
    try {
      return { data: JSON.parse(row.payload) as T, fetchedAt: row.fetchedAt, stale: false };
    } catch {
      // Corrupt cache entry — fall through and refetch.
    }
  }

  try {
    const data = await load();
    const saved = await prisma.masterDataCache.upsert({
      where: { shop_kind: { shop, kind } },
      create: { shop, kind, payload: JSON.stringify(data) },
      update: { payload: JSON.stringify(data), fetchedAt: new Date() },
    });
    return { data, fetchedAt: saved.fetchedAt, stale: false };
  } catch (err) {
    // Serving stale master data beats an unusable settings screen.
    if (row) {
      try {
        return {
          data: JSON.parse(row.payload) as T,
          fetchedAt: row.fetchedAt,
          stale: true,
        };
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

function records<T>(res: RecordsResponse<T> | T[] | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.records ?? [];
}

/** GET /vatscopes — Steuersachverhalte, the legal tax cases. */
export async function getVatScopes(shop: string, opts: { force?: boolean } = {}) {
  return cached<VatScope[]>(
    shop,
    "vatscopes",
    async () => {
      const client = await ScopevisioClient.forShop(shop);
      const res = await client.get<RecordsResponse<VatScope>>("/vatscopes", {
        active: true,
      });
      return records(res);
    },
    opts,
  );
}

/** GET /vatmatrixentries — the Steuermatrix. Used for the pre-post checksum. */
export async function getVatMatrix(shop: string, opts: { force?: boolean } = {}) {
  return cached<VatMatrixEntry[]>(
    shop,
    "vatmatrix",
    async () => {
      const client = await ScopevisioClient.forShop(shop);
      const res =
        await client.get<RecordsResponse<VatMatrixEntry>>("/vatmatrixentries");
      return records(res);
    },
    opts,
  );
}

/** GET /revenueaccounts/standard — the fallback Erlöskonten. */
export async function getStandardRevenueAccounts(
  shop: string,
  opts: { force?: boolean } = {},
) {
  return cached<RevenueAccount[]>(
    shop,
    "revenueaccounts",
    async () => {
      const client = await ScopevisioClient.forShop(shop);
      const res = await client.get<RecordsResponse<RevenueAccount>>(
        "/revenueaccounts/standard",
      );
      return records(res);
    },
    opts,
  );
}

/**
 * The live resolution call. This is the VAT engine — we pass the destination
 * country, the tax case and the Leistungsdatum, and Scopevisio answers with the
 * Erlöskonto and Steuerschlüssel its own configuration prescribes.
 * See docs/API-FINDINGS.md §5.
 */
export async function resolveRevenueAccounts(
  shop: string,
  args: { country: string; vatScope: number; servicesRenderedDate: Date },
): Promise<RevenueAccount[]> {
  const client = await ScopevisioClient.forShop(shop);

  const query = {
    country: args.country,
    vatScope: args.vatScope,
    servicesRenderedDate: formatGermanDate(args.servicesRenderedDate),
    active: true,
    pageSize: 500,
  };

  /**
   * Both sources are needed. `/revenueaccounts/products` returns only accounts
   * created for a specific product and explicitly EXCLUDES products that use
   * the standard accounts; `/revenueaccounts/standard` returns the rest.
   * Querying products alone missed most of the tenant's accounts (observed:
   * 7 vs 12 for DE, and 12 vs 85 across all tax cases).
   *
   * Product-specific accounts are listed first, so they win when both match —
   * a per-product account is the more specific configuration.
   */
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

  if (productAccounts.length === 0 && standardAccounts.length === 0) {
    // Surface the failure rather than an empty list, so the caller can say why.
    return [];
  }

  return [...productAccounts, ...standardAccounts];
}

/** Scopevisio date parameters use dd.MM.yyyy. */
export function formatGermanDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

export async function refreshAllMasterData(shop: string) {
  const [scopes, matrix, accounts] = await Promise.allSettled([
    getVatScopes(shop, { force: true }),
    getVatMatrix(shop, { force: true }),
    getStandardRevenueAccounts(shop, { force: true }),
  ]);
  return {
    vatScopes: scopes.status === "fulfilled" ? scopes.value.data.length : null,
    vatMatrix: matrix.status === "fulfilled" ? matrix.value.data.length : null,
    revenueAccounts:
      accounts.status === "fulfilled" ? accounts.value.data.length : null,
    errors: [scopes, matrix, accounts]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason?.message ?? r.reason)),
  };
}
