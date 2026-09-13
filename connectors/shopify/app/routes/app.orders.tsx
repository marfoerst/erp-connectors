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
import { HOLD_REASON_LABEL } from "@erp/scopevisio-core";
import { makeT, resolveLocale, type Locale } from "../i18n";

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
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
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
  const t = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const orderGid = String(form.get("orderGid") ?? "");

  try {
    if (intent === "decline") {
      const note = String(form.get("note") ?? "").trim();
      if (!note) {
        return { ok: false, message: t("orders.decline.needReason") };
      }
      await declineOrder(shop, orderGid, session.onlineAccessInfo?.associated_user?.email ?? "a user", note);
      return { ok: true, message: t("orders.decline.done") };
    }

    if (intent === "retry") {
      await requeueOrder(shop, orderGid);

      // Re-read the order from Shopify so the retry uses current data rather
      // than whatever the original webhook happened to contain — the merchant
      // may have fixed an address or a VAT ID in the meantime.
      const order = await fetchOrder(admin, orderGid);

      if (!order) {
        return { ok: false, message: t("orders.retry.gone") };
      }

      const outcome = await syncOrder(shop, order);

      if (outcome.state === "booked") {
        return { ok: true, message: `Booked as ${outcome.documentNumber}.` };
      }
      if (outcome.state === "held") {
        return { ok: false, message: outcome.detail };
      }
      if (outcome.state === "ready_to_export") {
        return { ok: true, message: t("orders.retry.prepared") };
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
            ? t("orders.check.none")
            : t("orders.check.result", {
                scanned: r.scanned, prepared: r.prepared,
                held: r.held, skipped: r.skipped,
              }),
      };
    }

    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t("common.error"),
    };
  }
};

function OrderRow({
  row,
  busy,
  locale,
}: {
  locale: Locale;
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
  const t = makeT(locale);
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
            {new Date(row.createdAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB")}
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
                  {t("orders.tax.shopify")}
                </Text>
                <Text as="span" variant="headingSm">
                  {(row.shopifyTaxCents / 100).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" tone="subdued" variant="bodySm">
                  {t("orders.tax.erp")}
                </Text>
                <Text as="span" variant="headingSm">
                  {(row.erpTaxCents / 100).toFixed(2)}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" tone="subdued" variant="bodySm">
                  {t("orders.tax.diff")}
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
            {t("orders.doc.unposted", { n: row.documentNumber ?? "" })}
          </Text>
        )}

        {row.attempts > 1 && (
          <Text as="p" tone="subdued" variant="bodySm">
            {t("orders.attempts", { n: row.attempts })}
          </Text>
        )}

        <InlineStack gap="300">
          <Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="orderGid" value={row.orderGid} />
            <Button submit loading={busy}>
              {t("orders.retry")}
            </Button>
          </Form>
          {!declining ? (
            <Button variant="plain" tone="critical" onClick={() => setDeclining(true)}>
              {t("orders.decline")}
            </Button>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="decline" />
              <input type="hidden" name="orderGid" value={row.orderGid} />
              {/* Stacks rather than forcing a 320px column on mobile. */}
              <BlockStack gap="300">
                <TextField
                  label={t("orders.decline.why")}
                  name="note"
                  value={note}
                  onChange={setNote}
                  autoComplete="off"
                  helpText={t("orders.decline.why.help")}
                />
                <InlineStack gap="200">
                  <Button submit tone="critical" loading={busy}>
                    {t("orders.decline.confirm")}
                  </Button>
                  <Button variant="plain" onClick={() => setDeclining(false)}>
                    {t("common.cancel")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function OrdersPage() {
  const { rows, counts, locale } = useLoaderData<typeof loader>();
  const t = makeT(locale);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <Page
      title={t("orders.title")}
      subtitle={t("orders.subtitle", {
        booked: counts.booked,
        waiting: counts.held + counts.pending,
        declined: counts.declined,
      })}
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
                    {t("orders.check.title")}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("orders.check.detail")}
                  </Text>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="poll" />
                  <Button submit loading={busy}>
                    {t("orders.check.button")}
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
                heading={t("orders.empty")}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{t("orders.empty.detail")}</p>
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="400">
              {rows.map((row) => (
                <OrderRow key={row.id} row={row} busy={busy} locale={locale} />
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
