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
import {
  deleteConnection,
  getConnection,
  refreshStatus,
  saveConnection,
} from "../scopevisio/connection.server";
import { DEFAULT_BASE_URL } from "../scopevisio/constants";
import { encryptionKeyConfigured } from "../scopevisio/crypto.server";
import { refreshAllMasterData } from "../scopevisio/masterdata.server";

/**
 * PRD C-001 — the merchant connects Scopevisio themselves, from inside Shopify.
 * No config file, no developer, no support call.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);

  return {
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
    if (!customer) fieldErrors.customer = "Enter your Scopevisio customer number.";
    else if (!/^\d{7}$/.test(customer)) {
      fieldErrors.customer =
        "This is seven digits — you will find it in your Scopevisio customer portal.";
    }
    if (!username) fieldErrors.username = "Enter the user this app should sign in as.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) {
      fieldErrors.username = "Enter a valid e-mail address.";
    }
    if (!password) fieldErrors.password = "Enter the password for that user.";

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
  const { connection, keyConfigured } = useLoaderData<typeof loader>();
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
    if (!connection) return <Badge tone="new">Not connected</Badge>;
    if (connection.status === "connected") return <Badge tone="success">Connected</Badge>;
    if (connection.status === "error") return <Badge tone="critical">Needs attention</Badge>;
    return <Badge tone="attention">Unverified</Badge>;
  };

  return (
    <Page title="Scopevisio connection" subtitle="Where this app gets its accounting data">
      <Layout>
        {/* BFS 4.3.4 forbids stacking banners, so exactly one is shown: the
            result of what the merchant just did takes precedence over the
            standing connection warning. */}
        {actionData?.message ? (
          <Layout.Section>
            <Banner
              tone={actionData.ok ? "success" : "critical"}
              title={actionData.ok ? "Connected" : "Could not connect"}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        ) : connection?.status === "error" && connection.statusDetail ? (
          <Layout.Section>
            <Banner tone="warning" title="The connection stopped working">
              <p>{connection.statusDetail}</p>
              <p>
                Orders are queued while the connection is down — nothing is lost.
                Re-enter the password below to reconnect.
              </p>
            </Banner>
          </Layout.Section>
        ) : !keyConfigured ? (
          <Layout.Section>
            <Banner tone="critical" title="Credential encryption is not configured">
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
                    Scopevisio credentials
                  </Text>
                  {statusBadge()}
                </InlineStack>

                <Text as="p" tone="subdued">
                  These are the same credentials you use to sign in to
                  Scopevisio. They are encrypted before being stored, and once
                  Scopevisio issues a refresh token the password is deleted. You
                  can revoke access at any time from your Scopevisio customer
                  portal under Schnittstelle (OpenScope) → API Token.
                </Text>

                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Customer number"
                      name="customer"
                      value={customer}
                      onChange={setCustomer}
                      autoComplete="off"
                      helpText="Seven digits, from your Scopevisio customer portal."
                      maxLength={7}
                      error={fieldErrors.customer}
                    />
                    <TextField
                      label="Organisation (optional)"
                      name="organisation"
                      value={organisation}
                      onChange={setOrganisation}
                      autoComplete="off"
                      helpText="Leave blank — Scopevisio works it out from your customer number and user, and we show you which one it picked. Only fill this in if your user belongs to more than one organisation."
                    />
                  </FormLayout.Group>

                  <FormLayout.Group>
                    <TextField
                      label="User (e-mail)"
                      name="username"
                      type="email"
                      value={username}
                      onChange={setUsername}
                      autoComplete="off"
                      helpText="We recommend a dedicated integration user rather than a personal login."
                      error={fieldErrors.username}
                    />
                    <TextField
                      label="Password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="off"
                      error={fieldErrors.password}
                      helpText={
                        connection
                          ? "Leave blank only if you are not changing it — re-entering it re-authorises the connection."
                          : "Stored encrypted, then discarded once a refresh token is issued."
                      }
                    />
                  </FormLayout.Group>

                  <TextField
                    label="API base URL"
                    name="baseUrl"
                    value={baseUrl}
                    onChange={setBaseUrl}
                    autoComplete="off"
                    helpText="Only change this if Scopevisio has given you a different endpoint."
                  />
                </FormLayout>

                <input type="hidden" name="intent" value="save" />

                <InlineStack gap="300">
                  <Button submit variant="primary" loading={busy} disabled={!keyConfigured}>
                    {connection ? "Save and reconnect" : "Connect"}
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
                  Connection health
                </Text>
                <Text as="p" tone="subdued">
                  Last checked:{" "}
                  {connection.lastCheckAt
                    ? new Date(connection.lastCheckAt).toLocaleString("de-DE")
                    : "never"}
                </Text>
                <InlineStack gap="300">
                  <Form method="post">
                    <input type="hidden" name="intent" value="recheck" />
                    <Button submit loading={busy}>
                      Check now
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <Button submit tone="critical" variant="plain">
                      Disconnect
                    </Button>
                  </Form>
                </InlineStack>
                <Box paddingBlockStart="200">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Disconnecting stops all syncing. Documents already booked in
                    Scopevisio are untouched — they cannot be withdrawn, because
                    posted documents are immutable under GoBD.
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
                Which Scopevisio permissions does the connector need?
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                The connector user needs at least: Kontakte (Bearbeiten),
                Datenimport (Bearbeiten), Angebote/Aufträge/Lieferscheine/
                Rechnungen (Bearbeiten), and Stammdaten · Steuermatrix (Anzeigen).
                If a sync fails with a permissions error, the message will name
                the profile that is missing.
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
