# Listing screenshots

Six captures at 1568×773 px, German UI, rendered from the real Polaris
components with the strings from `app/i18n.ts`.

| File | Shows | Why it earns a slot |
|---|---|---|
| `1-uebersicht.png` | Overview: onboarding 2/3, the four counters, current mode, recent activity | Requirement 4.2.3 — the homepage must show whether the app is set up and working |
| `2-steuermatrix-pruefung.png` | Readiness report: Inland ready, FR and CH will be held, each with what to fix | The most distinctive thing the app does — no competitor tells you *in advance* which destinations your Steuermatrix can book |
| `3-auftrag-steuerabweichung.png` | A held order with Shopify 19,00 vs Scopevisio 0,00 side by side | Shows the app refusing to post rather than guessing |
| `4-export.png` | Three invoices ready, resolved account and tax key per order, plus the import steps | The delivery path, and that the hard work is already done |
| `5-steuersachverhalte.png` | Tax-case mapping with real Steuersachverhalte in the dropdowns | Proves the VAT comes from the tenant's own master data |
| `6-verbindung.png` | Connection screen, connected state | The whole setup is inside Shopify |

## Against the listing rules

- *"Images should primarily show your app's actual user interface"* — these are
  the actual components, no mockups.
- *"Screenshots should not include desktop backgrounds or browser windows"* —
  captured page-only, no chrome.
- *"Each image in your app listing must be unique"* — six different screens and
  states.
- *"Feature images and screenshots that solely contain your app logo are not
  permitted"* — none do.
- No pricing text anywhere, per the rule that pricing appears only in the
  Pricing section.

## How they were produced

`app/routes/screenshots.$view.tsx` is a **dev-only** harness (404 in
production). The embedded screens need a Shopify session and this environment
cannot reach `admin.shopify.com`, so the harness renders the same components
with representative data.

Consequence worth knowing: the captures show the app's own surface without the
surrounding Shopify admin frame — which the listing rules prefer anyway — and
they can drift if the real screens change. Regenerate rather than trust an old
capture:

```bash
npm run dev
# then visit /screenshots/{overview,connection,mapping,readiness,orders,export}
```

The data shown is representative, not from a live shop: order numbers, debitor
accounts (10052–10054) and the 8400/U19 pairing all match what the connector
actually produced against the test tenant, so nothing here is invented.
