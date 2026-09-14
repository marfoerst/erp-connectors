import crypto from "node:crypto";

import type { AddressLike, OrderLike, OrderLineLike } from "@erp/scopevisio-core";

/**
 * Magento invoice + order → the platform-neutral shape core works in.
 *
 * Pure: no network, no database, so everything that can be wrong about a
 * Magento payload is tested against fixtures captured from a real store.
 *
 * Why the invoice and not the order: in Magento "paid" is a property of an
 * invoice, and one order can be invoiced in several parts with different
 * items and amounts. The invoice is the document that corresponds to a
 * Faktura. The order supplies what the invoice lacks — addresses, customer,
 * VAT ID, and the item tree.
 *
 * Amounts are handed to core NET (`pricesIncludeTax: false`), whatever the
 * shop's display setting. Magento stores both, and net is unambiguous:
 *
 *   net row = row_total − discount_amount + discount_tax_compensation_amount
 *
 * holds whether the discount was applied to prices including or excluding
 * tax. The more obvious `row_total_incl_tax − tax_amount − discount_amount`
 * is wrong by the tax on the discount when the discount is applied net.
 */

export interface MagentoAddress {
  firstname?: string | null;
  lastname?: string | null;
  company?: string | null;
  street?: string[] | null;
  postcode?: string | null;
  city?: string | null;
  country_id?: string | null;
  telephone?: string | null;
  vat_id?: string | null;
}

export interface MagentoOrderItem {
  item_id: number;
  parent_item_id?: number | null;
  product_type?: string | null;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  tax_percent?: number | null;
}

export interface MagentoOrder {
  entity_id: number;
  increment_id?: string | null;
  created_at?: string | null;
  customer_id?: number | null;
  customer_is_guest?: number | boolean | null;
  customer_email?: string | null;
  customer_firstname?: string | null;
  customer_lastname?: string | null;
  customer_taxvat?: string | null;
  order_currency_code?: string | null;
  billing_address?: MagentoAddress | null;
  items?: MagentoOrderItem[] | null;
  payment?: { method?: string | null } | null;
  extension_attributes?: {
    shipping_assignments?: Array<{ shipping?: { address?: MagentoAddress | null } | null }> | null;
  } | null;
}

export interface MagentoInvoiceItem {
  entity_id?: number;
  order_item_id: number;
  sku?: string | null;
  name?: string | null;
  qty: number;
  price?: number | null;
  row_total?: number | null;
  row_total_incl_tax?: number | null;
  tax_amount?: number | null;
  discount_amount?: number | null;
  discount_tax_compensation_amount?: number | null;
  product_id?: number | null;
}

export interface MagentoInvoice {
  entity_id: number;
  increment_id?: string | null;
  order_id: number;
  /** 1 open, 2 paid, 3 canceled */
  state?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  order_currency_code?: string | null;
  grand_total?: number | null;
  tax_amount?: number | null;
  shipping_amount?: number | null;
  shipping_tax_amount?: number | null;
  shipping_discount_tax_compensation_amount?: number | null;
  items?: MagentoInvoiceItem[] | null;
}

export interface MagentoCreditMemo {
  entity_id: number;
  increment_id?: string | null;
  order_id: number;
  invoice_id?: number | null;
  created_at?: string | null;
  grand_total?: number | null;
  items?: MagentoInvoiceItem[] | null;
}

export const INVOICE_STATE_PAID = 2;

/** Magento reports UTC as "2026-09-14 10:00:00" with no zone marker. */
export function parseMagentoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value.trim().replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cents(value: number | null | undefined): number {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 0
    : Math.round(value * 100);
}

/**
 * A short, stable tag for the store, so a Magento customer id (a bare
 * integer) cannot collide with another store's customer 5 in one Scopevisio
 * tenant. Derived from the base URL rather than the consumer key, because the
 * key changes when the integration is recreated and the customers do not.
 */
export function storeTag(storeBaseUrl: string): string {
  const normalised = storeBaseUrl.trim().toLowerCase().replace(/\/+$/, "");
  return crypto.createHash("sha256").update(normalised).digest("hex").slice(0, 8);
}

