# Built for Shopify — compliance assessment

Assessed 2026-09-09 against
<https://shopify.dev/docs/apps/launch/built-for-shopify/requirements>.

Legend: **✅ done** · **⏳ needs live merchants or time** · **📋 a decision or an
action outside the codebase** · **n/a**

**No ⚠️ items remain: every requirement that can be satisfied in code is
satisfied.** What is left needs a Partner-account action, a listing decision, or
merchants.

BFS status is granted only when *every* prerequisite is met, and the criteria
are re-evaluated continuously — so this is a standing checklist, not a
one-time gate.

---

## 1. Prerequisites

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1.1.1 | Meet App Store requirements | 📋 | Code side is done: mandatory compliance webhooks, OAuth/session tokens, no theme writes. Outstanding items are all account/listing actions — privacy policy URL, support contact, listing content, and the Billing API if the app is paid (OQ-7) |
| 1.1.2 | Good Partner standing | 📋 | Nothing in the code affects this |
| 1.2.1 | **50 net installs** from active shops on paid plans | ⏳ | Cannot be engineered |
| 1.2.2 | **5 reviews** | ⏳ | " |
| 1.2.3 | Minimum recent app rating | ⏳ | " |

**These three gate everything.** No amount of code quality substitutes for 50
paying installs, so BFS is a post-launch goal — the work below is what makes it
*achievable* once the app is live, not what earns it today.

## 2. Performance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 2.1.1 | LCP ≤ **2.5 s** (p75, ≥100 samples/28 d) | ⏳ | Now *measurable*: the `app-bridge.js` tag was missing, so no metric was being collected at all. Added in `app/root.tsx`. **No loader makes a live ERP call** — the readiness probe was moved to an action for exactly this reason |
| 2.1.2 | CLS ≤ **0.1** | ⏳ | Polaris cards give a stable layout, and no page defers content into place after paint |
| 2.1.3 | INP ≤ **200 ms** | ⏳ | Every interaction is a form post or a link; no heavy client-side work |
| 2.2.1 | Storefront Lighthouse impact ≤ 10 points | ✅ n/a | The app adds nothing to the storefront — no script tags, no theme assets |
| 2.3.1 | Checkout p95 ≤ 500 ms, ≤0.1% failures | ✅ n/a | Not in the checkout path |

**Resolved:** `checkReadiness()` used to run in the Mapping loader — several
live ERP round-trips before first paint, which is how an LCP budget gets blown.
It is now an action behind "Check what will actually book". The remaining loader
work is Prisma reads plus a 30-minute-cached master-data read that serves stale
data rather than blocking.

## 3. Integration

| # | Requirement | Status | Notes |
|---|---|---|---|
| 3.1.1 | Embed via latest App Bridge, `app-bridge.js` in `<head>` of every document; no embedded external pages | ✅ fixed | Was missing entirely. Added with `<meta name="shopify-api-key">` in `app/root.tsx`. No external pages are framed |
| 3.1.2 | Primary workflows inside the admin | ✅ | Connect, map, review, export, confirm and the journal are all in-app. The one external step is importing the CSV in Scopevisio — unavoidable while the ERP has no working document-create API (see `API-FINDINGS.md` §7) |
| 3.1.3 | Seamless sign-up, no additional login | ✅ *by exception* | The app asks for Scopevisio credentials, which the rules permit: apps with complex sign-up "may ask merchants to connect their store to their existing credentials". A reviewer will look at this — the Connection screen is explicitly framed as connecting an existing ERP account, not creating one |
| 3.1.4 | Simplified monitoring on the home page | ✅ | Overview shows booked / needing-decision / ready-to-export / awaiting-confirmation counts, connection health and current mode |
| 3.1.5 | Third-party connection settings inside the embedded app | ✅ | This was the founding constraint. Only `SCOPEVISIO_ENCRYPTION_KEY` is environment-side, deliberately — a tenant must not choose the key protecting its own secrets |
| 3.2.1 | Clean uninstall via theme app extensions | ✅ n/a | Nothing is written to the theme. `shop/redact` deletes all app-side data |
| 3.2.2 | No Asset API theme edits | ✅ | The Asset API is never called |

## 4. Design

