# Shopware and the DACH platform landscape

## Shopware 6 — how close it is to Shopify

Apps are **externally-hosted web services**, exactly like Shopify apps. Shopware
communicates only over HTTP, so the stack is ours; only `manifest.xml` has to be
discoverable. Apps work on self-hosted *and* Cloud, where plugins cannot.

- **Embedded admin UI** exists: `@shopware-ag/admin-extension-sdk`, iframes into
  named "locations", conceptually App Bridge with a different API surface. UI is
  a rewrite, not a port.
- **Auth** is a custom mutual-HMAC registration handshake, then OAuth2
  client-credentials for Admin API calls. Official `shopware/app-sdk-js`
  implements the handshake.
- **`state_enter.order_transaction.state.paid`** is the direct equivalent of
  Shopify's `orders/paid`. Also `.refunded`, `.cancelled`, `.authorized`, and
  `checkout.order.placed`.
- **Private/custom apps need no Store review at all**, on self-hosted or Cloud.

Estimate at the time: 1–2 weeks backend for someone who had built the Shopify
app, plus the UI rewrite. **This proved accurate** — see `docs/SHOPWARE-FINDINGS.md`.

Not public: Shopware Store commission percentage, and review turnaround SLA.

## Other DACH platforms

| Platform | API | Auth | Notes |
|---|---|---|---|
| JTL | REST + GraphQL (ERP-centric) | OAuth2 for the Cloud API; WaWi REST auth unconfirmed | JTL-Wawi *is* the ERP, so the integration shape inverts |
| plentymarkets | REST, documented | OAuth2 client credentials | Webhooks exist; canonical event names not found |
| OXID eSales | OXAPI (GraphQL) + legacy REST | unconfirmed | Self-hosted PHP modules; ~0.02% global share, niche |
| WooCommerce | REST v3 | consumer key/secret | No approval gate; no payment-specific webhook topic |

## Market sizing — two different truths

- **Germany's top 1,000 B2C shops:** Shopware has led for four consecutive years
  (EHI × ecommerceDB). Last figure confidently retrieved: 12.2% (2023).
- **SMB / active shops** (Uptain, >3,000 German shops): Shopify 31.7%,
  Shopware 25.7%, JTL 14.0%, plentymarkets 8.8%, WooCommerce 6.2%.

So Shopware leads B2B mid-market, Shopify leads SMB. Figures vary several points
across studies; treat as direction, not measurement. BuiltWith numbers could not
be retrieved (JS-rendered).

## Marketplaces, as an inbound source

- **Amazon SP-API** — OAuth via Login with Amazon; restricted roles need an
  architecture review by Amazon. Push notifications available (ORDER_CHANGE).
- **OTTO Market** — heaviest gate found: Service Partner → sandbox → mandatory
  **private-app pilot** → only then a public app. Orders appear pull-only.
- **Kaufland** — HMAC key auth, OpenAPI, public sandbox. No documented approval
  gate found either way.
