import { describe, expect, it } from "vitest";

import {
  classify,
  destinationCountry,
  normaliseVatId,
  pickRevenueAccount,
  taxChecksum,
} from "./tax-rules";
import { buildInvoiceXml, escapeXml } from "./invoices";
import { buildPostings } from "./postings";
import type { OrderLike } from "./types";

/**
 * The VAT classification is the highest-risk logic in the connector: a wrong
 * case produces a wrong UStVA line, and a posted document cannot be unposted.
 * These cases are the ones that actually go wrong in practice.
 */

const DE = "DE";

describe("classify", () => {
  it("treats the home country as domestic", () => {
    expect(
      classify({ destination: "DE", homeCountry: DE, ossRegistered: false, hasValidVatId: false }),
    ).toBe("domestic");
  });

  it("is case-insensitive about country codes", () => {
    expect(
      classify({ destination: "de", homeCountry: "de", ossRegistered: false, hasValidVatId: false }),
    ).toBe("domestic");
  });

  it("charges domestic VAT on EU consumer sales below the threshold", () => {
    expect(
      classify({ destination: "FR", homeCountry: DE, ossRegistered: false, hasValidVatId: false }),
    ).toBe("eu_b2c");
  });

  it("switches EU consumer sales to OSS once registered", () => {
    expect(
      classify({ destination: "FR", homeCountry: DE, ossRegistered: true, hasValidVatId: false }),
    ).toBe("eu_b2c_oss");
  });

  it("applies reverse charge only with a validated VAT ID", () => {
    expect(
      classify({ destination: "FR", homeCountry: DE, ossRegistered: true, hasValidVatId: true }),
    ).toBe("eu_b2b_reverse");
  });

  it("never reverse-charges a domestic sale, even with a VAT ID", () => {
    // A German business buying from a German seller pays German VAT; §13b does
    // not apply to ordinary domestic goods supplies.
    expect(
      classify({ destination: "DE", homeCountry: DE, ossRegistered: true, hasValidVatId: true }),
    ).toBe("domestic");
  });

  it("treats non-EU destinations as third-country exports", () => {
    for (const dest of ["CH", "GB", "US", "NO", "TR"]) {
      expect(
        classify({ destination: dest, homeCountry: DE, ossRegistered: true, hasValidVatId: false }),
      ).toBe("third_country");
    }
  });

  it("does not reverse-charge a third-country buyer with a VAT-ID-shaped string", () => {
    expect(
      classify({ destination: "CH", homeCountry: DE, ossRegistered: true, hasValidVatId: true }),
    ).toBe("third_country");
  });

  it("excludes the UK from the EU set (post-Brexit)", () => {
    expect(
      classify({ destination: "GB", homeCountry: DE, ossRegistered: false, hasValidVatId: true }),
    ).toBe("third_country");
  });

  it("works for a non-German home country", () => {
    expect(
      classify({ destination: "DE", homeCountry: "AT", ossRegistered: true, hasValidVatId: false }),
    ).toBe("eu_b2c_oss");
  });
});

describe("destinationCountry", () => {
  const base: OrderLike = { id: "gid://shopify/Order/1", lineItems: [] };

  it("prefers the shipping address", () => {
    expect(
      destinationCountry(
        {
          ...base,
          shippingAddress: { countryCodeV2: "FR" },
          billingAddress: { countryCodeV2: "DE" },
        },
        DE,
      ),
    ).toBe("FR");
  });

  it("falls back to billing when there is no shipping address", () => {
    expect(
      destinationCountry({ ...base, billingAddress: { countryCodeV2: "IT" } }, DE),
    ).toBe("IT");
  });

  it("falls back to the home country when the order has no address at all", () => {
    expect(destinationCountry(base, DE)).toBe("DE");
  });

  it("ignores an empty-string country code rather than returning it", () => {
    expect(
      destinationCountry({ ...base, shippingAddress: { countryCodeV2: "" } }, DE),
    ).toBe("DE");
  });
});

