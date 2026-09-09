import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  BlockStack,
  Card,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

/**
 * App Store requirement: "Apps must be installed and initiated only on Shopify
 * services. Your app must not request the manual entry of a myshopify.com URL
 * or a shop's domain."
 *
 * The template shipped a shop-domain form here, which violates that. The route
 * still exists because the Shopify library routes here when a `shop` parameter
 * is missing, and `login()` still handles the parameter when it IS present —
 * but nothing asks the merchant to type a domain.
 */

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Honours ?shop=… when Shopify supplies it; renders guidance when it doesn't.
  const errors = loginErrorMessage(await login(request));

  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function Auth() {
  const { polarisTranslations: i18n } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={i18n}>
      <Page>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              Open this app from your Shopify admin
            </Text>
            <Text as="p" tone="subdued">
              Scopevisio ERP runs inside the Shopify admin. Install it from the
              Shopify App Store, then open it from Apps in your store&rsquo;s
              admin — there is nothing to sign in to here.
            </Text>
            <Link url="https://apps.shopify.com/" target="_blank">
              Go to the Shopify App Store
            </Link>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
