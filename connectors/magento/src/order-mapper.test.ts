import { describe, expect, it } from "vitest";

import {
  checksumByRate,
  mapInvoice,
  parseMagentoDate,
  storeTag,
  type MagentoInvoice,
  type MagentoOrder,
} from "./order-mapper";

const BASE = "http://localhost:8080/";

/** A configurable hoodie shipped to Austria, prices incl. 19% VAT, flat-rate shipping 5.00 gross. */
function fixture(): { invoice: MagentoInvoice; order: MagentoOrder } {
  const order: MagentoOrder = {
    entity_id: 12,
    increment_id: "000000012",
    created_at: "2026-09-14 09:58:00",
    customer_id: 3,
    customer_is_guest: 0,
    customer_email: "veronica@example.com",
    customer_firstname: "Veronica",
    customer_lastname: "Costello",
    order_currency_code: "EUR",
    billing_address: {
      firstname: "Veronica", lastname: "Costello", street: ["Hauptstraße 1", "Hinterhaus"],
      postcode: "53113", city: "Bonn", country_id: "DE", telephone: "0228 1",
    },
    items: [
      { item_id: 100, product_type: "configurable", sku: "MH01-XS-Black", name: "Chaz Kangeroo Hoodie", tax_percent: 19 },
      { item_id: 101, parent_item_id: 100, product_type: "simple", sku: "MH01-XS-Black", name: "Chaz Kangeroo Hoodie-XS-Black", tax_percent: 19 },
    ],
    payment: { method: "checkmo" },
    extension_attributes: {
      shipping_assignments: [{ shipping: { address: { firstname: "Veronica", lastname: "Costello", street: ["Ring 2"], postcode: "1010", city: "Wien", country_id: "at" } } }],
    },
  };
  const invoice: MagentoInvoice = {
    entity_id: 7,
    increment_id: "000000007",
    order_id: 12,
    state: 2,
    created_at: "2026-09-14 10:00:00",
    order_currency_code: "EUR",
    grand_total: 67,
    tax_amount: 10.7,
    shipping_amount: 4.2,
    shipping_tax_amount: 0.8,
    items: [
      { order_item_id: 100, sku: "MH01-XS-Black", name: "Chaz Kangeroo Hoodie", qty: 1, price: 52.1, row_total: 52.1, row_total_incl_tax: 62, tax_amount: 9.9, discount_amount: 0 },
      { order_item_id: 101, sku: "MH01-XS-Black", name: "Chaz Kangeroo Hoodie-XS-Black", qty: 1, price: 0, row_total: 0, row_total_incl_tax: 0, tax_amount: 0 },
    ],
  };
  return { invoice, order };
}