describe("normaliseVatId", () => {
  it("strips separators and upper-cases", () => {
    expect(normaliseVatId(" de 811 907-980 ")).toBe("DE811907980");
  });

  it("rejects junk that is not VAT-ID shaped", () => {
    for (const junk of ["", "  ", "123456", "D1", null, undefined]) {
      expect(normaliseVatId(junk)).toBeNull();
    }
  });

  it("rejects free text that merely looks VAT-ID shaped once spaces are stripped", () => {
    // Regression: "yes please" -> "YESPLEASE" once separators are removed.
    for (const text of ["yes please", "no idea", "keine angabe", "not a company"]) {
      expect(normaliseVatId(text)).toBeNull();
    }
  });

  it("rejects an unknown country prefix", () => {
    expect(normaliseVatId("ZZ123456789")).toBeNull();
    expect(normaliseVatId("US123456789")).toBeNull();
  });

  it("accepts the two non-ISO prefixes the VAT system actually uses", () => {
    expect(normaliseVatId("EL123456789")).toBe("EL123456789");
    expect(normaliseVatId("XI123456789")).toBe("XI123456789");
  });

  it("accepts a Dutch ID with its B-suffix", () => {
    expect(normaliseVatId("NL123456789B01")).toBe("NL123456789B01");
  });

  it("accepts IDs with letters in the number part", () => {
    expect(normaliseVatId("IE6388047V")).toBe("IE6388047V");
  });
});

