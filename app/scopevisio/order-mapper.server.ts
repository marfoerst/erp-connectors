import type { AddressLike, OrderLike, OrderLineLike } from "./types";

/**
 * Maps a Shopify order webhook payload (REST shape, which is what
 * `authenticate.webhook` hands over) onto the neutral `OrderLike` the
 * connector works with.
 *
 * Kept separate from the sync logic so the payload shape can change — or a
 * GraphQL-sourced order can be substituted — without touching anything else.
 */

interface ShopifyWebhookAddress {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

interface ShopifyWebhookLineItem {
  title?: string;
  name?: string;
  sku?: string | null;
  quantity?: number;
  price?: string;
  product_id?: number | string | null;
  tax_lines?: Array<{ price?: string; rate?: number | null }>;
}

export interface ShopifyOrderPayload {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  order_number?: number;
  created_at?: string;
  processed_at?: string;
  currency?: string;
  email?: string | null;
  total_tax?: string;
  customer?: {
    id?: number | string;
    admin_graphql_api_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: ShopifyWebhookAddress | null;
  shipping_address?: ShopifyWebhookAddress | null;
  line_items?: ShopifyWebhookLineItem[];
  payment_gateway_names?: string[];
  /** Where a merchant collects a VAT ID, it is usually a note attribute. */
  note_attributes?: Array<{ name?: string; value?: string }>;
  company?: { id?: string } | null;
  tax_exempt?: boolean;
  taxes_included?: boolean;
}

const VAT_ID_KEYS = [
  "vat_id",
  "vatid",
  "vat",
  "ustid",
  "ust-id",
  "ustidnr",
  "umsatzsteuer-id",
  "tax_id",
  "vat_number",
];

export function mapOrder(payload: ShopifyOrderPayload): OrderLike {
  const gid =
    payload.admin_graphql_api_id ??
    (payload.id ? `gid://shopify/Order/${payload.id}` : "");

  const customerGid =
    payload.customer?.admin_graphql_api_id ??
    (payload.customer?.id
      ? `gid://shopify/Customer/${payload.customer.id}`
      : undefined);

  return {
    id: gid,
    name: payload.name,
    orderNumber: payload.order_number,
    createdAt: payload.created_at,
    processedAt: payload.processed_at ?? payload.created_at,
    currencyCode: payload.currency ?? "EUR",
    email: payload.email ?? null,
    customer: payload.customer
      ? {
          id: customerGid,
          firstName: payload.customer.first_name ?? null,
          lastName: payload.customer.last_name ?? null,
          email: payload.customer.email ?? null,
          phone: payload.customer.phone ?? null,
        }
      : null,
    billingAddress: mapAddress(payload.billing_address),
    shippingAddress: mapAddress(payload.shipping_address),
    totalTaxCents: toCents(payload.total_tax),
    vatId: extractVatId(payload),
    paymentGatewayNames: payload.payment_gateway_names ?? [],
    lineItems: (payload.line_items ?? []).map(mapLineItem),
  };
}

function mapAddress(addr: ShopifyWebhookAddress | null | undefined): AddressLike | null {
  if (!addr) return null;
  return {
    firstName: addr.first_name ?? null,
    lastName: addr.last_name ?? null,
    company: addr.company ?? null,
    address1: addr.address1 ?? null,
    address2: addr.address2 ?? null,
    zip: addr.zip ?? null,
    city: addr.city ?? null,
    countryCodeV2: addr.country_code ?? null,
    phone: addr.phone ?? null,
  };
}

function mapLineItem(line: ShopifyWebhookLineItem): OrderLineLike {
  const taxCents = (line.tax_lines ?? []).reduce(
    (sum, t) => sum + (toCents(t.price) ?? 0),
    0,
  );
  return {
    title: line.title ?? line.name ?? "Position",
    sku: line.sku ?? null,
    quantity: line.quantity ?? 1,
    unitAmount: Number(line.price ?? 0),
    taxCents,
    taxRate: line.tax_lines?.[0]?.rate ?? null,
    productId: line.product_id ? String(line.product_id) : null,
  };
}

/**
 * Shopify has no first-class VAT-ID field on an order, so merchants collect it
 * in a note attribute or on the company. We look in the places that are
 * actually used and give up cleanly if it is not there.
 */
function extractVatId(payload: ShopifyOrderPayload): string | null {
  for (const attr of payload.note_attributes ?? []) {
    const key = (attr.name ?? "").toLowerCase().replace(/\s+/g, "_");
    if (VAT_ID_KEYS.includes(key) && attr.value) {
      return attr.value.trim();
    }
  }
  return null;
}

function toCents(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) : undefined;
}

// --- Refunds ---------------------------------------------------------------

export interface ShopifyRefundPayload {
  id?: number | string;
  order_id?: number | string;
  admin_graphql_api_id?: string;
  created_at?: string;
  note?: string | null;
  refund_line_items?: Array<{
    quantity?: number;
    subtotal?: string;
    line_item?: ShopifyWebhookLineItem;
  }>;
}

export interface RefundView {
  refundGid: string;
  orderGid: string;
  createdAt?: string;
  note?: string | null;
  lines: OrderLineLike[];
}

export function mapRefund(payload: ShopifyRefundPayload): RefundView {
  return {
    refundGid:
      payload.admin_graphql_api_id ??
      (payload.id ? `gid://shopify/Refund/${payload.id}` : ""),
    orderGid: payload.order_id
      ? `gid://shopify/Order/${payload.order_id}`
      : "",
    createdAt: payload.created_at,
    note: payload.note ?? null,
    lines: (payload.refund_line_items ?? []).map((rli) => ({
      title: rli.line_item?.title ?? rli.line_item?.name ?? "Rückgabe",
      sku: rli.line_item?.sku ?? null,
      quantity: rli.quantity ?? 1,
      unitAmount: Number(rli.line_item?.price ?? rli.subtotal ?? 0),
      productId: rli.line_item?.product_id
        ? String(rli.line_item.product_id)
        : null,
    })),
  };
}
