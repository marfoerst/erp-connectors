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

/**
 * The append-only journal. This exists so a bookkeeper can answer "what
 * happened to order #1234" without leaving Shopify (PRD C-009), and so there
 * is an audit trail of every decision the connector or a human made.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const events = await recentEvents(session.shop, 250);

  return {
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
  const { events } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Journal"
      subtitle="Everything the connector did, newest first. Entries are never changed or removed."
    >
      <Layout>
        <Layout.Section>
          {events.length === 0 ? (
            <Card>
              <EmptyState
                heading="Nothing has happened yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Once Scopevisio is connected and sync is on, every booking and
                  every held document will be recorded here.
                </p>
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
                          {new Date(e.createdAt).toLocaleString("de-DE")}
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