| # | Requirement | Status | Notes |
|---|---|---|---|
| 4.1.1 | Follow UX best practices | ✅ | Built entirely from Polaris primitives, so fonts, cards, buttons and spacing match by construction. **WCAG 2.1 AA contrast measured**, not assumed — every text/surface pair used is computed below and passes |
| 4.1.2 | Mobile-friendly | ✅ fixed | `InlineGrid` collapses 4→2 columns, and every `wrap={false}` with a fixed `minWidth` has been removed — that combination is precisely the "requires horizontal scrolling" rejection. Detail rows and the two reason-forms now stack |
| 4.1.3 | Concise app name, no truncation | ✅ fixed | "Scopevisio ERP Connector" (24 chars) → **"Scopevisio ERP"** |
| 4.1.4 | Use App Bridge `s-app-nav` | ✅ fixed | Verified against the live runtime: `cdn.shopify.com/shopifycloud/app-bridge.js` defines both `s-app-nav` and `ui-nav-menu`, but `app-bridge-react@4.2.13` (the latest release) still renders the older `ui-nav-menu`. The nav now uses `s-app-nav` directly, as the requirement names it |
| 4.1.5 | Contextual Save Bar for forms | ✅ fixed | The Mapping form now drives `SaveBar` from real dirty state, with Save and Discard. Previously a merchant could navigate away with unsaved changes — an explicit rejection reason |
| 4.1.6 | Modals use `heading` + action slots | ✅ n/a | No modals |
| 4.2.1 | Spelling, grammar, phrasing | ✅ | Written in accounting language throughout (Erlöskonto, Steuerschlüssel, Abrechnungsbelege) so it reads as familiar to a bookkeeper |
| 4.2.2 | Helpful onboarding | ✅ fixed | Replaced three conditional banners with a real three-step card on Overview: connect → confirm mapping → switch on, each showing done/not-done, a single primary action pointing at the next incomplete step, and a **Dismiss** control that appears only once all three are done. Nothing is asked for without a stated reason, and no other app is suggested |
| 4.2.3 | Helpful homepage | ✅ | States whether the app is set up and working, and how much it has booked |
| 4.2.4 | Helpful error messages | ✅ fixed | Connection validation now returns per-field errors rendered on the inputs, only after a submit. Errors persist rather than auto-dismissing, and use Polaris critical tone (red) |
| 4.2.5 | Guide to logical actions | ✅ | One `variant="primary"` per screen; destructive actions are `tone="critical"` and `variant="plain"` |
| 4.2.6 | Visible previews | ✅ n/a | Nothing visual is customised |
| 4.3.1 | No false claims | ✅ | No outcome promises anywhere |
| 4.3.2 | No pressure | ✅ | No timers, no review prompts |
| 4.3.3 | No distraction | ✅ | No animations, no auto-appearing modals or popovers. Red is used only for errors and destructive actions |
| 4.3.4 | Don't overwhelm | ✅ fixed | Connection and Mapping each stacked up to four banners. Both now render **at most one** page-level banner, chosen by priority. The form is grouped into labelled cards rather than one long list |
| 4.3.5 | Don't impersonate Shopify | ✅ | Scopevisio branding; no Shopify iconography, no Sidekick icon, no magic purple |
| 4.3.6 | Dismissible ads | ✅ n/a | No promotional content |
| 4.3.7 | Label and disable premium features | ✅ n/a | No plan gating yet — revisit if pricing lands (OQ-7) |

### WCAG 2.1 AA contrast — measured

Computed from the Polaris token values actually shipped in
`@shopify/polaris-tokens`, for every text/surface pair the app uses. AA needs
**4.5:1** for body text.

| Text | Surface | Ratio | |
|---|---|---|---|
| `text` | `bg-surface` | 17.40:1 | pass |
| `text-secondary` | `bg-surface` | 6.19:1 | pass |
| `text-critical` | `bg-surface` | 8.93:1 | pass |
| `text` | `bg-surface-secondary` | 16.25:1 | pass |
| `text-secondary` | `bg-surface-secondary` | 5.78:1 | pass |
| `text-critical` | `bg-surface-secondary` | 8.34:1 | pass |
| `text-secondary` | `bg-surface-secondary` (alt) | 5.48:1 | pass — worst case |
| `text` (dark) | `bg-surface` (dark) | 10.28:1 | pass |
| `text-secondary` (dark) | `bg-surface` (dark) | 6.44:1 | pass |

The app introduces no colours of its own, so this holds as long as it stays on
Polaris tokens.

## 5. Category-specific

📋 **This needs a decision, and it carries a real requirement.**

If the app is listed under **Invoices and Receipts**, requirement 5.9.1 applies:

> "Your app must use an admin print action extension to let merchants print
> invoices or packing slips" — from both individual orders and bulk selection.

We have no such extension. Two options:

1. **List under an accounting/finance category instead.** The app does not print
   anything for the merchant — it books revenue into an ERP. This is the honest
   categorisation and avoids 5.9.1 entirely.
2. **Keep the category and build an admin print action extension** that renders
   the Scopevisio invoice PDF. Only viable once documents can be created via
   API, which is currently blocked (OQ-10).

No other category rules apply: no ads, affiliate, analytics, carrier service,
discount, email/SMS, forms, fulfilment, bundles, reviews, returns or
subscription behaviour.

---

## What is left, in the order it should be done

Every code-level requirement is now met. What remains needs a person, an
account, or merchants — none of it can be written.

**Needs a decision or an account action**

1. 📋 **Listing category.** Recommendation: an accounting/finance category, not
   *Invoices and Receipts* — the app books revenue into an ERP, it does not
   print documents for the merchant, and choosing that category would trigger
   5.9.1 (admin print action extension), which cannot be built until documents
   can be created via API.
2. 📋 Privacy policy URL and support contact, plus a written GDPR-vs-GoBD
   position (PRD OQ-4), since the app retains personal data on booked documents.
3. 📋 Protected customer data grant (PRD D-007). Order *intake* already works
   without it via polling; this unlocks the webhook fast path.
4. 📋 Billing API, if the app is paid (PRD OQ-7).

**Needs merchants and time**

5. ⏳ **50 net installs on paid plans, 5 reviews, and the rating threshold.**
   These are the real gate: BFS is awarded to a live, adopted app. Nothing in
   the codebase moves them.
6. ⏳ Confirm LCP / CLS / INP once ≥100 samples exist. The instrumentation is in
   place and no loader blocks on the ERP, so this is a check, not a fix.

**Fixed across the two BFS passes:** the missing `app-bridge.js` tag (3.1.1, and
the precondition for all of section 2), the absent Contextual Save Bar (4.1.5),
banner stacking on two screens (4.3.4), non-contextual form errors (4.2.4), the
truncating app name (4.1.3), `s-app-nav` navigation (4.1.4), mobile layouts that
forced horizontal scrolling (4.1.2), measured AA contrast (4.1.1), and moving
the ERP readiness probe off the render path (2.1.1).
