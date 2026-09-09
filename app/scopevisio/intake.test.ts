import { describe, expect, it } from "vitest";

import { buildOrderQuery, mapGraphqlOrder } from "./intake.server";

/**
 * Polling is the intake path that does not depend on Shopify's
 * protected-customer-data grant, and the one that recovers orders missed while
 * Scopevisio was unreachable. The mapper and the query are pure, so they are
 * tested directly; the paging and cursor behaviour is covered by the live e2e.
 */

const NODE = {
  id: "gid://shopify/Order/5678901234",
  name: "#1042",
  number: 1042,
  createdAt: "2026-09-08T08:14:22Z",
  processedAt: "2026-09-08T08:14:30Z",
  email: "kunde@example.de",
  currencyCode: "EUR",
  totalTaxSet: { shopMoney: { amount: "19.00" } },
  paymentGatewayNames: ["paypal"],
  customAttributes: [{ key: "USt-ID", value: " DE811907980 " }],
  customer: {
    id: "gid://shopify/Customer/987",
    firstName: "Anna",
    lastName: "Müller",
    email: "kunde@example.de",
    phone: null,
  },
  billingAddress: { lastName: "Müller", address1: "Rheinweg 12", zip: "53113", city: "Bonn", countryCodeV2: "DE" },
  shippingAddress: { lastName: "Müller", address1: "Rheinweg 12", zip: "53113", city: "Bonn", countryCodeV2: "DE" },
  lineItems: {
    nodes: [
      {
        title: "Kamera-Tasche",
        sku: "OW-100",
        quantity: 2,
        product: { id: "gid://shopify/Product/111" },
        originalUnitPriceSet: { shopMoney: { amount: "50.00" } },
        taxLines: [{ rate: 0.19, priceSet: { shopMoney: { amount: "19.00" } } }],
      },
    ],
  },
};

describe("buildOrderQuery", () => {
  it("filters on paid status, matching the orders/paid trigger", () => {
    const q = buildOrderQuery(new Date("2026-09-01T00:00:00Z"));
    expect(q).toContain("financial_status:paid");
  });

  it("bounds the window with an ISO timestamp", () => {
    const q = buildOrderQuery(new Date("2026-09-01T00:00:00Z"));
    expect(q).toContain("processed_at:>='2026-09-01T00:00:00.000Z'");
  });
});

describe("mapGraphqlOrder", () => {
  it("maps the identity and totals", () => {
    const o = mapGraphqlOrder(NODE);
    expect(o.id).toBe("gid://shopify/Order/5678901234");
    expect(o.name).toBe("#1042");
    expect(o.totalTaxCents).toBe(1900);
    expect(o.currencyCode).toBe("EUR");
  });

  it("maps the customer with its GID, which is the identity key", () => {
    expect(mapGraphqlOrder(NODE).customer?.id).toBe("gid://shopify/Customer/987");
  });

  it("treats a customer without an id as a guest", () => {
    // A customer object with no id must not be mistaken for an account holder,
    // or the legacyNumber lookup would key on undefined.
    const o = mapGraphqlOrder({ ...NODE, customer: { firstName: "X" } });
    expect(o.customer).toBeNull();
  });

  it("treats a null customer as a guest", () => {
    expect(mapGraphqlOrder({ ...NODE, customer: null }).customer).toBeNull();
  });

  it("extracts and trims a VAT ID from custom attributes", () => {
    expect(mapGraphqlOrder(NODE).vatId).toBe("DE811907980");
  });

  it("is null when no VAT attribute is present", () => {
    expect(mapGraphqlOrder({ ...NODE, customAttributes: [] }).vatId).toBeNull();
  });

  it("maps the destination country the tax logic depends on", () => {
    expect(mapGraphqlOrder(NODE).shippingAddress?.countryCodeV2).toBe("DE");
  });

  it("maps positions with per-unit price and summed tax", () => {
    const [line] = mapGraphqlOrder(NODE).lineItems;
    expect(line.title).toBe("Kamera-Tasche");
    expect(line.sku).toBe("OW-100");
    expect(line.quantity).toBe(2);
    expect(line.unitAmount).toBe(50);
    expect(line.taxCents).toBe(1900);
  });

  it("preserves a zero tax total rather than dropping it", () => {
    const o = mapGraphqlOrder({ ...NODE, totalTaxSet: { shopMoney: { amount: "0.00" } } });
    expect(o.totalTaxCents).toBe(0);
  });

  it("leaves the tax total undefined when absent", () => {
    expect(mapGraphqlOrder({ ...NODE, totalTaxSet: null }).totalTaxCents).toBeUndefined();
  });

  it("handles an order with no line items", () => {
    expect(mapGraphqlOrder({ ...NODE, lineItems: { nodes: [] } }).lineItems).toEqual([]);
    expect(mapGraphqlOrder({ ...NODE, lineItems: null }).lineItems).toEqual([]);
  });

  it("falls back to createdAt when processedAt is missing", () => {
    const o = mapGraphqlOrder({ ...NODE, processedAt: null });
    expect(o.processedAt).toBe(NODE.createdAt);
  });

  it("produces the same shape as the webhook mapper for the same order", () => {
    // Both intake paths must be interchangeable, or behaviour would differ by
    // how an order happened to arrive.
    const o = mapGraphqlOrder(NODE);
    expect(Object.keys(o).sort()).toEqual(
      [
        "billingAddress", "createdAt", "currencyCode", "customer", "email", "id",
        "lineItems", "name", "orderNumber", "paymentGatewayNames", "processedAt",
        "shippingAddress", "totalTaxCents", "vatId",
      ].sort(),
    );
  });
});
