declare module "*.css";

/**
 * App Bridge web components.
 *
 * Built for Shopify 4.1.4 requires the app's primary navigation to use
 * `s-app-nav`. The current App Bridge runtime (loaded from
 * cdn.shopify.com/shopifycloud/app-bridge.js in app/root.tsx) defines it, but
 * `@shopify/app-bridge-react`'s `NavMenu` still renders the older
 * `ui-nav-menu`, so the element is used directly and declared here.
 */
declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
