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
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const batchId = String(form.get("batchId") ?? "");
  const who = session.onlineAccessInfo?.associated_user?.email ?? "a user";

  try {
    if (intent === "confirm") {
      const n = await confirmImported(shop, batchId, who);
      return { ok: true, message: `${n} invoice(s) marked as booked in Scopevisio.` };
    }
    if (intent === "return") {
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) {
        return { ok: false, message: "Please say what went wrong with the import." };
      }
      const n = await returnBatchToQueue(shop, batchId, reason);
      return { ok: true, message: `${n} invoice(s) returned to the queue.` };
    }
    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
};

function ReturnForm({ batchId, busy }: { batchId: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Button variant="plain" tone="critical" onClick={() => setOpen(true)}>
        Import failed
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
          label="What went wrong?"
          name="reason"
          value={reason}
          onChange={setReason}
          autoComplete="off"
          helpText="Recorded in the journal, and the invoices go back in the queue."
        />
        <InlineStack gap="200">
          <Button submit tone="critical" loading={busy}>
            Return to queue
          </Button>
          <Button variant="plain" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </InlineStack>
      </BlockStack>
    </Form>
  );
}

export default function ExportPage() {
  const { pending, batches, deliveryMode, organisation } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <Page
      title="Export to Scopevisio"
      subtitle={
        organisation
          ? `Prepared invoices for ${organisation}`
          : "Prepared invoices"
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
            <Banner tone="warning" title="Delivery mode is set to direct API import">
              <p>
                This page only applies in CSV mode. Direct document import is
                not currently available, so orders will be held instead. Switch
                delivery back to CSV on the Mapping page.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {pending.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {pending.length} invoice{pending.length === 1 ? "" : "s"} ready
                  </Text>
                  <Badge tone="success">VAT resolved</Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  Each of these has its customer set up as a debitor and its
                  Erlöskonto and Steuerschlüssel already resolved from your
                  Steuermatrix. Download the file, then in Scopevisio go to
                  Abrechnung → Abrechnungsbelege and import it. You map the
                  columns once; the result is a normal Faktura you can send.
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
                    {`Download CSV (${pending.length})`}
                  </Button>
                </Box>

                <Text as="p" tone="subdued" variant="bodySm">
                  Downloading marks these as exported so the next file will not
                  contain them again — importing the same batch twice would
                  create duplicate invoices.
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
                  Waiting for your confirmation
                </Text>
                <Text as="p" tone="subdued">
                  These batches have been downloaded. The connector cannot see
                  whether Scopevisio accepted the import, so tell it what
                  happened — that is what keeps the audit trail honest.
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
                            ? new Date(b.exportedAt).toLocaleString("de-DE")
                            : "—"}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="center">
                        <Form method="post">
                          <input type="hidden" name="intent" value="confirm" />
                          <input type="hidden" name="batchId" value={b.batchId} />
                          <Button submit variant="primary" loading={busy}>
                            Imported successfully
                          </Button>
                        </Form>
                        <Button url={`/app/export.csv?batch=${b.batchId}`} download variant="plain">
                          Download again
                        </Button>
                        <ReturnForm batchId={b.batchId} busy={busy} />
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
                heading="Nothing to export"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Paid orders appear here once the connector has prepared them.
                  If you expected something, check the Orders page — an order
                  may be waiting on a decision.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                How to import in Scopevisio
              </Text>
              <List type="number">
                <List.Item>Open Scopevisio → Abrechnung → Abrechnungsbelege.</List.Item>
                <List.Item>Choose Import and select the downloaded CSV.</List.Item>
                <List.Item>
                  Map the columns — the headers already use Scopevisio field
                  names, so this is usually one-to-one. The mapping is saved for
                  next time.
                </List.Item>
                <List.Item>
                  Check the imported Belege, then come back here and confirm.
                </List.Item>
              </List>
              <Text as="p" tone="subdued" variant="bodySm">
                The file is semicolon-separated with German decimal commas and a
                UTF-8 byte-order mark, so Excel opens it correctly too.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