describe("mapInvoice", () => {
  it("books the configurable parent once and drops the zero-priced child", () => {
    const { invoice, order } = fixture();
    const o = mapInvoice({ invoice, order, storeBaseUrl: BASE });
    const products = o.lineItems.filter((l) => l.title !== "Versand");
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ title: "Chaz Kangeroo Hoodie", sku: "MH01-XS-Black", quantity: 1, unitAmount: 52.1, taxRate: 19, taxCents: 990 });
  });

  it("adds shipping as its own net position with the rate recovered from the amounts", () => {
    const { invoice, order } = fixture();
    const ship = mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems.find((l) => l.title === "Versand");
    expect(ship).toMatchObject({ quantity: 1, unitAmount: 4.2, taxCents: 80, taxRate: 19 });
  });

  it("hands core net amounts, whatever the shop displays", () => {
    const { invoice, order } = fixture();
    expect(mapInvoice({ invoice, order, storeBaseUrl: BASE }).pricesIncludeTax).toBe(false);
  });

  it("takes the destination from the shipping address, upper-cased", () => {
    const { invoice, order } = fixture();
    const o = mapInvoice({ invoice, order, storeBaseUrl: BASE });
    expect(o.shippingAddress?.countryCodeV2).toBe("AT");
    expect(o.billingAddress).toMatchObject({ address1: "Hauptstraße 1", address2: "Hinterhaus", countryCodeV2: "DE" });
  });

  it("keys the document on the invoice and the date on the invoice, in UTC", () => {
    const { invoice, order } = fixture();
    const o = mapInvoice({ invoice, order, storeBaseUrl: BASE });
    expect(o.id).toBe("invoice:7");
    expect(o.name).toBe("000000007");
    expect(o.orderNumber).toBe("000000012");
    expect(o.processedAt).toBe("2026-09-14T10:00:00.000Z");
    expect(o.totalTaxCents).toBe(1070);
    expect(o.paymentGatewayNames).toEqual(["checkmo"]);
  });

  it("namespaces the customer id by store, so two shops' customer 3 never merge", () => {
    const { invoice, order } = fixture();
    const a = mapInvoice({ invoice, order, storeBaseUrl: "http://a.example/" });
    const b = mapInvoice({ invoice, order, storeBaseUrl: "http://b.example/" });
    expect(a.customer?.id).toMatch(/^magento:[0-9a-f]{8}:customer:3$/);
    expect(a.customer?.id).not.toBe(b.customer?.id);
    expect(storeTag("HTTP://A.example/")).toBe(storeTag("http://a.example"));
  });

  it("maps a guest to no customer, keyed on the order so partial invoices share a contact", () => {
    const { invoice, order } = fixture();
    const guest = { ...order, customer_id: null, customer_is_guest: 1 };
    const first = mapInvoice({ invoice, order: guest, storeBaseUrl: BASE });
    const second = mapInvoice({ invoice: { ...invoice, entity_id: 8, increment_id: "000000008" }, order: guest, storeBaseUrl: BASE });
    expect(first.customer).toBeNull();
    expect(first.guestKey).toBe(second.guestKey);
    expect(first.id).not.toBe(second.id);
  });

  it("prefers the billing address VAT ID, then the customer's taxvat", () => {
    const { invoice, order } = fixture();
    expect(mapInvoice({ invoice, order: { ...order, customer_taxvat: "ATU12345678" }, storeBaseUrl: BASE }).vatId).toBe("ATU12345678");
    const withBilling = { ...order, customer_taxvat: "ATU1", billing_address: { ...order.billing_address, vat_id: " DE123456789 " } };
    expect(mapInvoice({ invoice, order: withBilling, storeBaseUrl: BASE }).vatId).toBe("DE123456789");
  });

  it("nets a discount applied to prices including tax (hidden tax compensation)", () => {
    // 119.00 gross, 10% off gross = 11.90; tax on 107.10 = 17.10; net 90.00.
    const { invoice, order } = fixture();
    invoice.items = [{ order_item_id: 100, name: "Jacke", qty: 1, row_total: 100, row_total_incl_tax: 119, tax_amount: 17.1, discount_amount: 11.9, discount_tax_compensation_amount: 1.9 }];
    invoice.shipping_amount = 0;
    order.items = [{ item_id: 100, product_type: "simple", tax_percent: 19 }];
    const [line] = mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems;
    expect(line.unitAmount).toBeCloseTo(90, 6);
  });

  it("nets a discount applied to prices excluding tax", () => {
    // 100.00 net, 10.00 off net, tax on 90 = 17.10, no compensation; net 90.00.
    const { invoice, order } = fixture();
    invoice.items = [{ order_item_id: 100, name: "Jacke", qty: 1, row_total: 100, row_total_incl_tax: 119, tax_amount: 17.1, discount_amount: 10, discount_tax_compensation_amount: 0 }];
    invoice.shipping_amount = 0;
    order.items = [{ item_id: 100, product_type: "simple", tax_percent: 19 }];
    const [line] = mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems;
    expect(line.unitAmount).toBeCloseTo(90, 6);
  });

  it("never leaves a fraction of a cent in a unit price — it splits the row instead", () => {
    const { invoice, order } = fixture();
    invoice.items = [{ order_item_id: 100, name: "Socken", qty: 3, row_total: 25.21, row_total_incl_tax: 30, tax_amount: 4.79 }];
    invoice.shipping_amount = 0;
    order.items = [{ item_id: 100, product_type: "simple", tax_percent: 19 }];
    const lines = mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems;
    expect(lines.map((l) => [l.quantity, l.unitAmount])).toEqual([[2, 8.4], [1, 8.41]]);
    expect(lines.reduce((s, l) => s + Math.round(l.unitAmount * 100) * l.quantity, 0)).toBe(2521);
    expect(lines.reduce((s, l) => s + (l.taxCents ?? 0), 0)).toBe(479);
  });

  it("keeps a row that divides evenly as one position", () => {
    const { invoice, order } = fixture();
    invoice.items = [{ order_item_id: 100, name: "Socken", qty: 2, row_total: 25.2, tax_amount: 4.79 }];
    invoice.shipping_amount = 0;
    order.items = [{ item_id: 100, product_type: "simple", tax_percent: 19 }];
    expect(mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems).toHaveLength(1);
  });

  it("keeps priced bundle children and drops the zero-priced bundle parent", () => {
    const { invoice, order } = fixture();
    order.items = [
      { item_id: 200, product_type: "bundle", name: "Yoga-Set", tax_percent: 19 },
      { item_id: 201, parent_item_id: 200, product_type: "simple", name: "Matte", tax_percent: 19 },
      { item_id: 202, parent_item_id: 200, product_type: "simple", name: "Block", tax_percent: 19 },
    ];
    invoice.items = [
      { order_item_id: 200, name: "Yoga-Set", qty: 1, row_total: 0 },
      { order_item_id: 201, name: "Matte", qty: 1, row_total: 30 },
      { order_item_id: 202, name: "Block", qty: 1, row_total: 10 },
    ];
    invoice.shipping_amount = 0;
    const titles = mapInvoice({ invoice, order, storeBaseUrl: BASE }).lineItems.map((l) => l.title);
    expect(titles).toEqual(["Matte", "Block"]);
  });
});

