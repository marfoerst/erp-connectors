import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { SaveBar } from "@shopify/app-bridge-react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  List,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import {
  getConnection,
  missingSettings,
  updateSettings,
} from "../scopevisio/connection.server";
import { getVatScopes, refreshAllMasterData } from "../scopevisio/masterdata.server";
import { checkReadiness } from "../scopevisio/readiness.server";
import { SCOPE_FIELDS, TAX_CASE_LABEL } from "../scopevisio/constants";

/**
 * PRD C-002 — the merchant reviews and sets the mapping before anything is
 * booked, and every choice is offered from their OWN Scopevisio master data.
 * Nothing here is a free-text identifier the merchant has to look up in
 * documentation.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);

  if (!connection) {
    return { connected: false as const };
  }

  let vatScopes: Array<{ caseId: number; caseName: string }> = [];
  let masterDataError: string | null = null;
  let stale = false;

  try {
    const res = await getVatScopes(session.shop);
    vatScopes = res.data.map((s) => ({ caseId: s.caseId, caseName: s.caseName }));
    stale = res.stale;
  } catch (err) {
    masterDataError =
      err instanceof Error ? err.message : "Could not read your Steuermatrix.";
  }

  const settings = connection.settings;

  // Probe the tenant's own master data now, rather than letting each order
  // discover the gaps one at a time (PRD R-005).
  let readiness = null;
  try {
    readiness = settings ? await checkReadiness(session.shop) : null;
  } catch {
    // A failed probe must not make the mapping page unusable.
  }

  return {
    connected: true as const,
    readiness,
    organisation: connection.organisation,
    vatScopes,
    masterDataError,
    stale,
    gaps: missingSettings(settings),
    settings: settings
      ? {
          syncEnabled: settings.syncEnabled,
          autoPost: settings.autoPost,
          customerGroup: settings.customerGroup,
          guestCustomerGroup: settings.guestCustomerGroup,
          numberRangeNumber: settings.numberRangeNumber,
          guestUseCpd: settings.guestUseCpd,
          vatScopeDomestic: settings.vatScopeDomestic,
          vatScopeEuB2c: settings.vatScopeEuB2c,
          vatScopeEuB2cOss: settings.vatScopeEuB2cOss,
          vatScopeEuB2bReverse: settings.vatScopeEuB2bReverse,
          vatScopeThirdCountry: settings.vatScopeThirdCountry,
          ossRegistered: settings.ossRegistered,
          homeCountry: settings.homeCountry,
          taxToleranceCents: settings.taxToleranceCents,
          copyVatFromProduct: settings.copyVatFromProduct,
          copyAccountsFromProduct: settings.copyAccountsFromProduct,
          documentTemplate: settings.documentTemplate,
          deliveryMode: settings.deliveryMode,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  try {
    if (intent === "refresh") {
      const result = await refreshAllMasterData(session.shop);
      return {
        ok: result.errors.length === 0,
        message: result.errors.length
          ? `Master data partly refreshed. ${result.errors.join("; ")}`
          : `Refreshed: ${result.vatScopes} tax cases, ${result.vatMatrix} matrix entries, ${result.revenueAccounts} revenue accounts.`,
      };
    }

    const num = (key: string) => {
      const raw = String(form.get(key) ?? "").trim();
      return raw === "" ? null : Number(raw);
    };
    const bool = (key: string) => form.get(key) === "on" || form.get(key) === "true";

    await updateSettings(session.shop, {
      syncEnabled: bool("syncEnabled"),
      autoPost: bool("autoPost"),
      customerGroup: String(form.get("customerGroup") ?? "Shopify").trim() || "Shopify",
      guestCustomerGroup:
        String(form.get("guestCustomerGroup") ?? "Shopify Guest").trim() ||
        "Shopify Guest",
      numberRangeNumber: num("numberRangeNumber"),
      guestUseCpd: bool("guestUseCpd"),
      vatScopeDomestic: num("vatScopeDomestic"),
      vatScopeEuB2c: num("vatScopeEuB2c"),
      vatScopeEuB2cOss: num("vatScopeEuB2cOss"),
      vatScopeEuB2bReverse: num("vatScopeEuB2bReverse"),
      vatScopeThirdCountry: num("vatScopeThirdCountry"),
      ossRegistered: bool("ossRegistered"),
      homeCountry:
        String(form.get("homeCountry") ?? "DE").trim().toUpperCase() || "DE",
      taxToleranceCents: num("taxToleranceCents") ?? 2,
      copyVatFromProduct: bool("copyVatFromProduct"),
      copyAccountsFromProduct: bool("copyAccountsFromProduct"),
      documentTemplate: String(form.get("documentTemplate") ?? "").trim() || null,
      deliveryMode: String(form.get("deliveryMode") ?? "csv") === "api" ? "api" : "csv",
    });

    return { ok: true, message: "Mapping saved." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not save the mapping.",
    };
  }
};

/**
 * Polaris `Checkbox` is a controlled component and does not reliably contribute
 * a value to a native form submission, so an unchecked box and a missing field
 * are indistinguishable — which silently wrote `false` over every boolean.
 * Pairing it with a hidden input makes the submitted value explicit either way.
 */
