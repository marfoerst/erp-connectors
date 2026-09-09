import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { getConnection, missingSettings } from "../scopevisio/connection.server";
import { orderCounts } from "../scopevisio/sync.server";
import { recentEvents } from "../scopevisio/log.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const connection = await getConnection(shop);
  const [counts, events] = await Promise.all([
    orderCounts(shop),
    recentEvents(shop, 8),
  ]);

  return {
    shop,
    connected: Boolean(connection),
    status: connection?.status ?? "none",
    statusDetail: connection?.statusDetail ?? null,
    organisation: connection?.organisation ?? null,
    syncEnabled: connection?.settings?.syncEnabled ?? false,
    autoPost: connection?.settings?.autoPost ?? false,
    gaps: connection ? missingSettings(connection.settings) : [],
    counts,
    events: events.map((e) => ({
      id: e.id,
      level: e.level,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
  };
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: "critical" | "success" }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone}>
          {String(value)}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();

  const needsAttention = data.counts.held + data.counts.pending;
  const toExport = data.counts.ready_to_export;
  const awaitingConfirm = data.counts.exported;

  return (
    <Page
      title="Scopevisio connector"
      subtitle={
        data.organisation
          ? `Booking shop orders into ${data.organisation}`
          : "Not connected yet"
      }
    >
      <Layout>
        {!data.connected && (
          <Layout.Section>
            <Banner tone="info" title="Connect Scopevisio to get started">
              <p>
                Three steps: connect your Scopevisio organisation, review how
                shop data maps onto your accounts, then switch sync on. Nothing
                is sent to Scopevisio until you do.
              </p>
              <Box paddingBlockStart="300">
                <Button url="/app/connection" variant="primary">
                  Connect Scopevisio
                </Button>
              </Box>
            </Banner>
          </Layout.Section>
        )}

        {data.status === "error" && (
          <Layout.Section>
            <Banner tone="critical" title="The Scopevisio connection is not working">
              <p>{data.statusDetail}</p>
              <p>
                Orders are being queued, not lost. Reconnect and they will be
                processed.
              </p>
              <Box paddingBlockStart="300">
                <Button url="/app/connection">Fix the connection</Button>
              </Box>
            </Banner>
          </Layout.Section>
        )}

        {data.connected && data.gaps.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title="Mapping is incomplete">
              <List>
                {data.gaps.map((gap) => (
                  <List.Item key={gap}>{gap}</List.Item>
                ))}
              </List>
              <Box paddingBlockStart="300">
                <Button url="/app/mapping">Finish the mapping</Button>
              </Box>
            </Banner>
          </Layout.Section>
        )}

        {data.connected && data.gaps.length === 0 && !data.syncEnabled && (
          <Layout.Section>
            <Banner tone="warning" title="Sync is switched off">
              <p>
                The mapping is complete, but paid orders are not being sent to
                Scopevisio yet. Turn sync on when you are ready.
              </p>
              <Box paddingBlockStart="300">
                <Button url="/app/mapping">Open mapping</Button>
              </Box>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <Stat label="Booked" value={data.counts.booked} tone="success" />
            <Stat
              label="Needs your decision"
              value={needsAttention}
              tone={needsAttention > 0 ? "critical" : undefined}
            />
            <Stat label="Ready to export" value={toExport} />
            <Stat label="Awaiting confirmation" value={awaitingConfirm} />
          </InlineGrid>
        </Layout.Section>

        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Current mode
                  </Text>
                  <InlineStack gap="200">
                    <Badge tone={data.syncEnabled ? "success" : "attention"}>
                      {data.syncEnabled ? "Sync on" : "Sync off"}
                    </Badge>
                    <Badge tone={data.autoPost ? "success" : "info"}>
                      {data.autoPost ? "Posting automatically" : "Create only, you post"}
                    </Badge>
                  </InlineStack>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {data.autoPost
                    ? "Invoices are posted to the ledger automatically once the tax cross-check passes. Posted documents cannot be withdrawn."
                    : "Invoices are created and cross-checked, then left for you to post in Scopevisio. This is the safe way to start."}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {(toExport > 0 || awaitingConfirm > 0) && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {toExport > 0
                    ? `${toExport} invoice${toExport === 1 ? "" : "s"} ready to import`
                    : `${awaitingConfirm} batch invoice${awaitingConfirm === 1 ? "" : "s"} awaiting confirmation`}
                </Text>
                <Text as="p" tone="subdued">
                  {toExport > 0
                    ? "Customer, debitor account and VAT are already resolved. Download the file and import it in Scopevisio."
                    : "A downloaded batch has not been confirmed yet. Tell the connector whether the import went through."}
                </Text>
                <Box>
                  <Button url="/app/export" variant="primary">
                    Open Export
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {needsAttention > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {needsAttention} order{needsAttention === 1 ? "" : "s"} waiting for you
                </Text>
                <Text as="p" tone="subdued">
                  These were not booked because something could not be decided
                  automatically. Each one explains what it needs.
                </Text>
                <Box>
                  <Button url="/app/orders" variant="primary">
                    Open the review queue
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {data.events.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Latest activity
                  </Text>
                  <RemixLink to="/app/journal">See the full journal</RemixLink>
                </InlineStack>
                <BlockStack gap="200">
                  {data.events.map((e) => (
                    <InlineStack key={e.id} gap="300" blockAlign="start" wrap={false}>
                      <Box minWidth="150px">
                        <Text as="span" tone="subdued" variant="bodySm">
                          {new Date(e.createdAt).toLocaleString("de-DE")}
                        </Text>
                      </Box>
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={e.level === "error" ? "critical" : undefined}
                      >
                        {e.message}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
