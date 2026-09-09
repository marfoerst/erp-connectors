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
import { makeT, resolveLocale, type Locale } from "../i18n";
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
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
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
  locale,
}: {
  connected: boolean;
  mappingComplete: boolean;
  syncEnabled: boolean;
  done: boolean;
  locale: Locale;
}) {
  const t = makeT(locale);
  const steps = [
    {
      label: t("overview.onboarding.step1"),
      detail: t("overview.onboarding.step1.detail"),
      complete: connected,
      url: "/app/connection",
    },
    {
      label: t("overview.onboarding.step2"),
      detail: t("overview.onboarding.step2.detail"),
      complete: mappingComplete,
      url: "/app/mapping",
    },
    {
      label: t("overview.onboarding.step3"),
      detail: t("overview.onboarding.step3.detail"),
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
            {done ? t("overview.onboarding.done") : t("overview.onboarding.title")}
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={done ? "success" : "attention"}>
              {t("overview.onboarding.progress", {
                done: steps.filter((s) => s.complete).length,
              })}
            </Badge>
            {done && (
              <Form method="post">
                <input type="hidden" name="intent" value="dismissOnboarding" />
                <Button submit variant="plain">
                  {t("overview.onboarding.dismiss")}
                </Button>
              </Form>
            )}
          </InlineStack>
        </InlineStack>

        <BlockStack gap="300">
          {steps.map((step, i) => (
            <InlineStack key={step.label} gap="300" blockAlign="start">
              <Badge tone={step.complete ? "success" : undefined}>
                {step.complete ? t("overview.step.done") : String(i + 1)}
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
  const t = makeT(data.locale);

  const needsAttention = data.counts.held + data.counts.pending;
  const toExport = data.counts.ready_to_export;
  const awaitingConfirm = data.counts.exported;

  return (
    <Page
      title={t("overview.title")}
      subtitle={
        data.organisation
          ? t("overview.subtitle.connected", { org: data.organisation })
          : t("overview.subtitle.disconnected")
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
              locale={data.locale}
            />
          </Layout.Section>
        )}

        {data.status === "error" && (
          <Layout.Section>
            <Banner tone="critical" title={t("overview.connection.broken")}>
              <p>{data.statusDetail}</p>
              <p>{t("overview.connection.broken.detail")}</p>
              <Box paddingBlockStart="300">
                <Button url="/app/connection">{t("overview.connection.fix")}</Button>
              </Box>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <Stat label={t("overview.stat.booked")} value={data.counts.booked} tone="success" />
            <Stat
              label={t("overview.stat.attention")}
              value={needsAttention}
              tone={needsAttention > 0 ? "critical" : undefined}
            />
            <Stat label={t("overview.stat.toExport")} value={toExport} />
            <Stat label={t("overview.stat.awaiting")} value={awaitingConfirm} />
          </InlineGrid>
        </Layout.Section>

        {data.connected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("overview.mode.title")}
                  </Text>
                  <InlineStack gap="200">
                    <Badge tone={data.syncEnabled ? "success" : "attention"}>
                      {data.syncEnabled ? t("overview.mode.syncOn") : t("overview.mode.syncOff")}
                    </Badge>
                    <Badge tone={data.autoPost ? "success" : "info"}>
                      {data.autoPost ? t("overview.mode.autoPost") : t("overview.mode.manualPost")}
                    </Badge>
                  </InlineStack>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {data.autoPost
                    ? t("overview.mode.autoPost.detail")
                    : t("overview.mode.manualPost.detail")}
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
                    ? t("overview.export.ready", { n: toExport })
                    : t("overview.export.awaiting", { n: awaitingConfirm })}
                </Text>
                <Text as="p" tone="subdued">
                  {toExport > 0
                    ? t("overview.export.ready.detail")
                    : t("overview.export.awaiting.detail")}
                </Text>
                <Box>
                  <Button url="/app/export" variant="primary">
                    {t("overview.export.open")}
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
                  {t("overview.attention.title", { n: needsAttention })}
                </Text>
                <Text as="p" tone="subdued">
                  {t("overview.attention.detail")}
                </Text>
                <Box>
                  <Button url="/app/orders" variant="primary">
                    {t("overview.attention.open")}
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {(data.supportUrl || data.privacyUrl) && (
          <Layout.Section>
            <FooterHelp>
              {t("overview.footer.help")}{" "}
              {data.supportUrl && (
                <Link url={data.supportUrl} target="_blank">
                  {t("overview.footer.support")}
                </Link>
              )}
              {data.supportUrl && data.privacyUrl && " · "}
              {data.privacyUrl && (
                <Link url={data.privacyUrl} target="_blank">
                  {t("overview.footer.privacy")}
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
                    {t("overview.activity.title")}
                  </Text>
                  <RemixLink to="/app/journal">{t("overview.activity.all")}</RemixLink>
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