describe("parseMagentoDate", () => {
  it("reads Magento's zone-less timestamps as UTC", () => {
    expect(parseMagentoDate("2026-01-31 23:30:00")?.toISOString()).toBe("2026-01-31T23:30:00.000Z");
    expect(parseMagentoDate("nonsense")).toBeNull();
    expect(parseMagentoDate(null)).toBeNull();
  });
});

describe("checksumByRate", () => {
  it("passes a consistent invoice", () => {
    const { invoice, order } = fixture();
    expect(checksumByRate(mapInvoice({ invoice, order, storeBaseUrl: BASE }), 2).ok).toBe(true);
  });

  it("holds when a line's tax does not match its rate", () => {
    const { invoice, order } = fixture();
    invoice.items![0].tax_amount = 7.3; // as if 14%
    invoice.tax_amount = 8.1;
    const r = checksumByRate(mapInvoice({ invoice, order, storeBaseUrl: BASE }), 2);
    expect(r.ok).toBe(false);
  });

  it("holds when the invoice total disagrees with its positions", () => {
    const { invoice, order } = fixture();
    invoice.tax_amount = 12.5;
    const r = checksumByRate(mapInvoice({ invoice, order, storeBaseUrl: BASE }), 2);
    expect(r.ok).toBe(false);
  });

  it("tolerates a cent of rounding per line", () => {
    const { invoice, order } = fixture();
    invoice.items![0].tax_amount = 9.91;
    invoice.tax_amount = 10.71;
    expect(checksumByRate(mapInvoice({ invoice, order, storeBaseUrl: BASE }), 0).ok).toBe(true);
  });
});
