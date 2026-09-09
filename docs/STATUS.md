# Status and handover

Written 2026-09-09, on branch `feat/scopevisio-connector` (11 commits ahead of
`main`, nothing uncommitted). Start here when picking the work back up.

---

## In one paragraph

A Shopify embedded app that books paid orders into a merchant's own Scopevisio
organisation. Customers become contacts with debitor accounts, VAT is resolved
from the tenant's own Steuermatrix rather than computed, and anything uncertain
is held rather than posted. Invoices are delivered as a CSV the bookkeeper
imports in the Scopevisio client, because the API's only document-create
endpoint has an undocumented XML format. Everything is configured inside the
Shopify admin; the UI is German. It is not deployed anywhere yet.

## What is verified working

Against the live tenant (customer `2039915`, organisation **Simplify AG**):

| | |
|---|---|
| Auth, token refresh, organisation auto-discovery | ✅ |
| Master data read (6 tax cases, 31 matrix entries, 12 revenue accounts) | ✅ |
| Tax-case classification | ✅ 5/5 correct |
| Contact + debitor creation | ✅ real contacts `101026`+, accounts `10046`+ |
| Idempotency, incl. guest orders | ✅ contact reused on replay |
| CSV delivery lifecycle | ✅ 22/22 checks |
| Polling intake (paging, cursor, no double-booking) | ✅ 16/16 checks |
| Container build, boot, migrations, **data survives redeploy** | ✅ |
| 131 unit tests · typecheck · lint · build | ✅ |

```bash
npm test              # 131 unit tests
npm run e2e           # all three live suites (needs a connected tenant)
npm run dev           # localhost:3000, shopify.app.local.toml, no webhooks
npm run dev:tunnel    # tunnel + webhooks; needs a real terminal
```

## What is NOT done

**Blocked on Scopevisio (internal ask)**

- **The `/outgoinginvoices/import` XML schema.** Confirmed by testing: the
  payload must be XML, 29 structural variants were all silently ignored (HTTP
  200, `invoices: []`), and there is no JSON create endpoint for any billing
  document. Not derivable by experiment. Only affects `deliveryMode: "api"`;
  CSV delivery does not need it. Detail in `API-FINDINGS.md` §7.

**Blocked on account actions**

1. **Deploy.** `fly.toml` is written and the container is verified, but nothing
   is deployed. `application_url` is still `https://localhost:3000`. See
   `DEPLOYMENT.md`.
2. **Privacy policy** — `PRIVACY.md` is drafted against the real schema; needs
   legal review, a public URL, then `PRIVACY_POLICY_URL` + `SUPPORT_URL`.
3. **Protected customer data grant** — `PROTECTED-CUSTOMER-DATA.md` is prepared;
   four rows need infra facts (staff access, sub-processors, backup encryption,
   data residency — Frankfurt now answers the last).
4. **Icon upload** — `assets/app-icon-1200.png` is ready. Partner Dashboard
   only; no CLI or API path exists.
5. **Category** — recommend Finance, *not* Invoices and Receipts (see below).
6. **Pricing** — undecided. Managed Pricing needs **no code**, so this is purely
   commercial.
7. **Screenshots are 1568×773; Shopify wants ≥1600×900.** Re-capture before
   uploading. `assets/screenshots/README.md` has the command.

**⚠️ `partners.shopify.com` and `admin.shopify.com` are blocked by network
policy on this machine.** That blocks items 2–6 and forced the screenshot
harness. Worth allowlisting first.

## Decisions already made — please don't re-litigate

Each of these cost real investigation.

| Decision | Why |
|---|---|
| **VAT is resolved, never computed** | A 0% line is ambiguous across intra-EU B2B supply, third-country export, reverse charge and Kleinunternehmer — four Steuersachverhalte, four UStVA lines, four accounts. The legal reason is not recoverable from the number. Shopify's tax is a checksum only |
| **Hold rather than guess** | A posted document cannot be unposted under GoBD. Holding is always cheaper than a wrong posting |
| **Customer sync is one-way, create-if-missing** | Confirmed with the product owner. Identity is the Shopify GID in `legacyNumber`; email is only a merge heuristic for pre-existing contacts, because a wrong match is far worse than a duplicate |
| **Guests get real contacts, keyed by order GID** | They have no Shopify customer id, so without this every retry created a new contact. CPD keeps the debitor master clean |
| **GoBD beats GDPR on erasure** | Booked documents are retained; personal data is restricted, not deleted. Needs a written legal position (PRD OQ-4) |
| **Delivery is CSV, not journal postings** | `POST /postings/new` works and is implemented in `postings.server.ts`, but produces **no document** — no Belegnummer, no PDF, nothing the Faktura module can send. Rejected for that reason; kept in case a ledger-only mode is ever wanted. **Do not wire it into the sync flow** |
| **Intake polls as well as accepting webhooks** | Polling needs no protected-data grant and recovers orders missed while Scopevisio was down. Both are safe together — `syncOrder` is idempotent, proven by `npm run e2e:intake` |
| **Category: Finance, not Invoices and Receipts** | That category triggers BFS 5.9.1, an admin print action extension, which cannot be built until documents can be created via API |
| **German UI by default** | Every user is a German-market bookkeeper, and a listing may only claim languages the UI supports |

## Traps that already caught us

Recorded so they don't cost the time twice.

- **`POST /{plural}` is a query, not a create.** `POST /credits` is a *search
  endpoint*; posting a document there is silently treated as a filter.
