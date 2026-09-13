# Repository structure

How connectors share code, and — more importantly — **when** to extract the
shared part. Written when the repository was renamed from a single Shopify app
to `erp-connectors`.

## The constant is Scopevisio

Every connector here brings some third-party system into Scopevisio. So the
Scopevisio side is the part that repeats, and the third-party side is the part
that varies. That is the opposite of how the Shopify app is currently laid out,
which is why the layout has to change eventually.

## What the first connector actually measured

Classified at `ed471be`, 9,388 lines:

| | LOC | Repeats per connector? |
|---|---|---|
| Platform adapter — Shopify OAuth, webhooks, intake, Polaris screens | 3,723 | No. New each time |
| Scopevisio adapter — OpenScope client, contacts, debitors, master data, VAT, invoices, postings, readiness | 2,329 | **Yes. Identical every time** |
| Domain and infrastructure — tax rules, crypto, journal, sync orchestration, CSV delivery, i18n | 2,157 | **Yes, mostly** |
| Tests | 1,179 | Follows its subject |

**About 48% of the existing code is already connector-agnostic.** A second
connector that copies it will have forked the expensive half — the half that
holds VIES validation, the hold-rather-than-guess semantics, credential
encryption and the journal's credential redaction. Those took the longest to get
right and are the worst things to have two divergent copies of.

## Target layout

```
packages/
  scopevisio/        OpenScope client, token refresh, contacts and debitors,
                     master data, VAT resolution, documents, readiness check
  connector-kit/     the chassis: encrypted credential store, journal with
                     redaction, sync state and idempotency, hold semantics,
                     health, i18n
connectors/
  shopify/           OAuth, webhooks, order intake, admin UI
  <next>/
docs/
```

## Do not extract this yet

One consumer is not enough to find a seam. Extracting now would shape
`packages/` around Shopify's assumptions, and the second connector would spend
its time fighting abstractions built for something else. The second consumer is
what reveals where the boundary really is.

**Extract when connector #2 starts, not before** — and extract by moving code
that #2 actually needs, one piece at a time, rather than designing the packages
up front.

## Until then

Keep the eventual seam visible so the code does not drift across it:

- **Never copy `app/scopevisio/tax-rules.ts`.** 133 lines, 497 lines of tests,
  no Shopify and no Scopevisio dependency. It is the most valuable thing here.
  If a second connector needs it, that is the signal to start the extraction.
- **Never copy `crypto.server.ts` or `log.server.ts`.** The journal redacts
  credentials embedded in string values, not just in keys, because a leak was
  found there once. A copy will not have that fix.
- `app/scopevisio/*` should not import from `app/routes/*` or from
  `@shopify/*`. It currently does not, apart from Shopify *type* references in
  `order-mapper` and `fetch-order`. Keep it that way.
- New Shopify-specific work goes under `app/routes/`; new Scopevisio-side work
  goes under `app/scopevisio/`.

## The one known design problem

`OrderSync` is order-shaped: `orderGid`, `orderNumber`, `orderName`, unique on
`(shop, orderGid)`. A connector that syncs time entries, payments or bookings
has no orders. Before the second connector, that model needs to become something
like `SyncRecord` keyed by `(connector, tenant, externalId)` with the
document-specific fields moved into the existing `draftJson` payload.

Do that migration deliberately, with the second connector's real requirements in
hand. It is the single piece of schema that will be painful to change later,
because it holds the double-booking guard and under GoBD a duplicate posting
cannot be withdrawn.

## Platform limits that constrain every connector

From `docs/API-FINDINGS.md`, all of these apply to connector #2 as much as #1:

- **No webhooks in OpenScope.** Anything Scopevisio→outward is polling.
- **Auth is `grant_type=password`.** The connector handles the tenant's own
  Scopevisio credentials until a refresh token is issued.
- **Per-endpoint profile requirements** are the most likely cause of a failed
  self-serve setup, and they fail in ways that look like connector bugs.
- **No stock or inventory read anywhere in the API.** Any connector needing
  quantity on hand is blocked at the platform, not in the connector.
- **Rate limits are undocumented.**

These are worth fixing once at the platform rather than working around once per
connector.
