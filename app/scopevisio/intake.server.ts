import prisma from "../db.server";
import { logEvent } from "./log.server";
import { syncOrder } from "./sync.server";
import type { OrderLike, OrderLineLike } from "./types";

/**
 * Order intake by polling the Admin API.
 *
 * Two reasons this exists rather than relying on webhooks alone:
 *
 *  1. Subscribing to `orders/paid` requires Shopify's protected-customer-data
 *     grant, and without it `shopify app dev` refuses to start at all. Reading
 *     orders with the already-granted `read_orders` / `read_customers` scopes
 *     has no such hard failure, so intake works before that approval lands.
 *  2. A webhook missed while Scopevisio was unreachable is simply gone. A
 *     cursor recovers it. That is what makes "nothing I sold is missing from
 *     the books" (PRD C-011) actually true rather than aspirational.
 *
 * When webhooks are available they become the fast path; this stays as the
 * safety net, and the idempotency guard in `syncOrder` means both can run
 * without double-booking.
 */

/** Overlap the window slightly so an order on the boundary is never skipped. */
const OVERLAP_MS = 5 * 60 * 1000;

/** How far back a first-ever poll reaches. */
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const ORDERS_QUERY = `#graphql
  query ConnectorPaidOrders($query: String!, $cursor: String) {
    orders(first: 50, query: $query, sortKey: PROCESSED_AT, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        number
        createdAt
        processedAt
        email
        currencyCode
        displayFinancialStatus
        totalTaxSet { shopMoney { amount } }
        paymentGatewayNames
        customAttributes { key value }
        customer { id firstName lastName email phone }
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
  }
`;

const VAT_ID_KEYS = [
  "vat_id", "vatid", "vat", "ustid", "ust-id", "ustidnr",
  "umsatzsteuer-id", "tax_id", "vat_number",
];

interface GqlMoney {
  shopMoney?: { amount?: string } | null;
}

interface GqlOrderNode {
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
  billingAddress?: Record<string, string | null> | null;
  shippingAddress?: Record<string, string | null> | null;
  lineItems?: {
    nodes?: Array<{
      title?: string | null;
      sku?: string | null;
      quantity?: number | null;
      product?: { id?: string | null } | null;
      originalUnitPriceSet?: GqlMoney | null;
      taxLines?: Array<{ rate?: number | null; priceSet?: GqlMoney | null }> | null;
    }>;
  } | null;
}

/** Minimal shape of the Admin GraphQL client we need, so this is testable. */
export interface GraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
}

export function mapGraphqlOrder(node: GqlOrderNode): OrderLike {
  return {
    id: node.id,
    name: node.name ?? undefined,
    orderNumber: node.number ?? undefined,
    createdAt: node.createdAt ?? undefined,
    processedAt: node.processedAt ?? node.createdAt ?? undefined,
    currencyCode: node.currencyCode ?? "EUR",
    email: node.email ?? null,
    customer: node.customer?.id
      ? {
          id: node.customer.id,
          firstName: node.customer.firstName ?? null,
          lastName: node.customer.lastName ?? null,
          email: node.customer.email ?? null,
          phone: node.customer.phone ?? null,
        }
      : null,
    billingAddress: (node.billingAddress ?? null) as OrderLike["billingAddress"],
    shippingAddress: (node.shippingAddress ?? null) as OrderLike["shippingAddress"],
    totalTaxCents: moneyToCents(node.totalTaxSet),
    vatId: extractVatId(node.customAttributes),
    paymentGatewayNames: node.paymentGatewayNames ?? [],
    lineItems: (node.lineItems?.nodes ?? []).map(mapLine),
  };
}

function mapLine(line: NonNullable<NonNullable<GqlOrderNode["lineItems"]>["nodes"]>[number]): OrderLineLike {
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
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
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

/**
 * Build the search query. `financial_status:paid` mirrors the `orders/paid`
 * trigger — an invoice follows the payment, not the intent to buy.
 */
export function buildOrderQuery(since: Date): string {
  return `financial_status:paid processed_at:>='${since.toISOString()}'`;
}

export interface IntakeResult {
  scanned: number;
  prepared: number;
  skipped: number;
  held: number;
  errors: string[];
  since: string;
  pages: number;
}

export async function pollOrders(
  shop: string,
  admin: GraphqlClient,
  opts: { since?: Date; maxPages?: number } = {},
): Promise<IntakeResult> {
  const settings = await prisma.scopevisioSettings.findUnique({ where: { shop } });

  const since =
    opts.since ??
    (settings?.lastPolledAt
      ? new Date(settings.lastPolledAt.getTime() - OVERLAP_MS)
      : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS));

  const query = buildOrderQuery(since);
  const result: IntakeResult = {
    scanned: 0,
    prepared: 0,
    skipped: 0,
    held: 0,
    errors: [],
    since: since.toISOString(),
    pages: 0,
  };

  // Record the start time, not the end: an order created mid-run must be
  // caught by the next poll rather than falling in the gap.
  const runStartedAt = new Date();
  const maxPages = opts.maxPages ?? 10;
  let cursor: string | null = null;

  do {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { query, cursor },
    });
    const body = (await response.json()) as {
      data?: {
        orders?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: GqlOrderNode[];
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (body.errors?.length) {
      const messages = body.errors.map((e) => e.message ?? "unknown").join("; ");
      result.errors.push(messages);
      await logEvent(shop, {
        level: "error",
        event: "intake.query_failed",
        message: `Could not read orders from Shopify: ${messages}`,
      });
      break;
    }

    const nodes = body.data?.orders?.nodes ?? [];
    result.pages += 1;

    for (const node of nodes) {
      result.scanned += 1;
      try {
        const outcome = await syncOrder(shop, mapGraphqlOrder(node));
        if (outcome.state === "ready_to_export" || outcome.state === "booked") {
          result.prepared += 1;
        } else if (outcome.state === "held") {
          result.held += 1;
        } else {
          result.skipped += 1;
        }
      } catch (err) {
        // One bad order must not abort the run — the rest still need booking.
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${node.name ?? node.id}: ${message}`);
      }
    }

    const pageInfo = body.data?.orders?.pageInfo;
    cursor = pageInfo?.hasNextPage ? (pageInfo.endCursor ?? null) : null;
  } while (cursor && result.pages < maxPages);

  if (settings) {
    await prisma.scopevisioSettings.update({
      where: { shop },
      data: { lastPolledAt: runStartedAt },
    });
  }

  await logEvent(shop, {
    level: result.errors.length ? "warn" : "info",
    event: "intake.polled",
    message:
      `Checked Shopify for paid orders since ${since.toLocaleString("de-DE")}: ` +
      `${result.scanned} found, ${result.prepared} prepared, ${result.held} held, ${result.skipped} already handled.`,
    data: result,
  });

  return result;
}
