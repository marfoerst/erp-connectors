import { describe, expect, it } from "vitest";

import invoiceConfigurable from "./__fixtures__/invoice-configurable.json";
import invoicePartial from "./__fixtures__/invoice-partial.json";
import orderConfigurable from "./__fixtures__/order-configurable.json";
import orderPartialGuest from "./__fixtures__/order-partial-guest.json";
import { checksumByRate, mapInvoice, type MagentoInvoice, type MagentoOrder } from "./order-mapper";

/**
 * Payloads captured from a real Magento 2.4.9 by `CAPTURE_FIXTURES=1 npm run e2e`,
 * not written from documentation — the Shopware connector's first live order
 * disproved three assumptions its hand-written fixtures shared with its code.
 *
 * What these ones taught: the configurable child arrives with `row_total: null`
 * (not 0) and `price: 0`; item `discount_amount` is null, not 0; and Magento's
 * shipping tax is rounded on the gross figure, a cent away from net × rate.
 */

const BASE = "http://localhost:8080/";

describe("real Magento payloads", () => {
  it("maps a customer's configurable + simple invoice to net positions that add up to the cent", () => {
    const o = mapInvoice({
      invoice: invoiceConfigurable as unknown as MagentoInvoice,
      order: orderConfigurable as unknown as MagentoOrder,
      storeBaseUrl: BASE,
    });
    expect(o.customer?.id).toMatch(/^magento:[0-9a-f]{8}:customer:1$/);
    // 2 bags at 75.63 net cannot be 2 × one price in cents: 37.81 + 37.82.
    expect(o.lineItems.map((l) => [l.sku, l.quantity, Math.round(l.unitAmount * 100)])).toEqual([
      ["MH01-XS-Black", 1, 4370],
      ["24-WB04", 1, 3781],
      ["24-WB04", 1, 3782],
      [null, 1, 1260],
    ]);
    expect(o.totalTaxCents).toBe(2507);
    expect(o.shippingAddress?.countryCodeV2).toBe("DE");
  });

  it("passes the tax checksum despite Magento's one-cent shipping rounding", () => {
    const o = mapInvoice({
      invoice: invoiceConfigurable as unknown as MagentoInvoice,
      order: orderConfigurable as unknown as MagentoOrder,
      storeBaseUrl: BASE,
    });
    const shipping = o.lineItems.find((l) => l.title === "Versand")!;
    expect(shipping.taxCents).toBe(240); // 12.60 × 19% is 2.394
    expect(checksumByRate(o, 0).ok).toBe(true);
  });

  it("maps a guest's partial invoice to no customer, keyed on the order", () => {
    const order = orderPartialGuest as unknown as MagentoOrder;
    const invoice = invoicePartial as unknown as MagentoInvoice;
    const o = mapInvoice({ invoice, order, storeBaseUrl: BASE });
    expect(o.customer).toBeNull();
    expect(o.guestKey).toMatch(new RegExp(`:order:${order.entity_id}$`));
    // Two bags whose row does not divide into cents: one SKU, two positions.
    expect([...new Set(o.lineItems.filter((l) => l.title !== "Versand").map((l) => l.sku))]).toEqual(["24-WB04"]);
    expect(checksumByRate(o, 0).ok).toBe(true);
  });
});
