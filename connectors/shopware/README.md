# Shopware → Scopevisio

Books paid Shopware 6 orders into Scopevisio: the customer becomes a contact
with a debitor account, and the VAT treatment comes from the merchant's own
Steuermatrix rather than being computed.

The second connector in this repository. Everything that is not about Shopware
— the OpenScope client, VAT determination, contact upsert, the document
builders — lives in `packages/scopevisio-core` and is shared with the Shopify
connector. See `docs/REPO-STRUCTURE.md`.

## Why Shopware was chosen as connector #2

No supplier dependency at any point. Shopware is open source, a full instance
runs locally in minutes, and a private app needs no store review, no partner
status and nobody's approval. It also has no accounting module of its own, so
there is no product to collide with — and unlike the Shopify pairing, somebody
is already paying an agency for this integration by hand.

## Running it

```bash
cp .env.example .env
openssl rand -base64 32        # → SCOPEVISIO_ENCRYPTION_KEY (must be 32 bytes)
$EDITOR .env

npm run setup                  # prisma generate + migrate
npm run dev
curl localhost:3100/healthz    # → {"ok":true}
```

The connector refuses to start if the encryption key is missing or the wrong
length, rather than booting and failing on the first installation.

### A local Shopware to test against

```bash
docker run --rm -p 8000:80 dockware/dev:latest
```

Shopware must be able to reach this service, so for a local install either run
both in Docker on one network, or expose the connector with a tunnel and set
`APP_URL` to the tunnel host. Then drop `manifest.xml` into
`custom/apps/ScopevisioConnector/` in the Shopware container and run
`bin/console app:install ScopevisioConnector --activate`.

⚠️ `manifest.xml` carries `<secret>replace-me</secret>` and localhost URLs.
Both must be replaced before the app is installed anywhere real — the secret
has to match `SHOPWARE_APP_SECRET` exactly or the handshake fails with what
looks like a signature bug.

## Testing

```bash
npm test                 # unit tests, no network, no database
npm run e2e:handshake    # drives the real handshake against a running server
```

The handshake harness exists because Shopware cannot easily be made to send a
bad signature, a tampered body, or a hostile re-registration. Those paths would
otherwise stay untested until somebody attacked them. It covers 16 cases, of
which 6 are things that must be **rejected**.

## How it works

```
state_enter.order_transaction.state.paid
        │
        ▼
verify shopware-shop-signature ──► reject unless it matches this shop's secret
        │
        ▼
take the order id from data.payload.order.id
        │
        ▼
fetch the full order over the Admin API
(the webhook's inline order has no billingAddress)
        │
        ▼
map to the platform-neutral OrderLike
        │
        ▼
core: classify tax case ─► hold if unsure
        │
        ▼
core: upsert contact + debitor
        │
        ▼
core: build invoice, create unposted ─► checksum ─► post only if autoPost
```

Every order ends in exactly one of **booked**, **held**, **ready_to_export** or
**declined**. There is no silent drop, and `(shopId, externalId)` is unique so a
redelivered webhook does nothing the second time — under GoBD a duplicate
posting cannot be withdrawn, only corrected with a credit note.

## Security notes worth keeping

- **The merchant's Shopware password is never seen.** Shopware mints an
  Admin API key pair during registration and that is all this connector ever
  holds. The contrast with OpenScope's password grant is the point.
- **Re-registration requires proving possession of the current shop secret.**
  Shopware's own implementation shipped `CVE-2026-31889` (CVSS 8.9) because it
  did not, letting anyone with a leaked app secret re-point an installed shop at
  a host they controlled. The check is in `registration.ts` and the harness
  tests it.
- **Admin API credentials are encrypted at rest** with the same key that
  protects the Scopevisio credentials.
- **The journal redacts credentials inside values, not just by key name** —
  tokens turn up embedded in URLs and error bodies.

## Verified against a real Shopware 6.7.2.2 store

Not simulated — a dockware instance, the app installed via
`bin/console app:install`, real orders placed through the Store API and
transitioned to paid through the Admin API:

| | |
|---|---|
| Registration handshake, driven by Shopware itself | ✅ |
| Admin API OAuth (client_credentials) | ✅ |
| Order fetch with all associations | ✅ |
| Order mapping — VAT ID, company, SKU, tax in cents, payment method | ✅ |
| Webhook delivery, signature verified | ✅ |
| Reinstall after uninstall | ✅ |

Four bugs were found this way that no unit test could have caught, because each
lived in the gap between what the documentation said and what Shopware does.
They are listed in `docs/SHOPWARE-FINDINGS.md`.

**Not yet verified:** anything past `syncOrder` — the Scopevisio half needs test
tenant credentials.

## Running the Shopware worker

Webhooks are dispatched through Shopware's message queue, not sent inline. With
no worker running, nothing is ever delivered and there is no error anywhere:

```bash
docker exec <container> php bin/console messenger:consume async --time-limit=30
```

Worth knowing before concluding that a webhook subscription is broken.

## Not done yet

- **No admin UI.** Connection and mapping settings have to be written to the
  database directly. Shopware's Admin Extension SDK is the route, and it is a
  rewrite rather than a port of the Shopify screens.
- **Refunds** are subscribed to in the manifest but not yet handled.
- **Invoice creation depends on the unverified OpenScope import schema**
  (`docs/API-FINDINGS.md` §7). Until that is resolved the connector holds rather
  than reporting a success it cannot confirm — the endpoint answers HTTP 200
  with an empty array for a document it did not understand.
- **No CSV delivery path yet.** The Shopify connector's exists and should move
  into core rather than being written a second time.
