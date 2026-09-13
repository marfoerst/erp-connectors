import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Banner,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { makeT, resolveLocale } from "../i18n";
import {
  deleteConnection,
  getConnection,
  refreshStatus,
  saveConnection,
} from "../scopevisio/connection.server";
import { DEFAULT_BASE_URL , encryptionKeyConfigured } from "@erp/scopevisio-core";
import { refreshAllMasterData } from "../scopevisio/masterdata.server";

/**
 * PRD C-001 — the merchant connects Scopevisio themselves, from inside Shopify.
 * No config file, no developer, no support call.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);

  return {
    locale: resolveLocale(new URL(request.url).searchParams.get("locale")),
    keyConfigured: encryptionKeyConfigured(),
    connection: connection
      ? {
          baseUrl: connection.baseUrl,
          customer: connection.customer,
          organisation: connection.organisation,
          username: connection.username,
          status: connection.status,
          statusDetail: connection.statusDetail,
          lastCheckAt: connection.lastCheckAt?.toISOString() ?? null,
        }
      : null,
  };
};

/** One shape, so the component does not have to narrow a union of returns. */
interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  master?: {
    vatScopes: number | null;
    vatMatrix: number | null;
    revenueAccounts: number | null;
    errors: string[];
  };
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const t = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  try {
    if (intent === "disconnect") {
      await deleteConnection(session.shop);
      return { ok: true, message: "Scopevisio connection removed." };
    }

    if (intent === "recheck") {
      const conn = await refreshStatus(session.shop);
      return conn?.status === "connected"
        ? { ok: true, message: "Connection is healthy." }
        : { ok: false, message: conn?.statusDetail ?? "Connection failed." };
    }

    const customer = String(form.get("customer") ?? "").trim();
    const organisation = String(form.get("organisation") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const baseUrl = String(form.get("baseUrl") ?? DEFAULT_BASE_URL).trim();

    /**
     * Built for Shopify 4.2.4: errors should "appear next to relevant fields
     * when possible", and a contextual error shown only as a page banner is an
     * explicit rejection reason. So validation returns per-field messages.
     * organisation is intentionally absent — the token endpoint resolves it.
     */
    const fieldErrors: Record<string, string> = {};
    if (!customer) fieldErrors.customer = t("conn.field.customer.required");
    else if (!/^\d{7}$/.test(customer)) {
      fieldErrors.customer = t("conn.field.customer.format");
    }
    if (!username) fieldErrors.username = t("conn.field.username.required");
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) {
      fieldErrors.username = t("conn.field.username.format");
    }
    if (!password) fieldErrors.password = t("conn.field.password.required");

    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, fieldErrors };
    }

    await saveConnection(session.shop, {
      baseUrl,
      customer,
      organisation,
      username,
      password,
    });

    // Warm the master-data cache so the Mapping screen has real choices ready.
    const master = await refreshAllMasterData(session.shop);

    return {
      ok: true,
      message: "Connected to Scopevisio.",
      master,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not connect to Scopevisio.",
    };
  }
};

