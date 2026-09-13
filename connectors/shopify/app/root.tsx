import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";

/**
 * Built for Shopify 3.1.1 requires the app to be embedded "using the latest
 * version of Shopify App Bridge by adding the `app-bridge.js` script tag to
 * the `<head>` of every document" — hence a root loader for the API key rather
 * than relying on the React package alone.
 *
 * This is also what makes BFS section 2.1 measurable at all: LCP, CLS and INP
 * are gathered through App Bridge, and each needs 100+ samples over 28 days.
 * Without the tag those metrics never populate and the app cannot qualify.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* App Bridge reads the key from this meta tag. */}
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        {/* Scopevisio icon for the app's own pages. The Shopify App Store
            listing icon is uploaded separately in the Partner Dashboard —
            see assets/app-icon-1200.png. */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
