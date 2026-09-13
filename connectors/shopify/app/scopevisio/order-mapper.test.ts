import { describe, expect, it } from "vitest";

import {
  mapOrder,
  mapRefund,
  type ShopifyOrderPayload,
} from "./order-mapper.server";

/**
 * These mappers have never run in production — the order webhooks are disabled
 * pending Shopify's protected-customer-data grant. So they get tested against
 * realistic payload shapes instead, including the shapes that differ from the
 * happy path: guest checkouts, missing addresses, gross-inclusive tax, and the
 * several places a merchant might put a VAT ID.
 */

/** A realistic `orders/paid` payload, trimmed to the fields we consume. */
const PAID: ShopifyOrderPayload = {
  id: 5678901234,
  admin_graphql_api_id: "gid://shopify/Order/5678901234",
  name: "#1042",
  order_number: 1042,
  created_at: "2026-09-08T10:14:22+02:00",
  processed_at: "2026-09-08T10:14:30+02:00",
  currency: "EUR",
  email: "kunde@example.de",
  total_tax: "19.00",
  customer: {
    id: 987654321,
    admin_graphql_api_id: "gid://shopify/Customer/987654321",
    first_name: "Anna",
    last_name: "Müller",
    email: "kunde@example.de",
    phone: "+4922812345",
  },
  billing_address: {
    first_name: "Anna",
    last_name: "Müller",
    company: null,
    address1: "Rheinweg 12",
    address2: "Hinterhaus",
    zip: "53113",
    city: "Bonn",
    country_code: "DE",
    phone: "+4922812345",
  },
  shipping_address: {
    first_name: "Anna",
    last_name: "Müller",
    address1: "Rheinweg 12",
    zip: "53113",
    city: "Bonn",
    country_code: "DE",
  },
  line_items: [
    {
      title: "Kamera-Tasche",
      sku: "OW-100",
      quantity: 2,
      price: "50.00",
      product_id: 111,
      tax_lines: [{ price: "19.00", rate: 0.19 }],
    },
  ],
  payment_gateway_names: ["paypal"],
  note_attributes: [],
};

describe("mapOrder", () => {
  it("prefers the GraphQL id and falls back to composing one", () => {
    expect(mapOrder(PAID).id).toBe("gid://shopify/Order/5678901234");
    const { admin_graphql_api_id: _omitted, ...withoutGid } = PAID;
    expect(mapOrder(withoutGid).id).toBe("gid://shopify/Order/5678901234");
  });

  it("maps the customer with a GID", () => {
    const o = mapOrder(PAID);
    expect(o.customer?.id).toBe("gid://shopify/Customer/987654321");
    expect(o.customer?.lastName).toBe("Müller");
  });

  it("treats a guest checkout as having no customer", () => {
    const o = mapOrder({ ...PAID, customer: null });
    expect(o.customer).toBeNull();
    // The e-mail must survive, or the contact has no address at all.
    expect(o.email).toBe("kunde@example.de");
  });

  it("converts the tax total to integer cents", () => {
    expect(mapOrder(PAID).totalTaxCents).toBe(1900);
  });

  it("leaves the tax total undefined when Shopify omits it", () => {
    const { total_tax: _omitted, ...noTax } = PAID;
    expect(mapOrder(noTax).totalTaxCents).toBeUndefined();
  });

  it("does not turn a zero tax total into undefined", () => {
    // 0.00 is meaningful — a zero-rated order — and must not read as "unknown".
    expect(mapOrder({ ...PAID, total_tax: "0.00" }).totalTaxCents).toBe(0);
  });

  it("maps country codes into the field the tax logic reads", () => {
    const o = mapOrder(PAID);
    expect(o.shippingAddress?.countryCodeV2).toBe("DE");
    expect(o.billingAddress?.countryCodeV2).toBe("DE");
  });

  it("survives an order with no addresses at all", () => {
    const o = mapOrder({ ...PAID, billing_address: null, shipping_address: null });
    expect(o.billingAddress).toBeNull();
    expect(o.shippingAddress).toBeNull();
  });

  it("maps line items with per-unit price and summed tax", () => {
    const [line] = mapOrder(PAID).lineItems;
    expect(line.title).toBe("Kamera-Tasche");
    expect(line.sku).toBe("OW-100");
    expect(line.quantity).toBe(2);
    expect(line.unitAmount).toBe(50);
    expect(line.taxCents).toBe(1900);
    expect(line.taxRate).toBe(0.19);
  });

  it("sums multiple tax lines on one item", () => {
    const o = mapOrder({
      ...PAID,
      line_items: [
        {
          title: "X",
          quantity: 1,
          price: "100.00",
          tax_lines: [{ price: "7.00" }, { price: "2.50" }],
        },
      ],
    });
    expect(o.lineItems[0].taxCents).toBe(950);
  });

  it("falls back to `name` when a line item has no title", () => {
    const o = mapOrder({
      ...PAID,
      line_items: [{ name: "Fallback-Titel", quantity: 1, price: "1.00" }],
    });
    expect(o.lineItems[0].title).toBe("Fallback-Titel");
  });

  it("never produces an empty position title", () => {
    const o = mapOrder({ ...PAID, line_items: [{ quantity: 1, price: "1.00" }] });
    expect(o.lineItems[0].title.length).toBeGreaterThan(0);
  });

  it("handles an order with no line items", () => {
    expect(mapOrder({ ...PAID, line_items: [] }).lineItems).toEqual([]);
    const { line_items: _omitted, ...noItems } = PAID;
    expect(mapOrder(noItems).lineItems).toEqual([]);
  });

  it("defaults the currency to EUR", () => {
    const { currency: _omitted, ...noCurrency } = PAID;
    expect(mapOrder(noCurrency).currencyCode).toBe("EUR");
  });

  it("falls back to created_at when processed_at is absent", () => {
    const { processed_at: _omitted, ...noProcessed } = PAID;
    expect(mapOrder(noProcessed).processedAt).toBe(PAID.created_at);
  });
});

