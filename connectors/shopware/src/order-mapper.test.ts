import { describe, expect, it } from "vitest";

import { extractVatId, isGuestOrder, mapOrder, type ShopwareOrder } from "./order-mapper";

const ORDER: ShopwareOrder = {
  id: "0191f0c2d9a4",
  orderNumber: "10024",
  orderDateTime: "2026-09-13T08:15:00.000+00:00",
  currency: { isoCode: "EUR" },
  price: {
    taxStatus: "net",
    calculatedTaxes: [{ tax: 56.81, taxRate: 19 }],
  },
  orderCustomer: {
    customerId: "cust-9001",
    firstName: "Anja",
    lastName: "Bergmann",
    email: "anja@example.de",
    vatIds: ["DE811907980"],
  },
  billingAddress: {
    firstName: "Anja",
    lastName: "Bergmann",
    company: "Bergmann Optik GmbH",
    street: "Hauptstraße 12",
    additionalAddressLine1: "Hinterhaus",
    zipcode: "53111",
    city: "Bonn",
    phoneNumber: "+49 228 1234",
    country: { iso: "de" },
  },
  deliveries: [
    {
      shippingOrderAddress: {
        firstName: "Anja",
        lastName: "Bergmann",
        street: "Lagerweg 3",
        zipcode: "53113",
        city: "Bonn",
        country: { iso: "DE" },
      },
    },
  ],
  lineItems: [
    {
      label: "Kamera-Tasche",
      quantity: 2,
      productId: "prod-1",
      payload: { productNumber: "OW-100" },
      price: {
        unitPrice: 149.5,
        taxRules: [{ taxRate: 19 }],
        calculatedTaxes: [{ tax: 56.81, taxRate: 19 }],
      },
    },
  ],
  transactions: [{ paymentMethod: { name: "Rechnung" } }],
};

describe("mapOrder", () => {
  it("carries the Shopware order id through as the natural key", () => {
    expect(mapOrder(ORDER).id).toBe("0191f0c2d9a4");
  });

  it("uses the order number as the human-readable reference", () => {
    const o = mapOrder(ORDER);
    expect(o.name).toBe("10024");
    expect(o.orderNumber).toBe("10024");
  });

  it("converts tax totals to minor units, because the ledger works in cents", () => {
    expect(mapOrder(ORDER).totalTaxCents).toBe(5681);
  });

  it("sums tax across several rates rather than taking the first", () => {
    const mixed = {
      ...ORDER,
      price: {
        taxStatus: "net",
        calculatedTaxes: [
          { tax: 10.0, taxRate: 19 },
          { tax: 2.5, taxRate: 7 },
        ],
      },
    };
    expect(mapOrder(mixed).totalTaxCents).toBe(1250);
  });

  it("uppercases the country code, since Shopware may send it lowercase", () => {
    expect(mapOrder(ORDER).billingAddress?.countryCodeV2).toBe("DE");
  });

  it("maps the shipping address from the first delivery", () => {
    expect(mapOrder(ORDER).shippingAddress?.address1).toBe("Lagerweg 3");
  });

  it("maps street and the additional line onto the two address slots", () => {
    const a = mapOrder(ORDER).billingAddress;
    expect(a?.address1).toBe("Hauptstraße 12");
    expect(a?.address2).toBe("Hinterhaus");
  });

  it("keeps the company, because it decides Person vs Gesellschaft", () => {
    expect(mapOrder(ORDER).billingAddress?.company).toBe("Bergmann Optik GmbH");
  });

  it("passes the unit price through without converting gross to net", () => {
    expect(mapOrder(ORDER).lineItems[0].unitAmount).toBe(149.5);
  });

  it("takes the product number as the SKU for master-data mapping", () => {
    expect(mapOrder(ORDER).lineItems[0].sku).toBe("OW-100");
  });

  it("prefers the applied tax rate over the configured rule", () => {
    const li = {
      ...ORDER,
      lineItems: [
        {
          label: "X",
          quantity: 1,
          price: {
            unitPrice: 10,
            taxRules: [{ taxRate: 19 }],
            calculatedTaxes: [{ tax: 0.7, taxRate: 7 }],
          },
        },
      ],
    };
    expect(mapOrder(li).lineItems[0].taxRate).toBe(7);
  });

  it("falls back to the configured rule when nothing was calculated", () => {
    const li = {
      ...ORDER,
      lineItems: [
        { label: "X", quantity: 1, price: { unitPrice: 10, taxRules: [{ taxRate: 19 }] } },
      ],
    };
    expect(mapOrder(li).lineItems[0].taxRate).toBe(19);
  });

  it("names an unlabelled line rather than sending an empty title", () => {
    const li = { ...ORDER, lineItems: [{ label: "  ", quantity: 1, price: { unitPrice: 1 } }] };
    expect(mapOrder(li).lineItems[0].title).toBe("Position");
  });

  it("defaults a missing quantity to one instead of zero", () => {
    const li = { ...ORDER, lineItems: [{ label: "X", price: { unitPrice: 1 } }] };
    expect(mapOrder(li).lineItems[0].quantity).toBe(1);
  });

  it("collects payment method names for the contact's payment type", () => {
    expect(mapOrder(ORDER).paymentGatewayNames).toEqual(["Rechnung"]);
  });

  it("survives an order with no line items at all", () => {
    const empty = { ...ORDER, lineItems: [] };
    expect(mapOrder(empty).lineItems).toEqual([]);
  });

  it("survives an order with no addresses, leaving them null", () => {
    const bare: ShopwareOrder = { id: "x" };
    const o = mapOrder(bare);
    expect(o.billingAddress).toBeNull();
    expect(o.shippingAddress).toBeNull();
    expect(o.totalTaxCents).toBe(0);
  });

  it("rounds half-cent amounts rather than truncating them", () => {
    const o = { ...ORDER, price: { calculatedTaxes: [{ tax: 0.005, taxRate: 19 }] } };
    expect(mapOrder(o).totalTaxCents).toBe(1);
  });
});

describe("extractVatId", () => {
  it("takes the first non-empty VAT ID", () => {
    expect(extractVatId(ORDER)).toBe("DE811907980");
  });

  it("trims surrounding whitespace", () => {
    const o = { ...ORDER, orderCustomer: { ...ORDER.orderCustomer, vatIds: ["  DE811907980 "] } };
    expect(extractVatId(o)).toBe("DE811907980");
  });

  it("skips blank entries instead of returning an empty string", () => {
    const o = { ...ORDER, orderCustomer: { ...ORDER.orderCustomer, vatIds: ["", "  ", "DE1"] } };
    expect(extractVatId(o)).toBe("DE1");
  });

  it("is null when the customer has none", () => {
    const o = { ...ORDER, orderCustomer: { ...ORDER.orderCustomer, vatIds: [] } };
    expect(extractVatId(o)).toBeNull();
  });

  it("is null when the field is absent entirely", () => {
    expect(extractVatId({ id: "x" })).toBeNull();
  });
});

describe("isGuestOrder", () => {
  it("is false when the order has a customer account behind it", () => {
    expect(isGuestOrder(ORDER)).toBe(false);
  });

  it("is true when there is no customerId to key a contact on", () => {
    const guest = { ...ORDER, orderCustomer: { ...ORDER.orderCustomer, customerId: null } };
    expect(isGuestOrder(guest)).toBe(true);
  });

  it("is true when there is no customer snapshot at all", () => {
    expect(isGuestOrder({ id: "x" })).toBe(true);
  });
});
