# Magento 2 → Scopevisio

Books paid Magento invoices into Scopevisio: the customer becomes a contact with
a debitor account, the VAT treatment comes from the merchant's own Steuermatrix
rather than being computed, and anything uncertain is held for a human instead
of guessed. Invoices reach the ledger as a CSV the bookkeeper imports, because
the OpenScope API's only document-create endpoint has an undocumented schema
(`docs/API-FINDINGS.md` §7).

The fourth connector in this repository. Everything that is not about Magento —
the OpenScope client, VAT determination, contact and debitor upsert, the draft
and the CSV renderer — is `packages/scopevisio-core`, shared with Shopify and
Shopware.

**Verified end to end against Magento Open Source 2.4.9 and the live Scopevisio
test tenant** — see [Verified](#verified) and
[`docs/MAGENTO-FINDINGS.md`](../../docs/MAGENTO-FINDINGS.md), which records the
three defects only the live run could find.

## Two parts

| | Where | Does |
|---|---|---|
| **Extension** `Scopevisio_Connector` | [`extension/`](extension/) (PHP, Magento module) | Provisions a Magento *Integration*; writes paid invoices and credit memos to a durable outbox; delivers them HMAC-signed by cron with retries; admin page and signed link into the connector |
| **Connector service** | [`src/`](src/) (TypeScript, Node) | OAuth handshake; receives webhooks and polls; fetches invoice + order over signed REST; tax, contacts, drafts via core; CSV batches; German screens |

Why not all in PHP: the VAT decision, VIES handling and the debitor rules are the
most expensive code in this repository, and `docs/REPO-STRUCTURE.md` forbids a
second copy. Why not all in the service: Magento Open Source has no webhooks, so
something inside Magento has to notice a paid invoice.

```
Magento                                   Connector                         Scopevisio
───────                                   ─────────                         ──────────
invoice saved, state = paid
  └─ observer → scopevisio_outbox
cron (every minute)
  └─ POST /magento/webhook  ── HMAC ──►  verify, record "pending", 202
                                          GET /rest/V1/invoices/:id  ◄─ OAuth 1.0a
                                          GET /rest/V1/orders/:id
                                          map → OrderLike (net, shipping as position)
                                          checksum per tax rate ─ hold if off
                                          classify tax case ─────────────► Steuermatrix
                                          upsert contact + debitor ──────► read back
                                          draft → ready_to_export
bookkeeper: download CSV ◄──────────────  batch → exported
            import in Scopevisio ─────────────────────────────────────────► Abrechnungsbelege
            "Import erfolgreich" ──────►  booked
```

Every paid invoice ends in exactly one visible state — `ready_to_export`,
`exported`, `booked`, `held` or `declined` — and `(store, invoice)` is unique, so
a redelivered webhook or an overlapping poll does nothing the second time.

## Decisions worth knowing

- **The invoice is the document, not the order.** Magento's "paid" is an
  invoice, and an order can be invoiced in parts. Guest contacts are keyed on the
  order, so partial invoices of one guest share a contact.
- **No admin password, no second secret.** The connector gets API access through
  a Magento Integration (OAuth 1.0a; requests are signed, because since 2.4.4
  integration tokens are not bearer tokens unless the merchant weakens a
  store-wide setting). The integration's consumer secret also signs the webhooks
  and the admin link, so deactivating the integration revokes everything at once.
- **Nothing retroactive.** The extension sends only invoices paid after it was
  first switched on (`scopevisio/general/sync_from`); polling starts at
  activation. Invoices from before were booked some other way.
- **The ERP can never break a sale.** The observer only writes an outbox row, on
  `*_save_commit_after`, and never throws. Delivery is cron's job.
- **Amounts go to core net.** `row_total − discount_amount +
  discount_tax_compensation_amount` is correct whether a discount applies to
  gross or net prices. A row that does not divide into cents is split into two
  positions so the document adds up exactly.
- **One sync per store at a time.** Scopevisio lost a debitor account under
  concurrent creation; throughput is not the constraint for a shop's invoices.
- **Refunds** withdraw an undelivered invoice when refunded in full, hold it when
  refunded in part, and flag *Gutschrift erforderlich* once it was exported or
  booked. The connector does not create credit notes: the document import is
  blocked and a CSV credit import is unverified.

## Installing for a merchant

**1. The extension**, into the Magento installation:

```bash
# from a VCS/artifact repository …
composer require scopevisio/module-connector
# … or by copying extension/ to app/code/Scopevisio/Connector
bin/magento module:enable Scopevisio_Connector
bin/magento setup:upgrade
```

**2. The connector service**, somewhere both Magento and the merchant's browser
can reach over HTTPS:

```bash
cp .env.example .env            # APP_URL, SCOPEVISIO_ENCRYPTION_KEY (openssl rand -base64 32)
npm install                     # at the repository root
npm run setup                   # prisma generate + migrate
npm start
```

The SQLite file must live on a persistent volume: it holds the double-booking
guard.

**3. Connect**, in the Magento admin:

1. *Stores → Configuration → Scopevisio → ERP-Anbindung*: switch on, enter the
   connector URL, save. This creates the **Scopevisio** integration with read
   access to orders, invoices and credit memos — nothing else.
2. *System → Integrationen → Scopevisio → Aktivieren → Erlauben*. Magento hands
   the connector its OAuth credentials; the popup shows the connector's own page.
3. In that popup: Scopevisio customer number, user and password (verified, then
   swapped for a refresh token and discarded), then map the Steuersachverhalte
   from the tenant's own list, and switch processing on.

Later: *Verkäufe → Scopevisio ERP* shows the outbox and opens the connector's
review queue, CSV export and journal through a link signed at click time.

Scripted installs can do steps 1–2 without the admin:

```bash
bin/magento scopevisio:integration:setup --connector-url=https://connector.example --enable --activate
bin/magento scopevisio:outbox:deliver [--retry-failed]
```

## Developing

A full Magento 2.4.9 with Luma sample data, German tax rates and gross prices:

```bash
docker compose -f dev/docker-compose.yml up -d --build
docker compose -f dev/docker-compose.yml exec magento bash /dev-scripts/install-magento.sh
# storefront http://localhost:8080/ · admin http://localhost:8080/admin (admin / Admin12345!)
```

Packages come from the Mage-OS mirror of `repo.magento.com`, so no Adobe keys
are needed. The extension is bind-mounted into `app/code`. The connector URL must
be reachable from inside the container — `localhost` is not; use the host's LAN
address or `host.docker.internal`, for the browser and Magento alike.

```bash
npm run dev                     # connector on :3200
npm test                        # unit tests, no network, no database
npm run e2e                     # live: real Magento checkout → real Scopevisio
```

`npm run e2e` needs the stack running, the integration activated and a
Scopevisio connection. `scripts/seed-connection.ts` copies an existing
connection (refresh token only) from another connector's dev database, so the
test tenant's password never has to be typed again. `CAPTURE_FIXTURES=1` saves
the real Magento payloads the fixture tests are built on.

## Verified

Run `mu10llpz`, 2026-09-14, Magento 2.4.9 + Scopevisio tenant 2039915 — **38 of
38 checks**, nothing posted to the ledger:

| | |
|---|---|
| Integration provisioned with exactly 7 read-only sales resources | ✅ |
| OAuth 1.0a handshake started by Magento (`postToConsumer`), request + access token | ✅ |
| Signed REST reads, including `searchCriteria[…]` queries | ✅ |
| Orders placed through Magento's cart/checkout API; invoices and credit memos by Magento | ✅ |
| Observer → outbox → signed delivery by the extension; by cron alone, too | ✅ |
| Customer order, DE, configurable + simple: Erlöskonto 8400 / U19, positions add up to the cent | ✅ |
| Contact in Scopevisio carries `magento:<store>:customer:1` and the `magento` tag; debitor read back | ✅ |
| Guest with two partial invoices → one contact, CPD debitor confirmed | ✅ |
| Switzerland (tenant has no CH account) → held, not guessed | ✅ |
| AT company with a VAT ID VIES rejects → held, no reverse charge | ✅ |
| Full refund before export → withdrawn and stays withdrawn | ✅ |
| Redelivered webhook → nothing changes; tampered body and stale timestamp → 401 | ✅ |
| Polling finds the same invoices, records nothing twice | ✅ |
| Signed admin link, forged link refused, CSRF enforced, settings from live Steuersachverhalte | ✅ |
| CSV with BOM and Scopevisio columns; exported once; import confirmation books the batch | ✅ |
| Refund after booking → *Gutschrift erforderlich*, booking untouched | ✅ |

## Not done

- **Invoices cannot be created by API.** The same OpenScope import blocker as the
  other connectors (`docs/API-FINDINGS.md` §7). `deliveryMode: api` exists and
  holds; CSV works today.
- **Credit notes are manual.** Flagged in the queue, not created.
- **EU consumer sales below the OSS threshold** are looked up with the
  destination country; the test tenant has no AT account, so they hold. Whether
  that is the right lookup is PRD OQ-5 (Tax), and it lives in core
  (`docs/MAGENTO-FINDINGS.md` §5).
- **Not deployed**, and no container image for the service yet. The Shopify
  connector's Dockerfile and `docs/DEPLOYMENT.md` are the pattern.
- **Magento admin screens were checked by HTTP, not in a browser session**, and
  only in the admin's German/English source strings shipped in `i18n/de_DE.csv`.
- **Multi-website stores** send one base URL (the default store view's); the
  connector treats a Magento installation as one tenant.
- Stock sync is out of scope for every connector: OpenScope has no stock read.