describe("mapOrder — VAT ID extraction", () => {
  const withAttr = (name: string, value: string) =>
    mapOrder({ ...PAID, note_attributes: [{ name, value }] });

  it("finds a VAT ID under the names merchants actually use", () => {
    for (const key of ["vat_id", "VAT", "USt-ID", "ustidnr", "vat_number", "tax_id"]) {
      expect(withAttr(key, "DE811907980").vatId).toBe("DE811907980");
    }
  });

  it("tolerates spaces in the attribute name", () => {
    expect(withAttr("vat id", "DE811907980").vatId).toBe("DE811907980");
  });

  it("trims the value", () => {
    expect(withAttr("vat_id", "  DE811907980 ").vatId).toBe("DE811907980");
  });

  it("ignores unrelated note attributes", () => {
    expect(withAttr("gift_message", "Happy birthday").vatId).toBeNull();
  });

  it("is null when there are no attributes", () => {
    expect(mapOrder(PAID).vatId).toBeNull();
  });
});

describe("mapRefund", () => {
  const REFUND = {
    id: 777,
    admin_graphql_api_id: "gid://shopify/Refund/777",
    order_id: 5678901234,
    created_at: "2026-09-10T09:00:00+02:00",
    note: "Zurückgesendet",
    refund_line_items: [
      {
        quantity: 1,
        subtotal: "50.00",
        line_item: { title: "Kamera-Tasche", sku: "OW-100", price: "50.00", product_id: 111 },
      },
    ],
  };

  it("links the refund to its order", () => {
    const r = mapRefund(REFUND);
    expect(r.orderGid).toBe("gid://shopify/Order/5678901234");
    expect(r.refundGid).toBe("gid://shopify/Refund/777");
  });

  it("maps the refunded positions", () => {
    const [line] = mapRefund(REFUND).lines;
    expect(line.title).toBe("Kamera-Tasche");
    expect(line.sku).toBe("OW-100");
    expect(line.quantity).toBe(1);
    expect(line.unitAmount).toBe(50);
  });

  it("yields an empty order reference when order_id is missing", () => {
    // syncRefund checks for this and holds rather than crediting blindly.
    const { order_id: _omitted, ...noOrder } = REFUND;
    expect(mapRefund(noOrder).orderGid).toBe("");
  });

  it("handles a refund with no line items", () => {
    expect(mapRefund({ ...REFUND, refund_line_items: [] }).lines).toEqual([]);
  });

  it("falls back to the subtotal when the line item has no price", () => {
    const r = mapRefund({
      ...REFUND,
      refund_line_items: [{ quantity: 1, subtotal: "12.34", line_item: { title: "X" } }],
    });
    expect(r.lines[0].unitAmount).toBe(12.34);
  });

  it("keeps the note for the journal", () => {
    expect(mapRefund(REFUND).note).toBe("Zurückgesendet");
  });
});
