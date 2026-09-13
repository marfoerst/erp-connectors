import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

import type { OrderLike, OrderLineLike } from "@erp/scopevisio-core";

/**
 * Reads one order back from the Admin GraphQL API.
 *
 * Used when a held order is reprocessed: the merchant may have corrected an
 * address or supplied a VAT ID since the webhook fired, so a retry must work
 * from current data rather than the stored payload.
 */

const ORDER_QUERY = `#graphql
  query ConnectorOrder($id: ID!) {
    order(id: $id) {
      id
      name
      number
      createdAt
      processedAt
      email
      currencyCode
      totalTaxSet { shopMoney { amount } }
      paymentGatewayNames
      customAttributes { key value }
      customer {
        id
        firstName
        lastName
        email
        phone
      }
      billingAddress {
        firstName lastName company address1 address2 zip city countryCodeV2 phone
      }
      shippingAddress {
        firstName lastName company address1 address2 zip city countryCodeV2 phone
      }
      lineItems(first: 250) {
        nodes {
          title
          sku
          quantity
          product { id }
          originalUnitPriceSet { shopMoney { amount } }
          taxLines { rate priceSet { shopMoney { amount } } }
        }
      }
    }
  }
`;

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

interface GqlMoney {
  shopMoney?: { amount?: string } | null;
}

interface GqlAddress {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
}

interface GqlLineItem {
  title?: string | null;
  sku?: string | null;
  quantity?: number | null;
  product?: { id?: string | null } | null;
  originalUnitPriceSet?: GqlMoney | null;
  taxLines?: Array<{ rate?: number | null; priceSet?: GqlMoney | null }> | null;
}

interface GqlOrder {
  id: string;
  name?: string | null;
  number?: number | null;
  createdAt?: string | null;
  processedAt?: string | null;
  email?: string | null;
  currencyCode?: string | null;
  totalTaxSet?: GqlMoney | null;
  paymentGatewayNames?: string[] | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
  customer?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  billingAddress?: GqlAddress | null;
  shippingAddress?: GqlAddress | null;
  lineItems?: { nodes?: GqlLineItem[] } | null;
}

export async function fetchOrder(
  admin: AdminApiContext,
  orderGid: string,
): Promise<OrderLike | null> {
  const response = await admin.graphql(ORDER_QUERY, {
    variables: { id: orderGid },
  });
  const body = (await response.json()) as { data?: { order?: GqlOrder | null } };
  const order = body?.data?.order;
  if (!order) return null;

  return {
    id: order.id,
    name: order.name ?? undefined,
    orderNumber: order.number ?? undefined,
    createdAt: order.createdAt ?? undefined,
    processedAt: order.processedAt ?? order.createdAt ?? undefined,
    currencyCode: order.currencyCode ?? "EUR",
    email: order.email ?? null,
    customer: order.customer
      ? {
          id: order.customer.id ?? undefined,
          firstName: order.customer.firstName ?? null,
          lastName: order.customer.lastName ?? null,
          email: order.customer.email ?? null,
          phone: order.customer.phone ?? null,
        }
      : null,
    billingAddress: order.billingAddress ?? null,
    shippingAddress: order.shippingAddress ?? null,
    totalTaxCents: moneyToCents(order.totalTaxSet),
    vatId: extractVatId(order.customAttributes),
    paymentGatewayNames: order.paymentGatewayNames ?? [],
    lineItems: (order.lineItems?.nodes ?? []).map(mapLine),
  };
}

function mapLine(line: GqlLineItem): OrderLineLike {
  const taxCents = (line.taxLines ?? []).reduce(
    (sum, t) => sum + (moneyToCents(t.priceSet) ?? 0),
    0,
  );
  return {
    title: line.title ?? "Position",
    sku: line.sku ?? null,
    quantity: line.quantity ?? 1,
    unitAmount: Number(line.originalUnitPriceSet?.shopMoney?.amount ?? 0),
    taxCents,
    taxRate: line.taxLines?.[0]?.rate ?? null,
    productId: line.product?.id ?? null,
  };
}

function moneyToCents(money: GqlMoney | null | undefined): number | undefined {
  const amount = money?.shopMoney?.amount;
  if (amount === undefined || amount === null || amount === "") return undefined;
  const num = Number(amount);
  return Number.isFinite(num) ? Math.round(num * 100) : undefined;
}

function extractVatId(
  attrs: Array<{ key?: string | null; value?: string | null }> | null | undefined,
): string | null {
  for (const attr of attrs ?? []) {
    const key = (attr.key ?? "").toLowerCase().replace(/\s+/g, "_");
    if (VAT_ID_KEYS.includes(key) && attr.value) return attr.value.trim();
  }
  return null;
}
