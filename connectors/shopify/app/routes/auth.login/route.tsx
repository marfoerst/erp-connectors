import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  BlockStack,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

/**
 * Reached only when the Shopify library routes here without a `shop` parameter.
 *
 * The template shipped a shop-domain form here. It was removed because asking a
 * merchant to type their own domain is a phishing-shaped habit — an App Store
 * rule originally, but the reasoning does not depend on the distribution type,
 * so it stays for a custom app too. `login()` still handles the parameter when
 * it IS present; nothing asks anyone to type a domain.
 *
 * There is deliberately no link out to apps.shopify.com: a custom app has no
 * App Store page. It is installed once, from a link issued by Scopevisio.
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
              Scopevisio ERP runs inside the Shopify admin. Open it from Apps in
              your store&rsquo;s admin — there is nothing to sign in to here.
            </Text>
            <Text as="p" tone="subdued">
              If it is not installed yet, use the install link supplied by
              Scopevisio.
            </Text>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
