# Scopevisio ERP Connector for Shopify

Books Shopify orders into Scopevisio as Fakturen, with the customer set up as a
debitor and the VAT treatment taken from the merchant's own Steuermatrix.

**Everything is configured by the merchant inside the embedded Shopify app.**
The only environment variable the connector itself needs is an encryption key —
there are deliberately no Scopevisio tenant settings in `.env`.

- `docs/PRD.md` — the product requirements: problem, outcomes, capabilities, metrics
- `docs/API-FINDINGS.md` — what the OpenScope REST API does and does not support
- `docs/BUILT-FOR-SHOPIFY.md` — Built for Shopify compliance, item by item
- `docs/DEPLOYMENT.md` — how to deploy it, and why the database must outlive the container
- `docs/PRIVACY.md` — privacy policy draft, grounded in what the app actually stores
- `docs/PROTECTED-CUSTOMER-DATA.md` — prepared answers for Shopify's data declaration

## Getting started

```bash
npm install
npx prisma migrate deploy
cp .env.example .env          # then fill in SCOPEVISIO_ENCRYPTION_KEY
openssl rand -base64 32       # generate the key
npm run dev                   # needs a real terminal (TTY)
```

Then, in the embedded app:

1. **Connection** — enter the Scopevisio customer number, organisation, user and
   password. Credentials are verified before they are stored, encrypted with
   AES-256-GCM, and the password is discarded once a refresh token is issued.
2. **Mapping** — choose the customer groups and the Steuersachverhalt for each
   tax case. Every choice is offered from the merchant's own Scopevisio master
   data; nothing is a free-text identifier to look up in documentation.
3. Switch sync on. Leave *automatic posting* off until the review queue has been
   reliably empty — posted documents cannot be withdrawn.

## How it works

```
orders/paid ─► classify tax case ─► upsert contact + debitor ─► create invoice
                    │                                              (unposted)
                    │                                                   │
              hold if unsure                                     tax checksum
                    │                                                   │
                    └────────────► review queue ◄─────────── mismatch? hold
                                                                        │
                                                                  post to ledger
```

Every paid order ends in exactly one of three visible states — **booked**,
**held**, or **declined**. There is no fourth state and no silent drop.

### VAT

The connector does not calculate VAT. It decides one thing — which
Steuersachverhalt an order falls into — and then asks Scopevisio which
Erlöskonto and Steuerschlüssel that case implies for that destination on that
date (`GET /revenueaccounts/products?country=…&vatScope=…&servicesRenderedDate=…`).

Shopify's calculated tax is a **checksum, never an input**: a 0% line could be
an intra-EU B2B supply, a third-country export, a reverse-charge supply or a
small-business exemption — four different UStVA lines that cannot be told apart
from the number.

The one piece of genuinely new logic is VIES VAT-ID validation with a stored
timestamp, because validity *at the time of supply* governs reverse charge.

### GoBD

A posted document is immutable. Two consequences shape the design:

- **Create, verify, then post** — never post on import.
- **Idempotency is correctness, not hygiene.** Enforced twice: a unique key on
  `OrderSync(shop, orderGid)` and `skipDuplicates` on the ERP import.

Refunds become Gutschriften referencing the original document. A refund on an
invoice that was never posted withdraws the pending document instead.

Where GDPR erasure conflicts with GoBD retention, retention wins: personal data
on booked documents is restricted, not deleted. **The written legal position for
this is still open — see OQ-4 in the PRD; do not distribute publicly without it.**

## Layout

| Path | What |
|---|---|
| `app/scopevisio/client.server.ts` | OpenScope REST client: token auth, refresh, retry |
| `app/scopevisio/tax-rules.ts` | Pure VAT logic — no DB, no network. Fully tested |
| `app/scopevisio/vat.server.ts` | Tax determination against the live Steuermatrix |
| `app/scopevisio/contacts.server.ts` | Customer upsert (one-way, create-if-missing) |
| `app/scopevisio/invoices.server.ts` | Faktura + Gutschrift XML, create and post |
| `app/scopevisio/sync.server.ts` | Order → Faktura orchestration and the queue |
| `app/scopevisio/constants.ts` | Values shared by server and UI (not a `.server` module) |
| `app/routes/app.connection.tsx` | Merchant-facing connection setup |
| `app/routes/app.mapping.tsx` | Mapping, driven by the tenant's master data |
| `app/scopevisio/csv-export.server.ts` | CSV delivery: drafts, batches, confirmation |
| `app/scopevisio/postings.server.ts` | Journal postings (not wired in — see above) |
| `app/routes/app.orders.tsx` | Review queue |
| `app/routes/app.export.tsx` | Export batches and import confirmation |
| `app/routes/app.journal.tsx` | Append-only audit journal |

