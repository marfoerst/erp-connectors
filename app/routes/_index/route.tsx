import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import styles from "./styles.module.css";

/**
 * The app's public landing page.
 *
 * Two App Store requirements shape this: apps "must not request the manual
 * entry of a myshopify.com URL or a shop's domain" — so there is no login form
 * — and listings "should only include factual information", so the template's
 * placeholder copy is gone. It makes no claims about outcomes.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify supplies ?shop=… when launching the embedded app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Scopevisio ERP for Shopify</h1>
        <p className={styles.text}>
          Books paid Shopify orders into Scopevisio: the customer becomes a
          contact and debitor, and the VAT treatment comes from your own
          Steuermatrix rather than being guessed at.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Customers become debitors</strong>. Each buyer is created as
            a Scopevisio contact with a debitor account, guests included, and
            never duplicated on a retry.
          </li>
          <li>
            <strong>VAT from your Steuermatrix</strong>. The connector
            determines the Steuersachverhalt, then asks Scopevisio which
            Erlöskonto and Steuerschlüssel apply for that destination and date.
          </li>
          <li>
            <strong>Nothing booked on a guess</strong>. When a tax case or an
            account cannot be resolved, the order is held with an explanation
            instead of being posted — a posted document cannot be withdrawn.
          </li>
        </ul>
        <p className={styles.text}>
          Install from the Shopify App Store and open it from Apps in your
          store&rsquo;s admin.
        </p>
      </div>
    </div>
  );
}
