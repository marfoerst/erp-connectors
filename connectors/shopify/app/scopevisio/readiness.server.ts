import prisma from "../db.server";
import { EU_COUNTRIES, TAX_CASE_LABEL } from "@erp/scopevisio-core";
import { getVatScopes, resolveRevenueAccounts } from "./masterdata.server";
import type { TaxCase } from "@erp/scopevisio-core";

/**
 * Master-data readiness.
 *
 * The connector's correctness depends on the tenant's own Steuermatrix, and a
 * gap there does not show up until an order hits it. That turns a
 * configuration problem into a stream of held orders, which is exactly the
 * failure PRD R-005 warns about: "validate master data at setup and tell the
 * merchant what is missing before they enable sync, rather than discovering it
 * order by order."
 *
 * So this probes each configured tax case against the destinations the shop
 * actually sells to and reports what will work — before sync is switched on.
 */

/** Destinations to probe when the shop has no order history to learn from. */
const DEFAULT_EU_PROBE = ["AT", "FR", "NL"];
const DEFAULT_THIRD_PROBE = ["CH", "GB", "US"];

export interface ReadinessRow {
  taxCase: TaxCase;
  label: string;
  /** Steuersachverhalt configured for this case, if any. */
  vatScope: number | null;
  scopeName: string | null;
  /** Per-destination outcome. */
  destinations: Array<{
    country: string;
    ok: boolean;
    account?: string;
    vatKey?: string;
    problem?: string;
  }>;
  /** True when every probed destination resolves. */
  ok: boolean;
  /** What the merchant should do, in their language. */
  advice?: string;
}

export interface ReadinessReport {
  rows: ReadinessRow[];
  /** Cases that will book cleanly right now. */
  readyCount: number;
  /** Cases that will hold every matching order. */
  blockedCount: number;
  /** Countries taken from real orders rather than the default probe set. */
  learnedFrom: "orders" | "defaults";
  checkedAt: string;
}

/**
 * Which destinations to probe. Countries seen in real orders beat a guess, so
 * the report reflects what this shop actually sells rather than a generic list.
 */
async function probeCountries(
  shop: string,
  homeCountry: string,
): Promise<{ eu: string[]; third: string[]; source: "orders" | "defaults" }> {
  const seen = await prisma.orderSync.findMany({
    where: { shop, countryUsed: { not: null } },
    select: { countryUsed: true },
    distinct: ["countryUsed"],
    take: 40,
  });

  const countries = seen
    .map((r) => (r.countryUsed ?? "").toUpperCase())
    .filter((c) => c && c !== homeCountry.toUpperCase());

  const eu = countries.filter((c) => EU_COUNTRIES.has(c));
  const third = countries.filter((c) => !EU_COUNTRIES.has(c));

  if (eu.length === 0 && third.length === 0) {
    return { eu: DEFAULT_EU_PROBE, third: DEFAULT_THIRD_PROBE, source: "defaults" };
  }
  return {
    eu: eu.length ? eu : DEFAULT_EU_PROBE,
    third: third.length ? third : DEFAULT_THIRD_PROBE,
    source: "orders",
  };
}

const SCOPE_FIELD: Record<TaxCase, string> = {
  domestic: "vatScopeDomestic",
  eu_b2c: "vatScopeEuB2c",
  eu_b2c_oss: "vatScopeEuB2cOss",
  eu_b2b_reverse: "vatScopeEuB2bReverse",
  third_country: "vatScopeThirdCountry",
};

export async function checkReadiness(shop: string): Promise<ReadinessReport> {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });
  if (!settings) {
    return {
      rows: [],
      readyCount: 0,
      blockedCount: 0,
      learnedFrom: "defaults",
      checkedAt: new Date().toISOString(),
    };
  }

  const home = (settings.homeCountry || "DE").toUpperCase();
  const { eu, third, source } = await probeCountries(shop, home);

  let scopeNames = new Map<number, string>();
  try {
    const scopes = await getVatScopes(shop);
    scopeNames = new Map(scopes.data.map((s) => [s.caseId, s.caseName]));
  } catch {
    // A readiness check must still run without the scope catalogue.
  }

  // Only probe the cases that can actually occur for this merchant.
  const applicable: Array<{ taxCase: TaxCase; countries: string[] }> = [
    { taxCase: "domestic", countries: [home] },
    settings.ossRegistered
      ? { taxCase: "eu_b2c_oss", countries: eu }
      : { taxCase: "eu_b2c", countries: eu },
    { taxCase: "eu_b2b_reverse", countries: eu },
    { taxCase: "third_country", countries: third },
  ];

  const today = new Date();
  const rows: ReadinessRow[] = [];

  for (const { taxCase, countries } of applicable) {
    const vatScope = settings[
      SCOPE_FIELD[taxCase] as keyof typeof settings
    ] as number | null;

    if (!vatScope) {
      rows.push({
        taxCase,
        label: TAX_CASE_LABEL[taxCase],
        vatScope: null,
        scopeName: null,
        destinations: countries.map((country) => ({
          country,
          ok: false,
          problem: "no tax case selected",
        })),
        ok: false,
        advice:
          `Choose a Steuersachverhalt for "${TAX_CASE_LABEL[taxCase]}" above. ` +
          `Until then every matching order is held rather than booked.`,
      });
      continue;
    }

    const destinations: ReadinessRow["destinations"] = [];
    for (const country of countries) {
      try {
        const accounts = await resolveRevenueAccounts(shop, {
          country,
          vatScope,
          servicesRenderedDate: today,
        });
        const exact =
          accounts.find(
            (a) => (a.countryIso ?? "").toUpperCase() === country,
          ) ?? accounts[0];

        if (!exact) {
          destinations.push({
            country,
            ok: false,
            problem: "no active Erlöskonto",
          });
        } else {
          destinations.push({
            country,
            ok: true,
            account: exact.accountNumber,
            vatKey: exact.vatKey,
          });
        }
      } catch (err) {
        destinations.push({
          country,
          ok: false,
          problem: err instanceof Error ? err.message.slice(0, 120) : "lookup failed",
        });
      }
    }

    const failing = destinations.filter((d) => !d.ok).map((d) => d.country);
    rows.push({
      taxCase,
      label: TAX_CASE_LABEL[taxCase],
      vatScope,
      scopeName: scopeNames.get(vatScope) ?? null,
      destinations,
      ok: failing.length === 0,
      advice: failing.length
        ? `Your Steuermatrix has no active Erlöskonto for "${
            scopeNames.get(vatScope) ?? `case ${vatScope}`
          }" and ${failing.join(", ")}. Add one in Scopevisio, or orders to ${
            failing.length === 1 ? "that country" : "those countries"
          } will be held.`
        : undefined,
    });
  }

  return {
    rows,
    readyCount: rows.filter((r) => r.ok).length,
    blockedCount: rows.filter((r) => !r.ok).length,
    learnedFrom: source,
    checkedAt: new Date().toISOString(),
  };
}