function mapAddress(a: MagentoAddress | null | undefined): AddressLike | null {
  if (!a) return null;
  const street = (a.street ?? []).filter((s) => s && s.trim());
  return {
    firstName: a.firstname ?? null,
    lastName: a.lastname ?? null,
    company: a.company?.trim() || null,
    address1: street[0] ?? null,
    address2: street.slice(1).join(", ") || null,
    zip: a.postcode ?? null,
    city: a.city ?? null,
    countryCodeV2: a.country_id ? a.country_id.toUpperCase() : null,
    phone: a.telephone ?? null,
  };
}

/**
 * Which invoice rows carry the money.
 *
 * A configurable product is invoiced as two rows: the parent with the price and
 * the chosen simple child at zero. A dynamically priced bundle is the reverse —
 * the children carry the prices and the parent is zero. Booking both would
 * either duplicate a position or add a zero line; so children of configurables
 * are dropped, and so are zero-value parents whose children are priced.
 */
function billableItems(invoice: MagentoInvoice, order: MagentoOrder): MagentoInvoiceItem[] {
  const orderItems = new Map((order.items ?? []).map((i) => [i.item_id, i]));
  const items = invoice.items ?? [];
  const invoicedOrderItemIds = new Set(items.map((i) => i.order_item_id));

  return items.filter((item) => {
    const orderItem = orderItems.get(item.order_item_id);
    const parent = orderItem?.parent_item_id ? orderItems.get(orderItem.parent_item_id) : undefined;
    if (parent?.product_type === "configurable") return false;

    const hasPricedChildren = items.some((other) => {
      const oi = orderItems.get(other.order_item_id);
      return (
        oi?.parent_item_id === item.order_item_id &&
        invoicedOrderItemIds.has(other.order_item_id) &&
        cents(other.row_total) !== 0
      );
    });
    if (orderItem?.product_type === "bundle" && hasPricedChildren && cents(item.row_total) === 0) {
      return false;
    }
    return (item.qty ?? 0) > 0;
  });
}

/**
 * One invoice row → one position, or two when the row does not divide into
 * whole cents.
 *
 * Found live: 2 × 37.82 gross-derived net is a row of 75.63, and 75.63 / 2 is
 * 37.815 — which a document can only carry as 37.81 or 37.82, losing or
 * inventing a cent. So the row is split into (qty − r) units at the lower
 * price and r units at one cent more, which adds up exactly.
 */
function mapLines(item: MagentoInvoiceItem, order: MagentoOrder): OrderLineLike[] {
  const orderItem = (order.items ?? []).find((i) => i.item_id === item.order_item_id);
  const netRowCents =
    cents(item.row_total) - cents(item.discount_amount) + cents(item.discount_tax_compensation_amount);
  const qty = item.qty || 1;
  const taxCents = cents(item.tax_amount);
  const base = {
    title: (item.name ?? orderItem?.name ?? "").trim() || "Position",
    sku: item.sku ?? orderItem?.sku ?? null,
    taxRate: orderItem?.tax_percent ?? null,
    productId: item.product_id ? String(item.product_id) : null,
  };

  if (!Number.isInteger(qty) || netRowCents % qty === 0) {
    return [{ ...base, quantity: qty, unitAmount: netRowCents / 100 / qty, taxCents }];
  }
  const unit = Math.floor(netRowCents / qty);
  const remainder = netRowCents - unit * qty;
  const lowerCents = unit * (qty - remainder);
  const lowerTax = netRowCents === 0 ? 0 : Math.round((taxCents * lowerCents) / netRowCents);
  return [
    { ...base, quantity: qty - remainder, unitAmount: unit / 100, taxCents: lowerTax },
    { ...base, quantity: remainder, unitAmount: (unit + 1) / 100, taxCents: taxCents - lowerTax },
  ];
}

/** Shipping is a position of its own — it is revenue and it is taxed. */
function shippingLine(invoice: MagentoInvoice): OrderLineLike | null {
  const net = cents(invoice.shipping_amount);
  if (net === 0) return null;
  const tax = cents(invoice.shipping_tax_amount);
  return {
    title: "Versand",
    sku: null,
    quantity: 1,
    unitAmount: net / 100,
    taxCents: tax,
    // Magento does not store the shipping rate; recover it from the amounts,
    // rounded to the tenth of a percent every real rate is expressed in.
    taxRate: Math.round((tax / net) * 1000) / 10,
    productId: null,
  };
}