- **The search filter body must be a raw JSON object**, even though the spec
  types it as `string`. Sending a JSON-encoded string returns HTTP 200 with the
  filter **silently ignored** — you get the whole collection back looking like a
  result set.
- **`/revenueaccounts/products` alone misses most accounts.** It excludes
  products using standard accounts. Must be merged with
  `/revenueaccounts/standard` (7 vs 12 for DE; 12 vs 85 across all cases).
- **The import endpoint returns 200 with `invoices: []`** for a document it did
  not understand. Any integration that does not treat an empty array as failure
  will silently lose invoices. Worth reporting to the OpenScope team.
- **Polaris `Checkbox` contributes no form value.** Every boolean setting saved
  as `false` until paired with a hidden input.
- **Polaris `SaveBar` owns show/hide via its `open` prop** and calls `hide()` on
  mount — driving the DOM element directly races it.
- **`npx shopify` resolves to an unrelated npm package.** Use
  `npm run shopify -- …` or `./node_modules/.bin/shopify`.
- **`session-storage-prisma` must stay on 9.x**, so it shares one
  `@shopify/shopify-api` (13.x) with `shopify-app-remix@4`. 8.x peers on 12.x
  and produces duplicate-copy `Session` type errors.

## Bugs found and fixed (all by testing, not by reading)

1. Polaris `Checkbox` submitted no value → every boolean saved as `false`
2. Contact ids not persisted when invoice creation failed → orphaned contacts
3. Guest orders created a duplicate contact per retry
4. Import response mis-parsed (`documentNumbers` vs `invoices`)
5. `POST /credits` is a search endpoint, not an import
6. `/revenueaccounts/products` alone missed most accounts
7. CSV formatted ids as money (`101026,00`)
8. `decrypt` rejected its own output for an empty plaintext
9. **Journal leaked credentials embedded in string values** (a URL with
   `?access_token=…`, a `Bearer …` in an error body) — redaction was key-only
10. `SaveBar` driven via the DOM raced the React wrapper
11. **SQLite baked into the container image** — every redeploy would have wiped
    `OrderSync`, losing the double-booking guard. The most serious one, and
    invisible from the feature side
12. Dockerfile could not build (`npm ci --omit=dev` then `remix vite:build`,
    but vite is a devDependency); base image was Node 18 against `engines: >=20.19`
13. Mounted volume arrives root-owned while the app runs unprivileged → Prisma
    died on boot
14. Three App Store violations: shop-domain entry on both public pages,
    placeholder copy on the landing page, `read_all_orders` without necessity

## Layout

| Path | What |
|---|---|
| `app/scopevisio/tax-rules.ts` | Pure VAT logic — no DB, no network, fully tested |
| `app/scopevisio/vat.server.ts` | Tax determination against the live Steuermatrix |
| `app/scopevisio/client.server.ts` | OpenScope client: token auth, refresh, retry |
| `app/scopevisio/contacts.server.ts` | Customer upsert |
| `app/scopevisio/invoices.server.ts` | Faktura/Gutschrift XML — **the unverified part** |
| `app/scopevisio/csv-export.server.ts` | CSV delivery: drafts, batches, confirmation |
| `app/scopevisio/intake.server.ts` | Admin API polling |
| `app/scopevisio/readiness.server.ts` | Pre-flight check of the tenant's Steuermatrix |
| `app/scopevisio/postings.server.ts` | Journal postings — **not wired in, see decisions** |
| `app/i18n.ts` | Typed German/English dictionary; a missing key is a compile error |
| `app/routes/screenshots.$view.tsx` | **Dev-only** listing-screenshot harness, 404 in prod |
| `docs/` | PRD, API findings, BFS assessment, deployment, privacy, PCD, listing |

## Suggested order when resuming

1. Get `partners.shopify.com` / `admin.shopify.com` allowlisted — it gates most
   of the remaining work.
2. Deploy (`DEPLOYMENT.md`), set `application_url`, `npm run shopify -- app deploy`.
3. Re-capture screenshots at ≥1600×900 — ideally inside the real admin once the
   domain is reachable, which is better imagery than the harness.
4. Ask the OpenScope owner for the import XML schema. With it, the direct API
   path is roughly an hour: the draft, tax resolution and checksum are built and
   tested around it.
5. Legal: the GoBD-vs-GDPR position, then publish the privacy policy.
6. Request the protected-data grant using the prepared declaration.
7. Decide pricing; if Managed Pricing, no code needed.
8. Submit. **Built for Shopify comes later** — it needs 50 net installs on paid
   plans, 5 reviews, a rating threshold and 100+ Web Vitals samples over 28
   days. Those are measurements of a live, adopted app. Every BFS requirement
   that code can satisfy is satisfied; see `BUILT-FOR-SHOPIFY.md`.

## Housekeeping

- **Rotate the Scopevisio test password.** It was shared in a chat transcript on
  2026-09-08. Refresh tokens can be revoked at `account.scopevisio.com` →
  Schnittstelle (OpenScope) → API Token.
- **`SCOPEVISIO_ENCRYPTION_KEY` must never change** once merchants connect —
  rotating it makes every stored credential undecryptable. Back it up.
- Test data left in the tenant: contacts `101026`–`101044`ish and debitor
  accounts `10046`+, tagged `shopify` / `shopify-guest`. Nothing was posted to
  the ledger. Delete when convenient.
- The tenant's own Steuermatrix has **no OSS Steuersachverhalt and no
  Erlöskonto for FR or CH**, so only domestic orders flow end to end there.
  Real merchants each have their own; the readiness check reports it per tenant.