describe("taxChecksum", () => {
  it("passes when the amounts agree", () => {
    const result = taxChecksum({
      sourceTaxCents: 1900,
      netCents: 10000,
      expectedRate: 19,
      toleranceCents: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.erpTaxCents).toBe(1900);
  });

  it("tolerates rounding within the configured window", () => {
    expect(
      taxChecksum({
        sourceTaxCents: 1901,
        netCents: 10000,
        expectedRate: 19,
        toleranceCents: 2,
      }).ok,
    ).toBe(true);
  });

  it("fails when Shopify and the matrix genuinely disagree", () => {
    const result = taxChecksum({
      sourceTaxCents: 700,
      netCents: 10000,
      expectedRate: 19,
      toleranceCents: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.erpTaxCents).toBe(1900);
    expect(result.detail).toContain("19%");
  });

  it("does not block when the ERP gave us no rate to compare", () => {
    const result = taxChecksum({
      sourceTaxCents: 1900,
      netCents: 10000,
      expectedRate: undefined,
      toleranceCents: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.erpTaxCents).toBeNull();
  });

  it("agrees on a zero-rated line", () => {
    expect(
      taxChecksum({
        sourceTaxCents: 0,
        netCents: 10000,
        expectedRate: 0,
        toleranceCents: 2,
      }).ok,
    ).toBe(true);
  });

  it("flags tax charged on a line the matrix says is zero-rated", () => {
    // The reverse-charge failure mode: Shopify charged VAT the ERP says is not due.
    expect(
      taxChecksum({
        sourceTaxCents: 1900,
        netCents: 10000,
        expectedRate: 0,
        toleranceCents: 2,
      }).ok,
    ).toBe(false);
  });
});

describe("pickRevenueAccount", () => {
  it("prefers an exact destination-country match (how OSS accounts are found)", () => {
    const accounts = [
      { accountNumber: "8400", countryIso: "DE" },
      { accountNumber: "8315", countryIso: "FR" },
    ];
    expect(pickRevenueAccount(accounts, "FR")?.accountNumber).toBe("8315");
  });

  it("falls back to the first account when no country matches", () => {
    const accounts = [{ accountNumber: "8400", countryIso: "DE" }];
    expect(pickRevenueAccount(accounts, "IT")?.accountNumber).toBe("8400");
  });

  it("returns null rather than guessing when there are no accounts", () => {
    expect(pickRevenueAccount([], "DE")).toBeNull();
  });

  it("handles accounts with no country at all", () => {
    expect(pickRevenueAccount([{ countryIso: null }], "DE")).not.toBeNull();
  });
});

describe("escapeXml", () => {
  it("escapes every XML metacharacter", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });

  it("escapes ampersands before anything else, so entities are not doubled", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

/**
 * These assertions pin the CURRENT element names, which are informed guesses —
 * the import endpoint recognises none of them yet (OQ-10). They exist to catch
 * accidental drift, not to certify the format. Expect to rewrite them once the
 * real import schema is known.
 */
describe("buildInvoiceXml", () => {
  const order: OrderLike = {
    id: "gid://shopify/Order/12345",
    name: "#1001",
    currencyCode: "EUR",
    lineItems: [
      { title: "Kamera-Tasche", sku: "OW-100", quantity: 2, unitAmount: 149.5 },
    ],
  };

  const args = {
    order,
    contactId: 4711,
    personalAccount: "10001",
    treatment: {
      taxCase: "domestic" as const,
      vatScope: 1,
      country: "DE",
      account: "8400",
      vatKey: "3",
    },
    documentDate: new Date(2026, 8, 8),
    externalReference: order.id,
    deriveFromProduct: false,
  };

  it("emits the contact, the German-formatted date and the order reference", () => {
    const xml = buildInvoiceXml(args);
    expect(xml).toContain("<customerContactId>4711</customerContactId>");
    expect(xml).toContain("<documentDate>08.09.2026</documentDate>");
    expect(xml).toContain(
      "<externalReference>gid://shopify/Order/12345</externalReference>",
    );
    expect(xml).toContain("<customerPersonalAccountNumber>10001</customerPersonalAccountNumber>");
  });

  it("writes the account and tax key when the product master is not authoritative", () => {
    const xml = buildInvoiceXml(args);
    expect(xml).toContain("<account>8400</account>");
    expect(xml).toContain("<vatKey>3</vatKey>");
  });

  it("omits the account and tax key when the ERP should derive them", () => {
    const xml = buildInvoiceXml({ ...args, deriveFromProduct: true });
    expect(xml).not.toContain("<account>");
    expect(xml).not.toContain("<vatKey>");
    // The SKU still has to be there, or the ERP cannot find the product.
    expect(xml).toContain("<number>OW-100</number>");
  });

  it("formats amounts with two decimals", () => {
    expect(buildInvoiceXml(args)).toContain("<singleAmount>149.50</singleAmount>");
  });

  it("escapes product titles so a stray ampersand cannot break the document", () => {
    const xml = buildInvoiceXml({
      ...args,
      order: {
        ...order,
        lineItems: [
          { title: `Tasche "M" & Gurt`, sku: "X<1", quantity: 1, unitAmount: 10 },
        ],
      },
    });
    expect(xml).toContain("Tasche &quot;M&quot; &amp; Gurt");
    expect(xml).toContain("<number>X&lt;1</number>");
  });

  it("produces one position element per line item", () => {
    const xml = buildInvoiceXml({
      ...args,
      order: {
        ...order,
        lineItems: [
          { title: "A", quantity: 1, unitAmount: 1 },
          { title: "B", quantity: 2, unitAmount: 2 },
          { title: "C", quantity: 3, unitAmount: 3 },
        ],
      },
    });
    expect(xml.match(/<position>/g)).toHaveLength(3);
  });
});

// --- CSV export ------------------------------------------------------------


describe("buildPostings", () => {
  const draft = {
    externalId: "gid://shopify/Order/1",
    externalRef: "#1001",
    documentDate: "08.09.2026",
    contactId: 101026,
    personalAccount: "10046",
    country: "DE",
    taxCase: "domestic",
    vatScope: 1,
    account: "8400",
    vatKey: "U19",
    currency: "EUR",
    positions: [{ name: "X", number: null, quantity: 1, singleAmount: 100 }],
    sourceTaxCents: 1900,
  };
  const settings = { debitorSummaryAccount: "1400", autoCreateTax: true };

  it("debits the debitor gross and credits revenue net", () => {
    const p = buildPostings({
      draft, documentNumber: "SHOP-1", grossCents: 11900, netCents: 10000, settings,
    });
    expect(p.rows[0].account).toBe("10046");
    expect(p.rows[0].summaryAccount).toBe("1400");
    expect(p.rows[0].amount).toBe(119);
    expect(p.rows[1].account).toBe("8400");
    expect(p.rows[1].amount).toBe(-100);
    expect(p.rows[1].vatKey).toBe("U19");
  });

  it("leaves exactly the VAT amount for autoCreateTax to generate", () => {
    const p = buildPostings({
      draft, documentNumber: "SHOP-1", grossCents: 11900, netCents: 10000, settings,
    });
    const sum = p.rows.reduce((a: number, r: { amount: number }) => a + r.amount, 0);
    expect(Number(sum.toFixed(2))).toBe(19);
  });

  it("puts the Shopify order id on every row for traceability", () => {
    const p = buildPostings({
      draft, documentNumber: "SHOP-1", grossCents: 11900, netCents: 10000, settings,
    });
    for (const r of p.rows) expect(r.externalDocumentNumber).toBe(draft.externalId);
  });

  it("refuses to book without a debitor account", () => {
    expect(() =>
      buildPostings({
        draft: { ...draft, personalAccount: null },
        documentNumber: "SHOP-1", grossCents: 11900, netCents: 10000, settings,
      }),
    ).toThrow(/debitor account/i);
  });

  it("refuses to book without a resolved Erlöskonto", () => {
    expect(() =>
      buildPostings({
        draft: { ...draft, account: null },
        documentNumber: "SHOP-1", grossCents: 11900, netCents: 10000, settings,
      }),
    ).toThrow(/Erlöskonto/);
  });
});
