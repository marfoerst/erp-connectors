import { describe, expect, it } from "vitest";

import { draftsToCsv } from "./csv";
import { buildInvoiceDraft } from "./draft";
import type { InvoiceDraft } from "./types";

const draft: InvoiceDraft = {
  externalId: "magento:invoice:7",
  externalRef: "000000007",
  documentDate: "14.09.2026",
  contactId: 101026,
  personalAccount: "10046",
  country: "DE",
  taxCase: "domestic",
  vatScope: 1,
  account: "8400",
  vatKey: "U19",
  currency: "EUR",
  positions: [{ name: "Kamera-Tasche", number: "OW-100", quantity: 2, singleAmount: 149.5 }],
  sourceTaxCents: 5681,
};

describe("draftsToCsv", () => {
  it("labels the reference with the source system", () => {
    expect(draftsToCsv([draft], { sourceLabel: "Magento" })).toContain(";Magento 000000007;");
  });

  it("writes ids as integers and money with a comma", () => {
    const row = draftsToCsv([draft], { sourceLabel: "X" }).trim().split("\r\n")[1];
    expect(row.startsWith("101026;10046;")).toBe(true);
    expect(row).toContain(";2;149,50;8400;U19");
  });

  it("writes a fractional quantity with a comma", () => {
    const csv = draftsToCsv(
      [{ ...draft, positions: [{ name: "Stoff", number: null, quantity: 1.5, singleAmount: 10 }] }],
      { sourceLabel: "X" },
    );
    expect(csv).toContain(";1,5;10,00;");
  });

  it("starts with a BOM and still has a header when empty", () => {
    const csv = draftsToCsv([], { sourceLabel: "X" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });
});

describe("buildInvoiceDraft", () => {
  it("carries the resolved treatment and one position per line", () => {
    const d = buildInvoiceDraft({
      order: {
        id: "magento:invoice:7",
        name: "000000007",
        currencyCode: "EUR",
        totalTaxCents: 380,
        lineItems: [
          { title: "Shirt", sku: "MS-1", quantity: 1, unitAmount: 20 },
          { title: "Versand", quantity: 1, unitAmount: 0 },
        ],
      },
      treatment: { taxCase: "domestic", vatScope: 1, country: "DE", account: "8400", vatKey: "U19" },
      documentDate: new Date(2026, 8, 14),
      contactId: 5,
      personalAccount: "10001",
    });
    expect(d.documentDate).toBe("14.09.2026");
    expect(d.account).toBe("8400");
    expect(d.positions).toHaveLength(2);
    expect(d.positions[1].number).toBeNull();
    expect(d.sourceTaxCents).toBe(380);
  });
});
