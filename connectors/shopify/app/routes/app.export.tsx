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
  List,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import {
  confirmImported,
  openBatches,
  pendingExport,
  returnBatchToQueue,
} from "../scopevisio/csv-export.server";
import { getConnection } from "../scopevisio/connection.server";
import { makeT, resolveLocale, type Locale } from "../i18n";

/**
 * The delivery surface. Prepared invoices are downloaded as a CSV, imported in
 * the Scopevisio client, and then confirmed here.
 *
 * The confirmation step is deliberate: the connector cannot see whether an
 * import succeeded, so it must not claim an invoice is booked on its own.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [pending, batches, connection] = await Promise.all([
    pendingExport(shop),
    openBatches(shop),
    getConnection(shop),
  ]);

  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    deliveryMode: connection?.settings?.deliveryMode ?? "csv",
    organisation: connection?.organisation ?? null,
    pending: pending.map((r) => ({
      id: r.id,
      orderName: r.orderName ?? r.orderGid,
      countryUsed: r.countryUsed,
      resolvedAccount: r.resolvedAccount,
      resolvedVatKey: r.resolvedVatKey,
      personalAccount: r.personalAccount,
      createdAt: r.createdAt.toISOString(),
    })),
    batches: batches.map((b) => ({
      batchId: b.batchId,
      count: b.count,
      exportedAt: b.exportedAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const t = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const batchId = String(form.get("batchId") ?? "");
  const who = session.onlineAccessInfo?.associated_user?.email ?? "a user";

  try {
    if (intent === "confirm") {
      const n = await confirmImported(shop, batchId, who);
      return { ok: true, message: t("export.confirmed", { n }) };
    }
    if (intent === "return") {
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) {
        return { ok: false, message: t("export.failed.needReason") };
      }
      const n = await returnBatchToQueue(shop, batchId, reason);
      return { ok: true, message: t("export.returned", { n }) };
    }
    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t("common.error"),
    };
  }
};

function ReturnForm({
  batchId,
  busy,
  locale,
}: {
  batchId: string;
  busy: boolean;
  locale: Locale;
}) {
  const t = makeT(locale);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button variant="plain" tone="critical" onClick={() => setOpen(true)}>
        {t("export.failed")}
      </Button>
    );
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="return" />
      <input type="hidden" name="batchId" value={batchId} />
      {/* Full-width field with the buttons beneath, so this works at any
          viewport width (BFS 4.1.2). */}
      <BlockStack gap="300">
        <TextField
          label={t("export.failed.why")}
          name="reason"
          value={reason}
          onChange={setReason}
          autoComplete="off"
          helpText={t("export.failed.why.help")}
        />
        <InlineStack gap="200">
          <Button submit tone="critical" loading={busy}>
            {t("export.failed.confirm")}
          </Button>
          <Button variant="plain" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}

export default function ExportPage() {
  const { pending, batches, deliveryMode, organisation, locale } =
    useLoaderData<typeof loader>();
  const t = makeT(locale);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <Page
      title={t("export.title")}
      subtitle={
        organisation
          ? t("export.subtitle", { org: organisation })
          : t("export.subtitle.plain")
      }
    >
      <Layout>
        {actionData?.message && (
          <Layout.Section>
            <Banner tone={actionData.ok ? "success" : "critical"}>
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {deliveryMode !== "csv" && (
          <Layout.Section>
            <Banner tone="warning" title={t("export.apiMode")}>
              <p>{t("export.apiMode.detail")}</p>
            </Banner>
          </Layout.Section>
        )}

        {pending.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("export.ready", { n: pending.length })}
                  </Text>
                  <Badge tone="success">{t("export.vatResolved")}</Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  {t("export.ready.detail")}
                </Text>

                <BlockStack gap="150">
                  {pending.map((p) => (
                    // Order name above its detail line, so a long account
                    // summary wraps instead of scrolling (BFS 4.1.2).
                    <BlockStack key={p.id} gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">
                        {p.orderName}
                      </Text>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {p.countryUsed ?? "-"} · Debitor {p.personalAccount ?? "-"} ·
                        Konto {p.resolvedAccount ?? "-"} · {p.resolvedVatKey ?? "-"}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>

                <Box>
                  {/* A plain link, not a fetcher: this response is a file download. */}
                  {/* Polaris types Button children as a string, so the count
                      is composed rather than interpolated as a number. */}
                  <Button url="/app/export.csv" variant="primary" download>
                    {t("export.download", { n: pending.length })}
                  </Button>
                </Box>

                <Text as="p" tone="subdued" variant="bodySm">
                  {t("export.download.note")}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {batches.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("export.awaiting.title")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("export.awaiting.detail")}
                </Text>

                {batches.map((b) => (
                  <Box
                    key={b.batchId}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="headingSm">
                          {b.batchId}
                        </Text>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {b.count} invoice{b.count === 1 ? "" : "s"} ·{" "}
                          {b.exportedAt
                            ? new Date(b.exportedAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB")
                            : "—"}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="center">
                        <Form method="post">
                          <input type="hidden" name="intent" value="confirm" />
                          <input type="hidden" name="batchId" value={b.batchId} />
                          <Button submit variant="primary" loading={busy}>
                            {t("export.confirm")}
                          </Button>
                        </Form>
                        <Button url={`/app/export.csv?batch=${b.batchId}`} download variant="plain">
                          {t("export.again")}
                        </Button>
                        <ReturnForm batchId={b.batchId} busy={busy} locale={locale} />
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {pending.length === 0 && batches.length === 0 && (
          <Layout.Section>
            <Card>
              <EmptyState
                heading={t("export.empty")}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{t("export.empty.detail")}</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("export.how")}
              </Text>
              <List type="number">
                <List.Item>{t("export.how.1")}</List.Item>
                <List.Item>{t("export.how.2")}</List.Item>
                <List.Item>
                  {t("export.how.3")}
                </List.Item>
                <List.Item>
                  {t("export.how.4")}
                </List.Item>
              </List>
              <Text as="p" tone="subdued" variant="bodySm">
                {t("export.how.note")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