## Scripts

```bash
npm run dev      # Shopify CLI dev server (needs a TTY)
npm run build    # production build
npm run lint
npm test         # vitest
npx tsc --noEmit # typecheck
```

## Getting invoices into Scopevisio

The API has no JSON endpoint that creates a billing document, and the one XML
endpoint that does has an undocumented schema. So delivery is **CSV by
default** — and that is a real path, not a degraded one: importing the file in
the Scopevisio client creates genuine Abrechnungsbelege, which the Faktura
module renders and sends exactly as it does for manually entered invoices.

**The flow** (Export page in the app):

1. A paid order arrives. The connector creates the contact and debitor,
   classifies the Steuersachverhalt, resolves the Erlöskonto and
   Steuerschlüssel from the tenant's Steuermatrix, and puts the finished draft
   in the export queue.
2. The bookkeeper downloads a CSV batch. Those orders become `exported`, so the
   next download cannot include them again — a double import would mean
   duplicate invoices.
3. They import it in Scopevisio under **Abrechnung → Abrechnungsbelege**,
   mapping the columns once (headers already use Scopevisio field names).
4. They come back and confirm. **Only then** does the connector mark the
   invoices booked — it cannot observe the import itself, so it never assumes.
   If the import failed, "Import failed" returns the batch to the queue with a
   reason, recorded in the journal.

`deliveryMode` on the Mapping page switches between `csv` (this) and `api`
(direct document import). `api` is selectable but currently holds every order;
it exists so the switch is a setting rather than a code change once the schema
is available.

### Why not journal postings?

`POST /postings/new` works and is implemented (`postings.server.ts`), but it
books revenue and a receivable **without producing a document** — no
Belegnummer in the invoice range, no PDF, nothing the Faktura module can send.
It satisfies the accounting outcome, not the customer one, so it is not wired
into the sync flow and must not be treated as a substitute.

## Order intake — two paths, deliberately

| Path | Needs | Role |
|---|---|---|
| **Polling** (`intake.server.ts`) | `read_orders` + `read_customers`, already granted | Works today. Also recovers orders missed while Scopevisio was down (PRD C-011) and lets a period be reprocessed (C-012) |
| **Webhooks** (`orders/paid`) | Shopify protected-customer-data grant | The fast path, once approved. Currently commented out in `shopify.app.toml` — with the subscription in place `shopify app dev` refuses to start |

Both are safe to run together: `syncOrder` is idempotent on
`OrderSync(shop, orderGid)`, verified by `npm run e2e:intake` — polling
prepares an order, and the webhook path then skips it with exactly one row.

"Check now" on the Orders page runs a poll. The cursor (`lastPolledAt`) is
recorded at the *start* of a run with a five-minute overlap on the next, so an
order created mid-run is caught rather than falling in the gap.

Note on protected customer data: the grant governs API reads too for a public
app, so polling does not remove that requirement for App Store distribution —
it removes the hard failure that blocks development, and is sufficient for a
custom app for existing tenants (OQ-6).

## Tests

```bash
npm test            # 117 unit tests
npm run e2e         # all three live suites (needs a connected tenant)
npm run e2e:intake  # 16 checks: paging, cursor, double-booking, error isolation
npm run e2e:csv     # 22 checks: the CSV delivery lifecycle
npm run e2e:orders  # 5 tax cases + contact idempotency
```

## Known gaps

1. **Order webhooks are disabled pending Shopify approval** — but intake is
   not blocked, because polling covers it (see above). To enable the fast path:
   Partner Dashboard → API access → Protected customer data access (Level 1 +
   Name, Address, Email), then uncomment both `[[webhooks.subscriptions]]`
   blocks in `shopify.app.toml`. The handlers are written and tested.
2. **The invoice import XML schema is unknown**, so `deliveryMode: "api"` does
   not work. Established by testing on 2026-09-08: the payload must be XML
   (non-XML gives `400 "data: must be a valid XML document"`), 29 well-formed
   structural variants were all silently ignored (HTTP 200, `invoices: []`),
   and there is no JSON create endpoint for any billing document. Needs the
   schema or one sample from whoever owns OpenScope — it is not derivable by
   experiment because failures are silent. CSV delivery is unaffected.
3. **Stock sync is not implemented and cannot be.** The OpenScope API exposes no
   stock-level read — see `docs/API-FINDINGS.md` §10 and OQ-1.
4. **Scopevisio has no webhooks**, so any ERP→Shopify direction would require
   polling.
5. The Scopevisio permission model for a connector user is not yet confirmed
   (OQ-2); a missing profile currently surfaces as a merchant-actionable error
   naming the profile.
