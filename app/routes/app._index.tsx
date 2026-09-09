import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  FooterHelp,
  Layout,
  Link,
  Page,
  Text,
} from "@shopify/polaris";

import prisma from "../db.server";
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
    onboardingDone: Boolean(
      connection &&
        connection.settings &&
        connection.status === "connected" &&
        missingSettings(connection.settings).length === 0 &&
        connection.settings.syncEnabled,
    ),
    onboardingDismissed: Boolean(connection?.settings?.onboardingDismissedAt),
    // The App Store requires a reachable support contact and privacy policy.
    // Kept in the environment so the URLs can change without a code deploy.
    supportUrl: process.env.SUPPORT_URL || "",
    privacyUrl: process.env.PRIVACY_POLICY_URL || "",
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent")) === "dismissOnboarding") {
    await prisma.scopevisioSettings.updateMany({
      where: { shop: session.shop },
      data: { onboardingDismissedAt: new Date() },
    });
  }
  return { ok: true };
};

/**
 * BFS 4.2.2 wants a concise onboarding that guides to completion and can be
 * removed afterwards. Three steps, each showing whether it is done, and a
 * dismiss action once all three are — so a set-up shop is not nagged forever.
 */
function Onboarding({
  connected,
  mappingComplete,
  syncEnabled,
  done,
}: {
  connected: boolean;
  mappingComplete: boolean;
  syncEnabled: boolean;
  done: boolean;
}) {
  const steps = [
    {
      label: "Connect your Scopevisio organisation",
      detail: "Sign in with the credentials you already use.",
      complete: connected,
      url: "/app/connection",
    },
    {
      label: "Confirm how shop data maps onto your accounts",
      detail: "Customer groups and a Steuersachverhalt per tax case, from your own master data.",
      complete: mappingComplete,
      url: "/app/mapping",
    },
    {
      label: "Switch sync on",
      detail: "Nothing is sent to Scopevisio until you do.",
      complete: syncEnabled,
      url: "/app/mapping",
    },
  ];
  const next = steps.find((s) => !s.complete);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {done ? "You are set up" : "Three steps to get started"}
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={done ? "success" : "attention"}>
              {`${steps.filter((s) => s.complete).length} of 3 done`}
            </Badge>
            {done && (
              <Form method="post">
                <input type="hidden" name="intent" value="dismissOnboarding" />
                <Button submit variant="plain">
                  Dismiss
                </Button>
              </Form>
            )}
          </InlineStack>
        </InlineStack>

        <BlockStack gap="300">
          {steps.map((step, i) => (
            <InlineStack key={step.label} gap="300" blockAlign="start">
              <Badge tone={step.complete ? "success" : undefined}>
                {step.complete ? "Done" : String(i + 1)}
              </Badge>
              <BlockStack gap="050">
                <Text as="span" variant="bodyMd">
                  {step.label}
                </Text>
                <Text as="span" tone="subdued" variant="bodySm">
                  {step.detail}
                </Text>
              </BlockStack>
            </InlineStack>
          ))}
        </BlockStack>

        {next && (
          <Box>
            <Button url={next.url} variant="primary">
              {next.label}
            </Button>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}

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
        {!(data.onboardingDone && data.onboardingDismissed) && (
          <Layout.Section>
            <Onboarding
              connected={data.connected && data.status === "connected"}
              mappingComplete={data.connected && data.gaps.length === 0}
              syncEnabled={data.syncEnabled}
              done={data.onboardingDone}
            />
          </Layout.Section>
        )}

        {data.status === "error" && (
          <Layout.Section>
            <Banner tone="critical" title="The Scopevisio connection is not working">
              <p>{data.statusDetail}</p>
              <p>
                Orders are queued, not lost. Reconnect and they will be
                processed.
              </p>
              <Box paddingBlockStart="300">
                <Button url="/app/connection">Fix the connection</Button>
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

        {(data.supportUrl || data.privacyUrl) && (
          <Layout.Section>
            <FooterHelp>
              Need help with a held order or a Scopevisio setting?{" "}
              {data.supportUrl && (
                <Link url={data.supportUrl} target="_blank">
                  Contact support
                </Link>
              )}
              {data.supportUrl && data.privacyUrl && " · "}
              {data.privacyUrl && (
                <Link url={data.privacyUrl} target="_blank">
                  Privacy policy
                </Link>
              )}
            </FooterHelp>
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
                    // Stacks on mobile: the timestamp sits above the message
                    // rather than pinning a fixed-width column (BFS 4.1.2).
                    <BlockStack key={e.id} gap="050">
                      <Text as="span" tone="subdued" variant="bodySm">
                        {new Date(e.createdAt).toLocaleString("de-DE")}
                      </Text>
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={e.level === "error" ? "critical" : undefined}
                      >
                        {e.message}
                      </Text>
                    </BlockStack>
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
