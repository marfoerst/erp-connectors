import { describe, expect, it } from "vitest";

import { draftsToCsv } from "./csv-export.server";

describe("draftsToCsv", () => {
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
    positions: [
      { name: "Kamera-Tasche", number: "OW-100", quantity: 2, singleAmount: 149.5 },
    ],
    sourceTaxCents: 5681,
  };

  it("writes ids as integers, not money", () => {
    // Regression: toFixed(2) on every number produced "101026,00".
    const csv = draftsToCsv([draft]);
    const row = csv.trim().split("\r\n")[1];
    expect(row.startsWith("101026;10046;")).toBe(true);
    expect(csv).not.toContain("101026,00");
  });

  it("writes money with a comma and two decimals", () => {
    expect(draftsToCsv([draft])).toContain(";149,50;");
  });

  it("keeps an integer quantity integral", () => {
    expect(draftsToCsv([draft])).toContain(";2;149,50;");
  });

  it("carries the resolved Erlöskonto and Steuerschlüssel", () => {
    const csv = draftsToCsv([draft]);
    expect(csv.trim().endsWith(";8400;U19")).toBe(true);
  });

  it("emits one row per position, repeating the document fields", () => {
    const csv = draftsToCsv([
      {
        ...draft,
        positions: [
          { name: "A", number: null, quantity: 1, singleAmount: 1 },
          { name: "B", number: null, quantity: 1, singleAmount: 2 },
        ],
      },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 positions
    expect(lines[1].startsWith("101026;")).toBe(true);
    expect(lines[2].startsWith("101026;")).toBe(true);
  });

  it("quotes a field containing the separator", () => {
    const csv = draftsToCsv([
      {
        ...draft,
        positions: [
          { name: "Tasche; gross", number: null, quantity: 1, singleAmount: 1 },
        ],
      },
    ]);
    expect(csv).toContain('"Tasche; gross"');
  });

  it("starts with a BOM so Excel reads UTF-8", () => {
    expect(draftsToCsv([draft]).charCodeAt(0)).toBe(0xfeff);
  });

  it("still produces a header when there is nothing to export", () => {
    const csv = draftsToCsv([]);
    expect(csv).toContain("customerContactId;");
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });
});
