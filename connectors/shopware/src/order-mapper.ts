import type { AddressLike, OrderLike, OrderLineLike } from "@erp/scopevisio-core";

/**
 * Shopware order → the platform-neutral shape core works in.
 *
 * Pure: no network, no database. Everything that could be wrong about a
 * Shopware order can therefore be tested against a fixture rather than against
 * a live shop.
 *
 * Two Shopware specifics matter and neither is obvious:
 *
 *   - `price.taxStatus` says whether line prices are `gross`, `net` or
 *     `tax-free`. Core's `unitAmount` follows the shop's setting, exactly as it
 *     does for Shopify, so the value is passed through rather than converted.
 *   - Tax totals live in `price.calculatedTaxes[]`, one entry per rate. The sum
 *     is a checksum only — never an input to the tax decision, because a 0%
 *     line is ambiguous across four Steuersachverhalte.
 */

export interface ShopwareAddress {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  street?: string | null;
  additionalAddressLine1?: string | null;
  zipcode?: string | null;
  city?: string | null;
  phoneNumber?: string | null;
  country?: { iso?: string | null; iso3?: string | null } | null;
}

export interface ShopwareOrder {
  id: string;
  orderNumber?: string | null;
  orderDateTime?: string | null;
  currency?: { isoCode?: string | null } | null;
  price?: {
    taxStatus?: string | null;
    calculatedTaxes?: Array<{ tax?: number | null; taxRate?: number | null }> | null;
  } | null;
  orderCustomer?: {
    customerId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    company?: string | null;
    vatIds?: string[] | null;
  } | null;
  billingAddress?: ShopwareAddress | null;
  deliveries?: Array<{ shippingOrderAddress?: ShopwareAddress | null }> | null;
  lineItems?: Array<{
    id?: string | null;
    label?: string | null;
    quantity?: number | null;
    productId?: string | null;
    payload?: { productNumber?: string | null } | null;
    price?: {
      unitPrice?: number | null;
      taxRules?: Array<{ taxRate?: number | null }> | null;
      calculatedTaxes?: Array<{ tax?: number | null; taxRate?: number | null }> | null;
    } | null;
  }> | null;
  transactions?: Array<{ paymentMethod?: { name?: string | null } | null }> | null;
}

/** Euro amounts arrive as floats; the ledger works in minor units. */
function toCents(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function mapAddress(a: ShopwareAddress | null | undefined): AddressLike | null {
  if (!a) return null;
  return {
    firstName: a.firstName ?? null,
    lastName: a.lastName ?? null,
    company: a.company ?? null,
    address1: a.street ?? null,
    address2: a.additionalAddressLine1 ?? null,
    zip: a.zipcode ?? null,
    city: a.city ?? null,
    countryCodeV2: a.country?.iso ? a.country.iso.toUpperCase() : null,
    phone: a.phoneNumber ?? null,
  };
}

function mapLineItem(li: NonNullable<ShopwareOrder["lineItems"]>[number]): OrderLineLike {
  const taxes = li.price?.calculatedTaxes ?? [];
  const taxCents = taxes.reduce((sum, t) => sum + toCents(t.tax), 0);
  // taxRules carries the configured rate; calculatedTaxes carries what was
  // actually applied. Prefer the applied one, because a mixed-rate line exists.
  const rate = taxes[0]?.taxRate ?? li.price?.taxRules?.[0]?.taxRate ?? null;

  return {
    title: li.label?.trim() || "Position",
    sku: li.payload?.productNumber ?? null,
    quantity: li.quantity ?? 1,
    unitAmount: li.price?.unitPrice ?? 0,
    taxCents,
    taxRate: rate,
    productId: li.productId ?? null,
  };
}

/**
 * The VAT ID, if the merchant collects one.
 *
 * Shopware keeps `vatIds` as an array on the order's customer snapshot. Only
 * the first is used: an order has one recipient, and a second ID would be
 * ambiguous rather than additional.
 */
export function extractVatId(order: ShopwareOrder): string | null {
  const ids = order.orderCustomer?.vatIds;
  if (!Array.isArray(ids)) return null;
  const first = ids.find((v) => typeof v === "string" && v.trim().length > 0);
  return first ? first.trim() : null;
}

export function mapOrder(order: ShopwareOrder): OrderLike {
  const billing = mapAddress(order.billingAddress);
  const shipping = mapAddress(order.deliveries?.[0]?.shippingOrderAddress);

  const totalTaxCents = (order.price?.calculatedTaxes ?? []).reduce(
    (sum, t) => sum + toCents(t.tax),
    0,
  );

  return {
    id: order.id,
    name: order.orderNumber ?? undefined,
    orderNumber: order.orderNumber ?? undefined,
    createdAt: order.orderDateTime ?? undefined,
    // Shopware has no separate "processed" timestamp; the webhook fires on the
    // payment transition, so the order date is the supply date we have.
    processedAt: order.orderDateTime ?? undefined,
    currencyCode: order.currency?.isoCode ?? undefined,
    customer: order.orderCustomer
      ? {
          id: order.orderCustomer.customerId ?? undefined,
          firstName: order.orderCustomer.firstName ?? null,
          lastName: order.orderCustomer.lastName ?? null,
          email: order.orderCustomer.email ?? null,
        }
      : null,
    email: order.orderCustomer?.email ?? null,
    billingAddress: billing,
    shippingAddress: shipping,
    totalTaxCents,
    lineItems: (order.lineItems ?? []).map(mapLineItem),
    vatId: extractVatId(order),
    paymentGatewayNames: (order.transactions ?? [])
      .map((t) => t.paymentMethod?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  };
}

/**
 * A guest order has no customer account behind it.
 *
 * Shopware's order keeps a customer snapshot either way, so the presence of
 * `customerId` is the only reliable signal — and it matters, because a guest
 * has no stable id to key a contact on, and without one every retry would
 * create a fresh contact.
 */
export function isGuestOrder(order: ShopwareOrder): boolean {
  return !order.orderCustomer?.customerId;
}
