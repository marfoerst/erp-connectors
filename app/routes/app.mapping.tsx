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
import { makeT, resolveLocale } from "../i18n";

/**
 * PRD C-002 — the merchant reviews and sets the mapping before anything is
 * booked, and every choice is offered from their OWN Scopevisio master data.
 * Nothing here is a free-text identifier the merchant has to look up in
 * documentation.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const connection = await getConnection(session.shop);

  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));

  if (!connection) {
    return { connected: false as const, locale };
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
      err instanceof Error ? err.message : "Steuermatrix";
  }

  const settings = connection.settings;

  return {
    connected: true as const,
    locale,
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

/** One shape so the component never has to narrow a union of action returns. */
interface MappingActionResult {
  ok: boolean;
  message?: string;
  readiness?: Awaited<ReturnType<typeof checkReadiness>>;
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<MappingActionResult> => {
  const { session } = await authenticate.admin(request);
  const t = makeT(resolveLocale(new URL(request.url).searchParams.get("locale")));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  try {
    if (intent === "readiness") {
      // Deliberately not in the loader: BFS 2.1.1 budgets LCP at 2.5s and this
      // makes several live ERP round-trips. Run it when asked, not on paint.
      const readiness = await checkReadiness(session.shop);
      return { ok: true, readiness };
    }

    if (intent === "refresh") {
      const result = await refreshAllMasterData(session.shop);
      return {
        ok: result.errors.length === 0,
        message: result.errors.length
          ? `${t("map.masterData")}: ${result.errors.join("; ")}`
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

    return { ok: true, message: t("map.saved") };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : t("map.saveFailed"),
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
      <Page title={makeT(data.locale)("map.title")}>
        <Banner tone="warning" title={makeT(data.locale)("map.needConnection")}>
          <p>{makeT(data.locale)("map.needConnection.detail")}</p>
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
  const t = makeT(data.locale);

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

  // A successful save becomes the new baseline, which also hides the bar.
  useEffect(() => {
    if (actionData?.ok) initial.current = current;
  }, [actionData, current]);

  const onSave = useCallback(() => formRef.current?.requestSubmit(), []);

  // Readiness arrives from an action, so it never delays first paint.
  const readiness = actionData?.readiness ?? null;

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
      title={t("map.title")}
      subtitle={t("map.subtitle", { org: data.organisation })}
    >
      {/* `open` is the documented API — the wrapper calls show()/hide() itself.
          Driving the element directly raced its mount effect, which hides. */}
      <SaveBar id="mapping-save-bar" open={dirty}>
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
            <Banner tone="critical" title={t("map.matrixError")}>
              <p>{data.masterDataError}</p>
              <p>
                {t("map.matrixError.detail")}
              </p>
            </Banner>
          </Layout.Section>
        ) : data.gaps.length > 0 ? (
          <Layout.Section>
            <Banner tone="warning" title={t("map.notReady")}>
              <List>
                {data.gaps.map((gap) => (
                  <List.Item key={gap}>{gap}</List.Item>
                ))}
              </List>
              {data.stale && (
                <p>
                  {t("map.stale")}
                </p>
              )}
            </Banner>
          </Layout.Section>
        ) : data.stale ? (
          <Layout.Section>
            <Banner tone="warning">
              <p>
                {t("map.stale")}
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
                    {t("map.sync")}
                  </Text>
                  <BoolField
                    label={t("map.sync.enable")}
                    name="syncEnabled"
                    checked={syncEnabled}
                    onChange={setSyncEnabled}
                    helpText={t("map.sync.enable.help")}
                  />
                  <BoolField
                    label={t("map.sync.autoPost")}
                    name="autoPost"
                    checked={autoPost}
                    onChange={setAutoPost}
                    helpText={t("map.sync.autoPost.help")}
                  />
                  {autoPost && (
                    <Banner tone="warning">
                      <p>
                        {t("map.sync.autoPost.warning")}
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("map.customers")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("map.customers.detail")}
                  </Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label={t("map.customers.group")}
                        name="customerGroup"
                        value={customerGroup}
                        onChange={setCustomerGroup}
                        autoComplete="off"
                        helpText={t("map.customers.group.help")}
                      />
                      <TextField
                        label={t("map.customers.guestGroup")}
                        name="guestCustomerGroup"
                        value={guestCustomerGroup}
                        onChange={setGuestCustomerGroup}
                        autoComplete="off"
                        helpText={t("map.customers.guestGroup.help")}
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <TextField
                        label={t("map.customers.range")}
                        name="numberRangeNumber"
                        type="number"
                        value={numberRangeNumber}
                        onChange={setNumberRangeNumber}
                        autoComplete="off"
                        helpText={t("map.customers.range.help")}
                      />
                    </FormLayout.Group>
                    <BoolField
                      label={t("map.customers.cpd")}
                      name="guestUseCpd"
                      checked={guestUseCpd}
                      onChange={setGuestUseCpd}
                      helpText={t("map.customers.cpd.help")}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("map.tax")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("map.tax.detail")}
                  </Text>

                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label={t("map.tax.homeCountry")}
                        name="homeCountry"
                        value={homeCountry}
                        onChange={(v) => setHomeCountry(v.toUpperCase())}
                        autoComplete="off"
                        maxLength={2}
                        helpText={t("map.tax.homeCountry.help")}
                      />
                      <TextField
                        label={t("map.tax.tolerance")}
                        name="taxToleranceCents"
                        type="number"
                        value={tolerance}
                        onChange={setTolerance}
                        autoComplete="off"
                        helpText={t("map.tax.tolerance.help")}
                      />
                    </FormLayout.Group>

                    <BoolField
                      label={t("map.tax.oss")}
                      name="ossRegistered"
                      checked={ossRegistered}
                      onChange={setOssRegistered}
                      helpText={t("map.tax.oss.help")}
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
                        {t("map.tax.noScopes")}
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("map.delivery")}
                  </Text>
                  <Select
                    label={t("map.delivery.label")}
                    name="deliveryMode"
                    options={[
                      { label: t("map.delivery.csv"), value: "csv" },
                      { label: t("map.delivery.api"), value: "api" },
                    ]}
                    value={deliveryMode}
                    onChange={setDeliveryMode}
                    helpText={t("map.delivery.help")}
                  />
                  {deliveryMode === "api" && (
                    <Banner tone="critical" title={t("map.delivery.apiWarning")}>
                      <p>
                        {t("map.delivery.apiWarning.detail")}
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    {t("map.documents")}
                  </Text>
                  <BoolField
                    label={t("map.documents.copyVat")}
                    name="copyVatFromProduct"
                    checked={copyVat}
                    onChange={setCopyVat}
                    helpText={t("map.documents.copyVat.help")}
                  />
                  <BoolField
                    label={t("map.documents.copyAccounts")}
                    name="copyAccountsFromProduct"
                    checked={copyAccounts}
                    onChange={setCopyAccounts}
                    helpText={t("map.documents.copyAccounts.help")}
                  />
                  <TextField
                    label={t("map.documents.template")}
                    name="documentTemplate"
                    value={template}
                    onChange={setTemplate}
                    autoComplete="off"
                    helpText={t("map.documents.template.help")}
                  />
                </BlockStack>
              </Card>

              <input type="hidden" name="intent" value="save" />

              <InlineStack gap="300">
                <Button submit variant="primary" loading={busy}>
                  {t("map.save")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("map.masterData")}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                {t("map.masterData.detail")}
              </Text>
              {/* Separate forms: forms cannot nest, and these are different
                  intents. Both are actions rather than loader work so the page
                  paints without waiting on the ERP (BFS 2.1.1). */}
              <InlineStack gap="300">
                <Form method="post">
                  <input type="hidden" name="intent" value="readiness" />
                  <Button submit loading={busy} variant="primary">
                    {t("map.readiness.run")}
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="refresh" />
                  <Button submit loading={busy}>
                    {t("map.masterData.refresh")}
                  </Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {readiness && readiness.rows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("map.readiness.title")}
                  </Text>
                  <Badge tone={readiness.blockedCount === 0 ? "success" : "attention"}>
                    {t("map.readiness.count", { ready: readiness.readyCount, total: readiness.rows.length })}
                  </Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  {readiness.learnedFrom === "orders"
                    ? t("map.readiness.fromOrders")
                    : t("map.readiness.fromDefaults")}
                </Text>

                <BlockStack gap="300">
                  {readiness.rows.map((row) => (
                    <Box
                      key={row.taxCase}
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={row.ok ? "success" : "attention"}>
                            {row.ok ? t("map.readiness.ready") : t("map.readiness.willHold")}
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
                  {t("map.readiness.footnote")}
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
                  {t("map.why.title")}
                </Text>
                <Badge tone="info">Info</Badge>
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