export function mapInvoice(args: {
  invoice: MagentoInvoice;
  order: MagentoOrder;
  storeBaseUrl: string;
}): OrderLike {
  const { invoice, order } = args;
  const tag = storeTag(args.storeBaseUrl);

  const billing = mapAddress(order.billing_address);
  const shipping = mapAddress(order.extension_attributes?.shipping_assignments?.[0]?.shipping?.address);

  const isGuest = Boolean(Number(order.customer_is_guest ?? 0)) || !order.customer_id;
  const lines = billableItems(invoice, order).flatMap((i) => mapLines(i, order));
  const ship = shippingLine(invoice);
  if (ship) lines.push(ship);

  const invoiceDate = parseMagentoDate(invoice.created_at) ?? parseMagentoDate(order.created_at);

  return {
    id: `invoice:${invoice.entity_id}`,
    name: invoice.increment_id ?? String(invoice.entity_id),
    orderNumber: order.increment_id ?? undefined,
    createdAt: parseMagentoDate(order.created_at)?.toISOString(),
    // The invoice date is the supply date the tax lookup should use.
    processedAt: invoiceDate?.toISOString(),
    currencyCode: invoice.order_currency_code ?? order.order_currency_code ?? undefined,
    customer: isGuest
      ? null
      : {
          id: `magento:${tag}:customer:${order.customer_id}`,
          firstName: order.customer_firstname ?? billing?.firstName ?? null,
          lastName: order.customer_lastname ?? billing?.lastName ?? null,
          email: order.customer_email ?? null,
        },
    // Partial invoices of one guest order must land on one contact.
    guestKey: `magento:${tag}:order:${order.entity_id}`,
    email: order.customer_email ?? null,
    billingAddress: billing,
    shippingAddress: shipping,
    totalTaxCents: cents(invoice.tax_amount),
    pricesIncludeTax: false,
    lineItems: lines,
    vatId: order.billing_address?.vat_id?.trim() || order.customer_taxvat?.trim() || null,
    paymentGatewayNames: order.payment?.method ? [order.payment.method] : [],
  };
}

/**
 * Pre-post checksum, per tax rate.
 *
 * Magento rounds tax per row or per total depending on configuration, so a
 * cent of drift per line is legitimate; anything more means one side is
 * misconfigured and the invoice must be held, not guessed at.
 */
export function checksumByRate(
  order: OrderLike,
  toleranceCents: number,
): { ok: true; erpTaxCents: number } | { ok: false; erpTaxCents: number; detail: string } {
  const groups = new Map<number, { net: number; tax: number; lines: number }>();
  for (const line of order.lineItems) {
    const rate = line.taxRate ?? 0;
    const g = groups.get(rate) ?? { net: 0, tax: 0, lines: 0 };
    g.net += Math.round(line.unitAmount * line.quantity * 100);
    g.tax += line.taxCents ?? 0;
    g.lines += 1;
    groups.set(rate, g);
  }

  let expectedTotal = 0;
  for (const [rate, g] of groups) {
    const expected = Math.round((g.net * rate) / 100);
    expectedTotal += expected;
    if (Math.abs(expected - g.tax) > toleranceCents + g.lines) {
      return {
        ok: false,
        erpTaxCents: expected,
        detail:
          `Magento calculated ${(g.tax / 100).toFixed(2)} tax at ${rate}% on ` +
          `${(g.net / 100).toFixed(2)} net, which implies ${(expected / 100).toFixed(2)}. ` +
          `The invoice was not booked.`,
      };
    }
  }

  const source = order.totalTaxCents ?? 0;
  const lineTax = [...groups.values()].reduce((s, g) => s + g.tax, 0);
  if (Math.abs(source - lineTax) > toleranceCents + order.lineItems.length) {
    return {
      ok: false,
      erpTaxCents: expectedTotal,
      detail:
        `The invoice's tax total ${(source / 100).toFixed(2)} does not match the sum of its ` +
        `positions ${(lineTax / 100).toFixed(2)}. The invoice was not booked.`,
    };
  }
  return { ok: true, erpTaxCents: expectedTotal };
}
