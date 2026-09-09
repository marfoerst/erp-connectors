import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import {
  declineOrder,
  heldOrders,
  orderCounts,
  requeueOrder,
  syncOrder,
} from "../scopevisio/sync.server";
import { fetchOrder } from "../scopevisio/fetch-order.server";
import { pollOrders } from "../scopevisio/intake.server";
import { HOLD_REASON_LABEL } from "../scopevisio/constants";

/**
 * PRD C-009 / C-010 — the review queue. Every entry is phrased as an
 * accounting question, and every entry offers the decision a bookkeeper is
 * qualified to make.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [rows, counts] = await Promise.all([
    heldOrders(shop, 100),
    orderCounts(shop),
  ]);

  return {
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      orderGid: r.orderGid,
      orderName: r.orderName,
      state: r.state,
      reason: r.reason,
      detail: r.detail,
      documentNumber: r.documentNumber,
      countryUsed: r.countryUsed,
      shopifyTaxCents: r.shopifyTaxCents,
      erpTaxCents: r.erpTaxCents,
      attempts: r.attempts,
      createdAt: r.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const orderGid = String(form.get("orderGid") ?? "");

  try {
    if (intent === "decline") {
      const note = String(form.get("note") ?? "").trim();
      if (!note) {
        return { ok: false, message: "Please say why this order will not be booked." };
      }
      await declineOrder(shop, orderGid, session.onlineAccessInfo?.associated_user?.email ?? "a user", note);
      return { ok: true, message: "Recorded — this order will not be booked." };
    }

    if (intent === "retry") {
      await requeueOrder(shop, orderGid);

      // Re-read the order from Shopify so the retry uses current data rather
      // than whatever the original webhook happened to contain — the merchant
      // may have fixed an address or a VAT ID in the meantime.
      const order = await fetchOrder(admin, orderGid);

      if (!order) {
        return { ok: false, message: "Shopify no longer returns this order." };
      }

      const outcome = await syncOrder(shop, order);

      if (outcome.state === "booked") {
        return { ok: true, message: `Booked as ${outcome.documentNumber}.` };
      }
      if (outcome.state === "held") {
        return { ok: false, message: outcome.detail };
      }
      if (outcome.state === "ready_to_export") {
        return { ok: true, message: "Prepared — it is now on the Export page." };
      }
      return { ok: false, message: `Skipped: ${outcome.reason}.` };
    }

    if (intent === "poll") {
      // Reads orders from the Admin API rather than waiting for a webhook —
      // this also recovers anything missed while Scopevisio was unreachable.
      const r = await pollOrders(shop, admin);
      if (r.errors.length) {
        return {
          ok: false,
          message: `Checked Shopify: ${r.scanned} order(s) found, ${r.prepared} prepared. Problems: ${r.errors.slice(0, 3).join("; ")}`,
        };
      }
      return {
        ok: true,
        message:
          r.scanned === 0
            ? "No new paid orders since the last check."
            : `${r.scanned} paid order(s) found — ${r.prepared} prepared, ${r.held} need a decision, ${r.skipped} already handled.`,
      };
    }

    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
};

function OrderRow({
  row,
  busy,
}: {
  row: {
    orderGid: string;
    orderName: string | null;
    state: string;
    reason: string | null;
    detail: string | null;
    documentNumber: string | null;
    countryUsed: string | null;
    shopifyTaxCents: number | null;
    erpTaxCents: number | null;
    attempts: number;
    createdAt: string;
  };
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">
              {row.orderName ?? row.orderGid}
            </Text>
            <Badge tone={row.reason === "awaiting_manual_post" ? "info" : "attention"}>
              {HOLD_REASON_LABEL[row.reason ?? ""] ?? row.reason ?? row.state}
            </Badge>
            {row.countryUsed && <Badge>{row.countryUsed}</Badge>}
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">
            {new Date(row.createdAt).toLocaleString("de-DE")}
          </Text>
        </InlineStack>

        {row.detail && <Text as="p">{row.detail}</Text>}

        {row.shopifyTaxCents !== null && row.erpTaxCents !== null && (
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <InlineStack gap="500">
              <BlockStack gap="050">
                <Text as="span" tone="subdued" variant="bodySm">
                  Shopify VAT
                </Text>
                <Text as="span" variant="headingSm">
                  {(row.shopifyTaxCents / 100).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" tone="subdued" variant="bodySm">
                  Scopevisio VAT
                </Text>
                <Text as="span" variant="headingSm">
                  {(row.erpTaxCents / 100).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" tone="subdued" variant="bodySm">
                  Difference
                </Text>
                <Text as="span" variant="headingSm" tone="critical">
                  {((row.erpTaxCents - row.shopifyTaxCents) / 100).toFixed(2)}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        )}

        {row.documentNumber && (
          <Text as="p" tone="subdued" variant="bodySm">
            Scopevisio document {row.documentNumber} exists but is not posted.
          </Text>
        )}

        {row.attempts > 1 && (
          <Text as="p" tone="subdued" variant="bodySm">
            Tried {row.attempts} times.
          </Text>
        )}

        <InlineStack gap="300">
          <Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="orderGid" value={row.orderGid} />
            <Button submit loading={busy}>
              Try again
            </Button>
          </Form>
          {!declining ? (
            <Button variant="plain" tone="critical" onClick={() => setDeclining(true)}>
              Will not be booked
            </Button>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="decline" />
              <input type="hidden" name="orderGid" value={row.orderGid} />
              <InlineStack gap="200" blockAlign="end">
                <Box minWidth="320px">
                  <TextField
                    label="Why not?"
                    name="note"
                    value={note}
                    onChange={setNote}
                    autoComplete="off"
                    helpText="Recorded in the journal for the audit trail."
                  />
                </Box>
                <Button submit tone="critical" loading={busy}>
                  Confirm
                </Button>
                <Button variant="plain" onClick={() => setDeclining(false)}>
                  Cancel
                </Button>
              </InlineStack>
            </Form>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function OrdersPage() {
  const { rows, counts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <Page
      title="Orders needing a decision"
      subtitle={`${counts.booked} booked · ${counts.held + counts.pending} waiting · ${counts.declined} declined`}
    >
      <Layout>
        {actionData?.message && (
          <Layout.Section>
            <Banner tone={actionData.ok ? "success" : "critical"}>
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Check Shopify for paid orders
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Orders normally arrive on their own. Use this to pull in
                    anything missed — for example while Scopevisio was
                    unreachable, or before order webhooks are approved.
                  </Text>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="poll" />
                  <Button submit loading={busy}>
                    Check now
                  </Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {rows.length === 0 ? (
            <Card>
              <EmptyState
                heading="Nothing waiting"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Every order the connector has seen was either booked or
                  deliberately declined. An empty queue means the automatic
                  bookings can be trusted.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="400">
              {rows.map((row) => (
                <OrderRow key={row.id} row={row} busy={busy} />
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