export default function ConnectionPage() {
  const { connection, keyConfigured, locale } = useLoaderData<typeof loader>();
  const t = makeT(locale);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  // Errors only exist after a submit, so fields never show an error before the
  // merchant has interacted with them (BFS 4.2.4).
  const fieldErrors: Record<string, string> = actionData?.fieldErrors ?? {};

  const [customer, setCustomer] = useState(connection?.customer ?? "");
  const [organisation, setOrganisation] = useState(connection?.organisation ?? "");
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? DEFAULT_BASE_URL);

  const statusBadge = () => {
    if (!connection) return <Badge tone="new">{t("conn.status.notConnected")}</Badge>;
    if (connection.status === "connected") return <Badge tone="success">{t("conn.status.connected")}</Badge>;
    if (connection.status === "error") return <Badge tone="critical">{t("conn.status.error")}</Badge>;
    return <Badge tone="attention">{t("conn.status.unverified")}</Badge>;
  };

  return (
    <Page title={t("conn.title")} subtitle={t("conn.subtitle")}>
      <Layout>
        {/* BFS 4.3.4 forbids stacking banners, so exactly one is shown: the
            result of what the merchant just did takes precedence over the
            standing connection warning. */}
        {actionData?.message ? (
          <Layout.Section>
            <Banner
              tone={actionData.ok ? "success" : "critical"}
              title={actionData.ok ? t("conn.ok.title") : t("conn.error.title")}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        ) : connection?.status === "error" && connection.statusDetail ? (
          <Layout.Section>
            <Banner tone="warning" title={t("conn.broken.title")}>
              <p>{connection.statusDetail}</p>
              <p>{t("conn.broken.detail")}</p>
            </Banner>
          </Layout.Section>
        ) : !keyConfigured ? (
          <Layout.Section>
            <Banner tone="critical" title={t("conn.key.title")}>
              <p>
                <code>SCOPEVISIO_ENCRYPTION_KEY</code> is not set, so credentials
                cannot be stored safely. Generate one with{" "}
                <code>openssl rand -base64 32</code> and add it to the app&rsquo;s
                environment before connecting.
              </p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("conn.credentials")}
                  </Text>
                  {statusBadge()}
                </InlineStack>

                <Text as="p" tone="subdued">
                  {t("conn.credentials.detail")}
                </Text>

                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label={t("conn.field.customer")}
                      name="customer"
                      value={customer}
                      onChange={setCustomer}
                      autoComplete="off"
                      helpText={t("conn.field.customer.help")}
                      maxLength={7}
                      error={fieldErrors.customer}
                    />
                    <TextField
                      label={t("conn.field.organisation")}
                      name="organisation"
                      value={organisation}
                      onChange={setOrganisation}
                      autoComplete="off"
                      helpText={t("conn.field.organisation.help")}
                    />
                  </FormLayout.Group>

                  <FormLayout.Group>
                    <TextField
                      label={t("conn.field.username")}
                      name="username"
                      type="email"
                      value={username}
                      onChange={setUsername}
                      autoComplete="off"
                      helpText={t("conn.field.username.help")}
                      error={fieldErrors.username}
                    />
                    <TextField
                      label={t("conn.field.password")}
                      name="password"
                      type="password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="off"
                      error={fieldErrors.password}
                      helpText={
                        connection
                          ? t("conn.field.password.help.existing")
                          : t("conn.field.password.help.new")
                      }
                    />
                  </FormLayout.Group>

                  <TextField
                    label={t("conn.field.baseUrl")}
                    name="baseUrl"
                    value={baseUrl}
                    onChange={setBaseUrl}
                    autoComplete="off"
                    helpText={t("conn.field.baseUrl.help")}
                  />
                </FormLayout>

                <input type="hidden" name="intent" value="save" />

                <InlineStack gap="300">
                  <Button submit variant="primary" loading={busy} disabled={!keyConfigured}>
                    {connection ? t("conn.submit.existing") : t("conn.submit.new")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        {connection && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("conn.health")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("conn.health.lastCheck", {
                    when: connection.lastCheckAt
                      ? new Date(connection.lastCheckAt).toLocaleString(locale === "de" ? "de-DE" : "en-GB")
                      : t("conn.health.never"),
                  })}
                </Text>
                <InlineStack gap="300">
                  <Form method="post">
                    <input type="hidden" name="intent" value="recheck" />
                    <Button submit loading={busy}>
                      {t("conn.health.check")}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <Button submit tone="critical" variant="plain">
                      {t("conn.health.disconnect")}
                    </Button>
                  </Form>
                </InlineStack>
                <Box paddingBlockStart="200">
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("conn.health.disconnect.detail")}
                  </Text>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("conn.profiles.title")}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                {t("conn.profiles.detail")}
              </Text>
              <Link
                url="https://help.scopevisio.com/de/articles/467358-rest-api-erste-schritte"
                target="_blank"
                removeUnderline
              >
                Scopevisio REST API — getting started
              </Link>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
