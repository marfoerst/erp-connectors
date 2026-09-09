# Brand assets

## App icon

`app-icon-1200.png` — **upload this in the Partner Dashboard**, under the app's
App Store listing. Shopify's listing icon spec is 1200×1200 px PNG. The icon
lives in the listing, not in this repo; there is no `shopify.app.toml` field
for it, so it cannot be set from code.

`app-icon-256.png` is the unscaled original, kept as the source of truth.

The app's own pages use `public/favicon-32.png` and
`public/apple-touch-icon.png`, wired up in `app/root.tsx`.

### Compliance check against the icon rules

| Rule | Result |
|---|---|
| "Do not use our trademarks in your app icon" | Pass — no Shopify marks |
| "Do not include pricing information in ... your app icon" | Pass |
| BFS 4.3.5 — must not resemble a first-party Shopify app icon | Pass — Shopify's are a green shopping bag; this is the yellow Scopevisio mark |
| BFS 4.3.5 — no Sidekick icon, no "magic purple" | Pass |
| Every app must have "a unique, recognizable name that leads with your distinctive brand identifier" | Pass — the icon carries the Scopevisio S, and the app is named "Scopevisio ERP" |

### ⚠️ One quality issue

**The source is only 256×256.** `app-icon-1200.png` is an upscale, so it will
look soft next to competitors' icons in the App Store listing — where the icon
is one of the few things a merchant judges before installing.

Ask the brand team for the original vector (SVG/AI) or a ≥1200 px export and
regenerate:

```bash
sips -s format png -z 1200 1200 <source> --out assets/app-icon-1200.png
```
