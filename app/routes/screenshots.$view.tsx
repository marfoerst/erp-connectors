import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineGrid,
  InlineStack,
  Layout,
  List,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisDe from "@shopify/polaris/locales/de.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { makeT } from "../i18n";

/**
 * Screenshot harness for the App Store listing.
 *
 * The embedded screens cannot be captured directly: they require a Shopify
 * session, and this environment cannot reach admin.shopify.com. So this route
 * renders the same Polaris components with the same German strings from
 * `app/i18n.ts` and representative data, with no authentication.
 *
 * It is DEV-ONLY and returns 404 in production. It exists to produce listing
 * imagery, not as a product surface — Shopify's listing rules ask for
 * screenshots that "primarily show your app's actual user interface", which is
 * what this renders.
 *
 * If the real screens change, these will drift. Regenerate rather than trust
 * an old capture.
 */

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }
  return { view: params.view ?? "overview" };
};

const t = makeT("de");

function Stat({ label, value, tone }: { label: string; value: string; tone?: "critical" | "success" }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="heading2xl" tone={tone}>{value}</Text>
      </BlockStack>
    </Card>
  );
}

function Overview() {
  const steps = [
    { label: t("overview.onboarding.step1"), detail: t("overview.onboarding.step1.detail"), done: true },
    { label: t("overview.onboarding.step2"), detail: t("overview.onboarding.step2.detail"), done: true },
    { label: t("overview.onboarding.step3"), detail: t("overview.onboarding.step3.detail"), done: false },
  ];
  return (
    <Page title={t("overview.title")} subtitle={t("overview.subtitle.connected", { org: "Simplify AG" })}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("overview.onboarding.title")}</Text>
                <Badge tone="attention">{t("overview.onboarding.progress", { done: 2 })}</Badge>
              </InlineStack>
              <BlockStack gap="300">
                {steps.map((s, i) => (
                  <InlineStack key={s.label} gap="300" blockAlign="start">
                    <Badge tone={s.done ? "success" : undefined}>
                      {s.done ? t("overview.step.done") : String(i + 1)}
                    </Badge>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd">{s.label}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{s.detail}</Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
              <Box><Button variant="primary">{t("overview.onboarding.step3")}</Button></Box>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <Stat label={t("overview.stat.booked")} value="128" tone="success" />
            <Stat label={t("overview.stat.attention")} value="2" tone="critical" />
            <Stat label={t("overview.stat.toExport")} value="6" />
            <Stat label={t("overview.stat.awaiting")} value="0" />
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("overview.mode.title")}</Text>
                <InlineStack gap="200">
                  <Badge tone="success">{t("overview.mode.syncOn")}</Badge>
                  <Badge tone="info">{t("overview.mode.manualPost")}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">{t("overview.mode.manualPost.detail")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("overview.activity.title")}</Text>
              <BlockStack gap="200">
                {[
                  ["09.09.2026, 08:14:22", "Auftrag #1042 gebucht als Rechnung RE-2026-118."],
                  ["09.09.2026, 08:11:05", "Scopevisio-Kontakt 101044 angelegt."],
                  ["09.09.2026, 07:58:40", "6 Rechnung(en) als Stapel B-2026-09-09-a41f exportiert."],
                ].map(([when, msg]) => (
                  <BlockStack key={when} gap="050">
                    <Text as="span" tone="subdued" variant="bodySm">{when}</Text>
                    <Text as="span" variant="bodySm">{msg}</Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

const SCOPE_OPTIONS = [
  { label: "— nicht konfiguriert —", value: "" },
  { label: "Inland (1)", value: "1" },
  { label: "Drittland (2)", value: "2" },
  { label: "IG Lieferung an Unternehmer mit USt-ID (16)", value: "16" },
  { label: "IG Leistung an Unternehmer mit USt-ID (17)", value: "17" },
];

function Mapping() {
  return (
    <Page title={t("map.title")} subtitle={t("map.subtitle", { org: "Simplify AG" })}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("map.tax")}</Text>
              <Text as="p" tone="subdued">{t("map.tax.detail")}</Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label={t("map.tax.homeCountry")} value="DE" autoComplete="off"
                    helpText={t("map.tax.homeCountry.help")} onChange={() => {}} />
                  <TextField label={t("map.tax.tolerance")} value="2" type="number" autoComplete="off"
                    helpText={t("map.tax.tolerance.help")} onChange={() => {}} />
                </FormLayout.Group>
                <Checkbox label={t("map.tax.oss")} checked={false} onChange={() => {}}
                  helpText={t("map.tax.oss.help")} />
                <Select label="Inland" options={SCOPE_OPTIONS} value="1" onChange={() => {}}
                  helpText="Aufträge innerhalb Ihres Landes der Besteuerung." />
                <Select label="EU B2B — Reverse Charge" options={SCOPE_OPTIONS} value="16" onChange={() => {}}
                  helpText="Unternehmen in anderen EU-Staaten mit geprüfter USt-IdNr." />
                <Select label="Drittlandsexport" options={SCOPE_OPTIONS} value="2" onChange={() => {}}
                  helpText="Lieferungen außerhalb der EU — in der Regel steuerfrei." />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Readiness() {
  const rows = [
    { ok: true, label: "Inland", scope: "Inland", dest: "DE → 8400 / U19" },
    { ok: false, label: "EU B2B — Reverse Charge", scope: "IG Lieferung an Unternehmer mit USt-ID",
      dest: "FR → kein aktives Erlöskonto",
      advice: "Ihre Steuermatrix enthält kein aktives Erlöskonto für „IG Lieferung an Unternehmer mit USt-ID“ und FR. Bitte in Scopevisio anlegen, sonst werden Aufträge in dieses Land zurückgehalten." },
    { ok: false, label: "Drittlandsexport", scope: "Drittland",
      dest: "CH → kein aktives Erlöskonto",
      advice: "Ihre Steuermatrix enthält kein aktives Erlöskonto für „Drittland“ und CH. Bitte in Scopevisio anlegen." },
  ];
  return (
    <Page title={t("map.title")} subtitle={t("map.subtitle", { org: "Simplify AG" })}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("map.readiness.title")}</Text>
                <Badge tone="attention">{t("map.readiness.count", { ready: 1, total: 3 })}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">{t("map.readiness.fromOrders")}</Text>
              <BlockStack gap="300">
                {rows.map((r) => (
                  <Box key={r.label} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="150">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={r.ok ? "success" : "attention"}>
                          {r.ok ? t("map.readiness.ready") : t("map.readiness.willHold")}
                        </Badge>
                        <Text as="span" variant="headingSm">{r.label}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{r.scope}</Text>
                      </InlineStack>
                      <Text as="span" tone="subdued" variant="bodySm">{r.dest}</Text>
                      {r.advice && <Text as="p" variant="bodySm">{r.advice}</Text>}
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
              <Text as="p" tone="subdued" variant="bodySm">{t("map.readiness.footnote")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Orders() {
  return (
    <Page title={t("orders.title")} subtitle={t("orders.subtitle", { booked: 128, waiting: 2, declined: 1 })}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">#1043</Text>
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="attention">Shopify und Scopevisio weichen bei der Steuer ab</Badge>
                <Badge>FR</Badge>
              </InlineStack>
              <Text as="p">
                Shopify hat 19,00 Umsatzsteuer berechnet, Scopevisio 0,00 für den Fall
                „EU B2B — Reverse Charge“ in FR. Beleg RE-2026-119 wurde angelegt, aber
                NICHT gebucht. Bitte die Abweichung klären und dann in Scopevisio buchen
                oder hier akzeptieren.
              </Text>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <InlineStack gap="500">
                  {[[t("orders.tax.shopify"), "19,00"], [t("orders.tax.erp"), "0,00"]].map(([l, v]) => (
                    <BlockStack key={l} gap="050">
                      <Text as="span" tone="subdued" variant="bodySm">{l}</Text>
                      <Text as="span" variant="headingSm">{v}</Text>
                    </BlockStack>
                  ))}
                  <BlockStack gap="050">
                    <Text as="span" tone="subdued" variant="bodySm">{t("orders.tax.diff")}</Text>
                    <Text as="span" variant="headingSm" tone="critical">−19,00</Text>
                  </BlockStack>
                </InlineStack>
              </Box>
              <InlineStack gap="300">
                <Button>{t("orders.retry")}</Button>
                <Button variant="plain" tone="critical">{t("orders.decline")}</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Export() {
  const rows = [
    ["#1044", "DE · Debitor 10052 · Konto 8400 · U19"],
    ["#1045", "DE · Debitor 10053 · Konto 8400 · U19"],
    ["#1046", "DE · Debitor 10054 · Konto 8400 · U19"],
  ];
  return (
    <Page title={t("export.title")} subtitle={t("export.subtitle", { org: "Simplify AG" })}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("export.ready", { n: 3 })}</Text>
                <Badge tone="success">{t("export.vatResolved")}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">{t("export.ready.detail")}</Text>
              <BlockStack gap="150">
                {rows.map(([name, detail]) => (
                  <BlockStack key={name} gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="medium">{name}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">{detail}</Text>
                  </BlockStack>
                ))}
              </BlockStack>
              <Box><Button variant="primary">{t("export.download", { n: 3 })}</Button></Box>
              <Text as="p" tone="subdued" variant="bodySm">{t("export.download.note")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">{t("export.how")}</Text>
              <List type="number">
                <List.Item>{t("export.how.1")}</List.Item>
                <List.Item>{t("export.how.2")}</List.Item>
                <List.Item>{t("export.how.3")}</List.Item>
                <List.Item>{t("export.how.4")}</List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Connection() {
  return (
    <Page title={t("conn.title")} subtitle={t("conn.subtitle")}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("conn.credentials")}</Text>
                <Badge tone="success">{t("conn.status.connected")}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">{t("conn.credentials.detail")}</Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label={t("conn.field.customer")} value="2039915" autoComplete="off"
                    helpText={t("conn.field.customer.help")} onChange={() => {}} />
                  <TextField label={t("conn.field.organisation")} value="Simplify AG" autoComplete="off"
                    helpText={t("conn.field.organisation.help")} onChange={() => {}} />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label={t("conn.field.username")} value="buchhaltung@example.de"
                    autoComplete="off" helpText={t("conn.field.username.help")} onChange={() => {}} />
                  <TextField label={t("conn.field.password")} type="password" value="••••••••••"
                    autoComplete="off" helpText={t("conn.field.password.help.existing")} onChange={() => {}} />
                </FormLayout.Group>
              </FormLayout>
              <InlineStack gap="300">
                <Button variant="primary">{t("conn.submit.existing")}</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">{t("conn.profiles.title")}</Text>
              <Text as="p" tone="subdued" variant="bodySm">{t("conn.profiles.detail")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

const VIEWS: Record<string, () => JSX.Element> = {
  overview: Overview,
  connection: Connection,
  mapping: Mapping,
  readiness: Readiness,
  orders: Orders,
  export: Export,
};

export default function Screenshot() {
  const { view } = useLoaderData<typeof loader>();
  const Component = VIEWS[view] ?? Overview;

  return (
    <PolarisAppProvider i18n={polarisDe}>
      <Box background="bg-surface-secondary" padding="600">
        <Component />
      </Box>
    </PolarisAppProvider>
  );
}