function BoolField({
  label,
  name,
  checked,
  onChange,
  helpText,
}: {
  label: string;
  name: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  helpText?: string;
}) {
  return (
    <>
      <input type="hidden" name={name} value={checked ? "true" : "false"} />
      <Checkbox label={label} checked={checked} onChange={onChange} helpText={helpText} />
    </>
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type ConnectedData = Extract<LoaderData, { connected: true }>;

/**
 * The guard lives in its own component so the editor's hooks are never called
 * conditionally — the editor only mounts once we know a connection exists.
 */
export default function MappingPage() {
  const data = useLoaderData<typeof loader>();

  if (!data.connected) {
    return (
      <Page title="Mapping">
        <Banner tone="warning" title="Connect Scopevisio first">
          <p>
            The mapping is built from your own Scopevisio master data, so the
            connection has to exist before it can be configured.
          </p>
        </Banner>
      </Page>
    );
  }

  return <MappingEditor data={data as ConnectedData} />;
}

function MappingEditor({ data }: { data: ConnectedData }) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);

  const s = data.settings;
  const [syncEnabled, setSyncEnabled] = useState(s?.syncEnabled ?? false);
  const [autoPost, setAutoPost] = useState(s?.autoPost ?? false);
  const [customerGroup, setCustomerGroup] = useState(s?.customerGroup ?? "Shopify");
  const [guestCustomerGroup, setGuestCustomerGroup] = useState(
    s?.guestCustomerGroup ?? "Shopify Guest",
  );
  const [numberRangeNumber, setNumberRangeNumber] = useState(
    s?.numberRangeNumber != null ? String(s.numberRangeNumber) : "",
  );
  const [guestUseCpd, setGuestUseCpd] = useState(s?.guestUseCpd ?? true);
  const [ossRegistered, setOssRegistered] = useState(s?.ossRegistered ?? false);
  const [homeCountry, setHomeCountry] = useState(s?.homeCountry ?? "DE");
  const [tolerance, setTolerance] = useState(String(s?.taxToleranceCents ?? 2));
  const [copyVat, setCopyVat] = useState(s?.copyVatFromProduct ?? true);
  const [copyAccounts, setCopyAccounts] = useState(s?.copyAccountsFromProduct ?? true);
  const [template, setTemplate] = useState(s?.documentTemplate ?? "");
  const [deliveryMode, setDeliveryMode] = useState(s?.deliveryMode ?? "csv");
  const [scopes, setScopes] = useState<Record<string, string>>(
    Object.fromEntries(
      SCOPE_FIELDS.map((f) => [
        f.field,
        (s as Record<string, unknown> | null)?.[f.field] != null
          ? String((s as Record<string, unknown>)[f.field])
          : "",
      ]),
    ),
  );

  /**
   * Built for Shopify 4.1.5: form inputs "should generally be saved using the
   * App Bridge Contextual Save Bar", and it is an explicit rejection reason if
   * a merchant can navigate away without interacting with it. So the save bar
   * is driven by whether the form actually differs from what was loaded.
   */
  const current = useMemo(
    () => ({
      syncEnabled,
      autoPost,
      customerGroup,
      guestCustomerGroup,
      numberRangeNumber,
      guestUseCpd,
      ossRegistered,
      homeCountry,
      tolerance,
      copyVat,
      copyAccounts,
      template,
      deliveryMode,
      scopes,
    }),
    [
      syncEnabled, autoPost, customerGroup, guestCustomerGroup,
      numberRangeNumber, guestUseCpd, ossRegistered, homeCountry, tolerance,
      copyVat, copyAccounts, template, deliveryMode, scopes,
    ],
  );

  const initial = useRef(current);
  const dirty = JSON.stringify(current) !== JSON.stringify(initial.current);

  useEffect(() => {
    const bar = document.getElementById("mapping-save-bar") as
      | (HTMLElement & { show?: () => void; hide?: () => void })
      | null;
    if (!bar) return;
    // App Bridge owns the bar; guard the calls so a non-embedded render (or an
    // older App Bridge) degrades to the plain form rather than throwing.
    try {
      if (dirty) bar.show?.();
      else bar.hide?.();
    } catch {
      /* not embedded */
    }
  }, [dirty]);

  // A successful save becomes the new baseline, which also hides the bar.
  useEffect(() => {
    if (actionData?.ok) initial.current = current;
  }, [actionData, current]);

  const onSave = useCallback(() => formRef.current?.requestSubmit(), []);

  const onDiscard = useCallback(() => {
    const i = initial.current;
    setSyncEnabled(i.syncEnabled);
    setAutoPost(i.autoPost);
    setCustomerGroup(i.customerGroup);
    setGuestCustomerGroup(i.guestCustomerGroup);
    setNumberRangeNumber(i.numberRangeNumber);
    setGuestUseCpd(i.guestUseCpd);
    setOssRegistered(i.ossRegistered);
    setHomeCountry(i.homeCountry);
    setTolerance(i.tolerance);
    setCopyVat(i.copyVat);
    setCopyAccounts(i.copyAccounts);
    setTemplate(i.template);
    setDeliveryMode(i.deliveryMode);
    setScopes(i.scopes);
  }, []);

  const scopeOptions = [
    { label: "— not configured —", value: "" },
    ...data.vatScopes.map((v) => ({
      label: `${v.caseName} (${v.caseId})`,
      value: String(v.caseId),
    })),
  ];

  return (
    <Page
      title="Mapping"
      subtitle={`How Shopify data becomes accounting data in ${data.organisation}`}
    >
      <SaveBar id="mapping-save-bar">
        <button variant="primary" onClick={onSave} disabled={busy} />
        <button onClick={onDiscard} disabled={busy} />
      </SaveBar>

      <Layout>
        {/* BFS 4.3.4 forbids two or more banners in close proximity, so the
            most actionable single message wins: what you just did, then a
            hard master-data failure, then the readiness gaps. */}
        {actionData?.message ? (
          <Layout.Section>
            <Banner tone={actionData.ok ? "success" : "critical"}>
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        ) : data.masterDataError ? (
          <Layout.Section>
            <Banner tone="critical" title="Could not read your Steuermatrix">
              <p>{data.masterDataError}</p>
              <p>
                The connector user probably lacks the &ldquo;Stammdaten &middot;
                Steuermatrix (Anzeigen)&rdquo; profile. Tax cases cannot be
                chosen until this works.
              </p>
            </Banner>
          </Layout.Section>
        ) : data.gaps.length > 0 ? (
          <Layout.Section>
            <Banner tone="warning" title="Not ready to sync yet">
              <List>
                {data.gaps.map((gap) => (
                  <List.Item key={gap}>{gap}</List.Item>
                ))}
              </List>
              {data.stale && (
                <p>
                  Master data shown is cached — Scopevisio could not be reached
                  just now. Refresh before relying on these choices.
                </p>
              )}
            </Banner>
          </Layout.Section>
        ) : data.stale ? (
          <Layout.Section>
            <Banner tone="warning">
              <p>
                Showing cached master data — Scopevisio could not be reached
                just now. Refresh below before relying on these choices.
              </p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Form method="post" ref={formRef}>
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Sync
                  </Text>
                  <BoolField
                    label="Send paid orders to Scopevisio"
                    name="syncEnabled"
                    checked={syncEnabled}
                    onChange={setSyncEnabled}
                    helpText="While this is off, orders are still recorded here but nothing reaches Scopevisio."
                  />
                  <BoolField
                    label="Post documents automatically"
                    name="autoPost"
                    checked={autoPost}
                    onChange={setAutoPost}
                    helpText="Leave this off to begin with. Invoices are then created and checked but left for you to post — posting cannot be undone."
                  />
                  {autoPost && (
                    <Banner tone="warning">
                      <p>
                        Posted documents are immutable under GoBD. A wrong
                        posting can only be corrected with a credit note, never
                        deleted. Turn this on once the review queue has been
                        empty for a while.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Customers
                  </Text>
                  <Text as="p" tone="subdued">
                    New customers are created in Scopevisio as debitors. Customer
                    groups are created automatically if they do not exist yet, so
                    you can name them whatever suits your reporting.
                  </Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Customer group (Kundengruppe)"
                        name="customerGroup"
                        value={customerGroup}
                        onChange={setCustomerGroup}
                        autoComplete="off"
                        helpText="For buyers with a Shopify account."
                      />
                      <TextField
                        label="Guest customer group"
                        name="guestCustomerGroup"
                        value={guestCustomerGroup}
                        onChange={setGuestCustomerGroup}
                        autoComplete="off"
                        helpText="For guest checkouts, so you can filter them out of your debitor master."
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <TextField
                        label="Debitor number range (Nummernkreis)"
                        name="numberRangeNumber"
                        type="number"
                        value={numberRangeNumber}
                        onChange={setNumberRangeNumber}
                        autoComplete="off"
                        helpText="Optional. Leave empty to use your default range."
                      />
                    </FormLayout.Group>
                    <BoolField
                      label="Book guests against a Conto pro Diverse account"
                      name="guestUseCpd"
                      checked={guestUseCpd}
                      onChange={setGuestUseCpd}
                      helpText="Recommended. The buyer's real name and address still appear on the document, but your debitor master does not fill up with one-off customers."
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Tax cases (Steuersachverhalte)
                  </Text>
                  <Text as="p" tone="subdued">
                    The connector does not calculate VAT. It decides which of
                    these cases an order falls into, then asks Scopevisio which
                    Erlöskonto and Steuerschlüssel your own Steuermatrix
                    prescribes for that case, destination and date. Any case left
                    unconfigured causes matching orders to be held rather than
                    guessed at.
                  </Text>

                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Your country of taxation"
                        name="homeCountry"
                        value={homeCountry}
                        onChange={(v) => setHomeCountry(v.toUpperCase())}
                        autoComplete="off"
                        maxLength={2}
                        helpText="Two-letter country code, e.g. DE."
                      />
                      <TextField
                        label="Tax comparison tolerance (cents)"
                        name="taxToleranceCents"
                        type="number"
                        value={tolerance}
                        onChange={setTolerance}
                        autoComplete="off"
                        helpText="How far Shopify's VAT and Scopevisio's may differ before an order is held. Rounding only."
                      />
                    </FormLayout.Group>

                    <BoolField
                      label="We are registered for OSS (or above the €10,000 EU threshold)"
                      name="ossRegistered"
                      checked={ossRegistered}
                      onChange={setOssRegistered}
                      helpText="Determines whether EU consumer sales carry your domestic VAT or the destination country's."
                    />

                    {SCOPE_FIELDS.map((f) => (
                      <Select
                        key={f.field}
                        label={TAX_CASE_LABEL[f.taxCase]}
                        name={f.field}
                        options={scopeOptions}
                        value={scopes[f.field] ?? ""}
                        onChange={(v) => setScopes((prev) => ({ ...prev, [f.field]: v }))}
                        helpText={f.help}
                        disabled={data.vatScopes.length === 0}
                      />
                    ))}
                  </FormLayout>

                  {data.vatScopes.length === 0 && !data.masterDataError && (
                    <Banner tone="warning">
                      <p>
                        No active tax cases were returned from your Scopevisio
                        organisation. Refresh the master data, or check that your
                        Steuermatrix is configured.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    How invoices reach Scopevisio
                  </Text>
                  <Select
                    label="Delivery"
                    name="deliveryMode"
                    options={[
                      { label: "CSV file, imported in Scopevisio (recommended)", value: "csv" },
                      { label: "Direct API import — not currently available", value: "api" },
                    ]}
                    value={deliveryMode}
                    onChange={setDeliveryMode}
                    helpText="CSV produces real Abrechnungsbelege that the Faktura module can send. You import one file per batch and map the columns once."
                  />
                  {deliveryMode === "api" && (
                    <Banner tone="critical" title="Direct import does not work yet">
                      <p>
                        Scopevisio&rsquo;s document-import endpoint accepts an XML
                        format that is not documented, and it rejects documents
                        silently. With this selected every order will be held
                        instead of delivered. Use CSV until that is resolved.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Documents
                  </Text>
                  <BoolField
                    label="Take the tax key and rate from the Scopevisio product master"
                    name="copyVatFromProduct"
                    checked={copyVat}
                    onChange={setCopyVat}
                    helpText="Recommended. Scopevisio then derives the Steuerschlüssel itself, which keeps one source of truth."
                  />
                  <BoolField
                    label="Take the revenue account from the Scopevisio product master"
                    name="copyAccountsFromProduct"
                    checked={copyAccounts}
                    onChange={setCopyAccounts}
                    helpText="Recommended, for the same reason."
                  />
                  <TextField
                    label="PDF template (optional)"
                    name="documentTemplate"
                    value={template}
                    onChange={setTemplate}
                    autoComplete="off"
                    helpText="Name of a Scopevisio export template, if you want a PDF generated with each invoice."
                  />
                </BlockStack>
              </Card>

              <input type="hidden" name="intent" value="save" />

              <InlineStack gap="300">
                <Button submit variant="primary" loading={busy}>
                  Save mapping
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Master data
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Tax cases and revenue accounts are read from your Scopevisio
                organisation and cached for 30 minutes. Refresh after changing
                your Steuermatrix so the choices above stay in step.
              </Text>
              {/* A separate form: forms cannot nest, and this is a different intent. */}
              <Form method="post">
                <input type="hidden" name="intent" value="refresh" />
                <Button submit loading={busy}>
                  Refresh master data from Scopevisio
                </Button>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        {data.readiness && data.readiness.rows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Will this actually book?
                  </Text>
                  <Badge tone={data.readiness.blockedCount === 0 ? "success" : "attention"}>
                    {`${data.readiness.readyCount} of ${data.readiness.rows.length} ready`}
                  </Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  Checked against your own Steuermatrix
                  {data.readiness.learnedFrom === "orders"
                    ? ", using the countries your orders actually ship to."
                    : ", using representative destinations until real orders arrive."}
                </Text>

                <BlockStack gap="300">
                  {data.readiness.rows.map((row) => (
                    <Box
                      key={row.taxCase}
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={row.ok ? "success" : "attention"}>
                            {row.ok ? "Ready" : "Will be held"}
                          </Badge>
                          <Text as="span" variant="headingSm">
                            {row.label}
                          </Text>
                          {row.scopeName && (
                            <Text as="span" tone="subdued" variant="bodySm">
                              {row.scopeName}
                            </Text>
                          )}
                        </InlineStack>

                        <Text as="span" tone="subdued" variant="bodySm">
                          {row.destinations
                            .map((d) =>
                              d.ok
                                ? `${d.country} → ${d.account} / ${d.vatKey}`
                                : `${d.country} → ${d.problem}`,
                            )
                            .join("  ·  ")}
                        </Text>

                        {row.advice && (
                          <Text as="p" variant="bodySm">
                            {row.advice}
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>

                <Text as="p" tone="subdued" variant="bodySm">
                  A case marked &ldquo;will be held&rdquo; is not a fault in the
                  connector — it means your Steuermatrix has nothing to book
                  those orders to, so they are held rather than booked wrongly.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Why VAT is not read from Shopify
                </Text>
                <Badge tone="info">Design note</Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                A 0% line in Shopify could be an intra-EU B2B supply, a
                third-country export, a reverse-charge supply or a small-business
                exemption. Those are four different Steuersachverhalte, four
                different UStVA lines and four different revenue accounts — the
                legal reason cannot be recovered from the number. So Shopify's
                calculated tax is only ever used as a cross-check before posting.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
