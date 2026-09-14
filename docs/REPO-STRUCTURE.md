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

## Actual layout

```
packages/
  scopevisio-core/   OpenScope client, VAT determination, contact upsert,
                     invoice and credit builders, journal postings, crypto.
                     No database. No commerce platform. No framework.
connectors/
  shopify/           Remix app: OAuth, webhooks, order intake, Polaris admin
  shopware/          HTTP service: app handshake, signed webhooks, Admin API
  magento/           Magento 2 extension (outbox, integration, admin link) +
                     HTTP service: OAuth 1.0a handshake, sync, CSV, screens
  n8n/               n8n community node — standalone, see below
docs/
research/
```

### Why the n8n node does not use `scopevisio-core`

n8n only verifies community nodes that have **no runtime dependencies**, and that
never read environment variables or files. A workspace dependency on
`@erp/scopevisio-core` would break both rules, and the package has to install on
its own from npm.

It is also excluded from the root workspaces, because it needs n8n's eslint 9
toolchain while the Shopify connector pins eslint 8. It keeps its own
`node_modules` and lockfile, and is built, linted and tested from its own folder.

This is the one sanctioned exception to "never copy". What it shares in spirit
with core — the search-body rule, the revenue-account merge — is re-implemented
in `connectors/n8n/nodes/Scopevisio/helpers.ts` and tested there. The VAT
decision itself (`tax-rules.ts`) is deliberately **not** in the node: the node
exposes Scopevisio's own tax data and lets the workflow decide.

## The seam, and how it is enforced

Core cannot reach a database, because it has none. The two things it would
otherwise need are supplied as ports (`packages/scopevisio-core/src/ports.ts`):

| Port | What a connector supplies |
|---|---|
| `ConnectionStore` | `load()` / `save(patch)` for one tenant's Scopevisio connection |
| `Journal` | `event(entry)` — append-only, credential-redacting |

Each connector's adapter is about sixty lines:
`connectors/shopify/app/scopevisio/core.server.ts`,
`connectors/shopware/src/store.ts` and `connectors/magento/src/store.ts`. The only real difference between them is the
tenant key — a myshopify domain versus a Shopware `shopId`.

Operations take a `ScopevisioContext` (`{ client, journal }`) rather than a
tenant id, so core never has to know how a connector identifies its tenants.

## What must never be copied into a new connector

- **`tax-rules.ts` and `tax.ts`.** The VAT decision — five Steuersachverhalte,
  VIES validation, and the hold-rather-than-guess behaviour. This is the most
  valuable code here and two divergent copies would be the worst possible
  outcome. The Shopware connector calls the same functions; so should the next.
- **`crypto.ts`.** One implementation, one key.
- **Journal redaction.** Both connectors scrub credentials *inside string
  values*, not only by key name, because tokens have turned up embedded in URLs
  and in error bodies. A fresh implementation will not have that fix — copy the
  tests if you must write one.
- **`InvoiceDraft`.** The delivery-agnostic shape. CSV, the OpenScope XML import
  and journal postings are all renderers over it.

## Still connector-local, and why

`masterdata.server.ts`, `intake.server.ts` and the readiness check remain in
the Shopify connector because they are bound to its Prisma schema.

**Moved to core with the Magento connector** (2026-09-14), so the third
connector did not become the third copy:

- `buildInvoiceDraft` — every connector had its own identical `buildDraft`.
- `draftsToCsv` — the CSV renderer. The batch lifecycle (exported, confirmed,
  returned) stays local because it is state in each connector's schema; the
  Magento connector's `src/export.ts` is the one to copy for Shopware.
- `scrub` / `scrubValue` — journal redaction. Shopware now re-exports it.
- `ensureDebitor` now **reads the debitor account back** before trusting
  `/createdebitor`, after Scopevisio answered with a number it never persisted
  (`docs/MAGENTO-FINDINGS.md` §1). Every connector gets that fix.

## Schema: two shapes, deliberately

The Shopify connector keeps `OrderSync` (`orderGid`, unique on
`(shop, orderGid)`). The Shopware connector introduced `SyncRecord`
(`externalId`, unique on `(shopId, externalId)`) — the platform-neutral shape.

They are not yet unified, and unifying them is a data migration on a table that
holds the double-booking guard. Under GoBD a duplicate posting cannot be
withdrawn, only corrected with a credit note, so that migration deserves its own
change with its own verification — not a drive-by rename.

## Platform limits that constrain every connector

From `docs/API-FINDINGS.md`, all of these apply to connector #2 as much as #1:

- **No webhooks in OpenScope.** Anything Scopevisio→outward is polling.
- **Auth: the connector uses `grant_type=password`, but it did not have to.**
  Verified against the live spec 2026-09-13: `POST /token` also accepts
  `authorization_code`, `/static/authorize.html` is live, and all 321 operations
  declare `security: [{oauth: []}]`. The password route also breaks for any
  tenant with TOTP enabled, since `totpResponse` is password-grant only.
  What the flow still lacks for third-party use: **no scopes** (`"scopes": {}`
  is empty), **no real client registration** (`client_id` defaults to `"sv"`,
  `client_secret` may be blank — individual connectors cannot be identified or
  revoked) and **no PKCE**. Moving this connector to authorization_code is the
  right first step, and defining scopes and client registration is the platform
  ask.
- **Per-endpoint profile requirements** are the most likely cause of a failed
  self-serve setup, and they fail in ways that look like connector bugs.
- **No stock or inventory read anywhere in the API.** Any connector needing
  quantity on hand is blocked at the platform, not in the connector.
- **Rate limits are undocumented.**

These are worth fixing once at the platform rather than working around once per
connector.
