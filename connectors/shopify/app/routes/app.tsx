import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisDe from "@shopify/polaris/locales/de.json";
import polarisEn from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import { makeT, resolveLocale } from "../i18n";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Shopify passes the merchant's admin language as `locale`. German is the
  // default because every user of this app is a German-market bookkeeper.
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));

  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale };
};

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const t = makeT(locale);

  return (
    // Polaris has its own translations for built-in component labels
    // (pagination, "Clear", sort controls) — without this they stay English
    // inside an otherwise German UI.
    <AppProvider
      isEmbeddedApp
      apiKey={apiKey}
      i18n={locale === "de" ? polarisDe : polarisEn}
    >
      {/* BFS 4.1.4: primary navigation must use App Bridge `s-app-nav` so it
          renders in the Shopify admin menu rather than as separate in-app
          navigation. The first link is the app home. */}
      <s-app-nav>
        <Link to="/app" rel="home">
          {t("nav.overview")}
        </Link>
        <Link to="/app/connection">{t("nav.connection")}</Link>
        <Link to="/app/mapping">{t("nav.mapping")}</Link>
        <Link to="/app/orders">{t("nav.orders")}</Link>
        <Link to="/app/export">{t("nav.export")}</Link>
        <Link to="/app/journal">{t("nav.journal")}</Link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
