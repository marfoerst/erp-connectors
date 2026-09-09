import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { recentEvents } from "../scopevisio/log.server";
import { makeT, resolveLocale } from "../i18n";

/**
 * The append-only journal. This exists so a bookkeeper can answer "what
 * happened to order #1234" without leaving Shopify (PRD C-009), and so there
 * is an audit trail of every decision the connector or a human made.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const events = await recentEvents(session.shop, 250);

  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    events: events.map((e) => ({
      id: e.id,
      level: e.level,
      event: e.event,
      message: e.message,
      orderGid: e.orderGid,
      createdAt: e.createdAt.toISOString(),
    })),
  };
};

export default function JournalPage() {
  const { events, locale } = useLoaderData<typeof loader>();
  const t = makeT(locale);

  return (
    <Page
      title={t("journal.title")}
      subtitle={t("journal.subtitle")}
    >
      <Layout>
        <Layout.Section>
          {events.length === 0 ? (
            <Card>
              <EmptyState
                heading={t("journal.empty")}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{t("journal.empty.detail")}</p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <BlockStack gap="0">
                {events.map((e, index) => (
                  <Box
                    key={e.id}
                    padding="400"
                    borderBlockEndWidth={index === events.length - 1 ? "0" : "025"}
                    borderColor="border-secondary"
                  >
                    <BlockStack gap="150">
                      {/* wraps on narrow viewports rather than forcing horizontal scroll */}
                      <InlineStack gap="300" blockAlign="center">
                        <Text as="span" tone="subdued" variant="bodySm">
                          {new Date(e.createdAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB")}
                        </Text>
                        <Badge
                          tone={
                            e.level === "error"
                              ? "critical"
                              : e.level === "warn"
                                ? "attention"
                                : undefined
                          }
                        >
                          {e.event}
                        </Badge>
                        {e.orderGid && (
                          <Text as="span" tone="subdued" variant="bodySm">
                            {e.orderGid.split("/").pop()}
                          </Text>
                        )}
                      </InlineStack>
                      <Text
                        as="p"
                        tone={e.level === "error" ? "critical" : undefined}
                      >
                        {e.message}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
