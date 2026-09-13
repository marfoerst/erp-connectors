# What a real Shopware install found

The Shopware connector passed 69 unit tests and a 16-case handshake harness
before it was ever installed anywhere. Installing it into a real Shopware
6.7.2.2 found four defects within the hour, every one of them fatal to the
connector actually working.

The common thread: **the harness and the implementation shared the same
assumptions.** A test written from the same reading of the documentation as the
code cannot discover that the reading was wrong.

## 1. Reinstalling the app was impossible

`Invalid shop signature on re-registration` — our own error, rejecting Shopware.

Re-registration and reinstallation are different events. A live
re-registration arrives **with** `shopware-shop-signature`; a reinstall after an
uninstall arrives **without** it, because Shopware dropped its side of the
secret. We demanded the proof unconditionally, so a merchant who uninstalled
could never install again.

The harness tested re-registration while both sides still held the secret —
the happy path, and the only path that could pass.

**Fixed:** verify when a signature is offered; otherwise treat it as the fresh
install Shopware believes it is, rotating the secret and discarding the previous
installation's API credentials.

## 2. Every order fetch would have returned 403

The manifest requested `order`, `order_customer`, `order_address`,
`order_line_item`, `order_transaction`, `customer`, `currency`, `country`,
`product`. But `fetchOrder` asks for the `deliveries` and
`transactions.paymentMethod` associations, which need `order_delivery:read` and
`payment_method:read`.

```
403 FRAMEWORK__MISSING_PRIVILEGE_ERROR
missingPrivileges: ["order_delivery:read","payment_method:read"]
```

The permission set only exists inside Shopware, so no unit test could see it.

**Fixed:** both permissions added. Note that Shopware only re-grants permissions
when the manifest `<version>` changes — `app:refresh` otherwise reports
"Nothing to install, update or delete."

## 3. The webhook carries the order, not the transaction

We asserted the opposite — in the code, in the README, and in a commit message:
that `state_enter.order_transaction.state.paid` delivers the transaction, from
which the order must be resolved.

It does not. `data.payload` is an object holding the whole order under `order`:

```json
{ "data": { "event": "state_enter.order_transaction.state.paid",
            "payload": { "order": { "id": "...", "orderNumber": "10005", ... } } },
  "source": { "shopId": "...", "url": "...", "appVersion": "0.1.1" } }
```

Our parser looked for `payload.id`, found nothing, hit a `continue`, and booked
nothing — while answering HTTP 200. Shopware saw a healthy integration.

**Fixed:** parse `payload.order.id`, with the real payload saved as a test
fixture (`src/__fixtures__/order-paid-webhook.json`) rather than one written
from documentation.

**And a detail that saved the design:** the inline order's `billingAddress` is
`null`. The billing address decides the destination country and the invoice
recipient, so the Admin API fetch is still required — the right behaviour, for
a reason we had not understood.

## 4. Skips left no trace

`syncOrder` returned `{ state: "skipped" }` for an unconfigured shop and wrote
nothing anywhere. Combined with #3, an order could pass through the whole
connector leaving no record at all — indistinguishable from the connector being
switched off, or broken.

**Fixed:** every skip, duplicate and dead end is journalled.

## 5. Gross-priced shops were invoiced as if net

Found by running a real order all the way into Scopevisio. The connector held it:

```
The shop calculated 6.38 tax, your Steuermatrix implies 7.60 (19%)
```

Shopware's `price.taxStatus` was `gross`, so `unitPrice` 19.99 already included
tax. The checksum treated it as net and added 19% on top. The same error would
have put gross amounts into the invoice as net — overstating every document from
a gross-priced shop, which is Shopware's default.

The hold was correct behaviour: the pre-post checksum caught a real discrepancy
and refused to post. That is the guard doing exactly its job, on the first live
order it ever saw.

**Fixed:** `OrderLike` now carries `pricesIncludeTax`, the mapper sets it from
`price.taxStatus`, and the checksum removes tax rather than adding it. Verified
against the real numbers: 39.98 gross at 19% is 33.60 net and 6.38 tax, which is
exactly what Shopware reported.

## What actually ran, against live systems

Shopware 6.7.2.2 in Docker, and the real Scopevisio tenant (customer 2039915,
organisation "Simplify AG"), with `autoPost` off throughout so nothing could
reach the ledger.

| Step | Result |
|---|---|
| App installed by Shopware, handshake completed | ✅ |
| Admin API OAuth (client_credentials) | ✅ |
| Real order placed via Store API, transitioned to paid | ✅ |
| Webhook delivered through Shopware's queue, signature verified | ✅ |
| Order fetched with all associations, mapped | ✅ |
| Scopevisio: tax case classified, Erlöskonto resolved | ✅ |
| Scopevisio: contact created — `101070`, `101071` | ✅ |
| Scopevisio: debitor created — `10082`, `10083`, Sammelkonto 1400 | ✅ |
| Pre-post tax checksum | ✅ after fix 5 |
| Invoice document created | ❌ blocked upstream |

The contact read back from the live tenant carried the company name as
`lastname` (so a Gesellschaft, not a Person), the Shopware id in `legacyNumber`,
the VAT ID, the full address, and the tag `shopware` — which is what keeps it
distinguishable from a Shopify-created contact.

**The one remaining failure is not a Shopware problem.** Invoice creation hit
the documented OpenScope import blocker (`API-FINDINGS.md` §7):

```
Scopevisio accepted the import request but created no invoice
(Importierte Abrechnungsbelege: []). The import document was not recognised.
```

The connector detected it and held, rather than reporting a success it could not
confirm — the silent-failure guard working against the live API. This blocks the
Shopify connector identically and is resolved only by the import schema from
whoever owns OpenScope.

### Test data left in the tenant

Contacts `101070` and `101071`, debitor accounts `10082` and `10083`, tagged
`shopware`. Nothing was posted to the ledger. Delete when convenient.

## Operational notes

- **Webhooks go through Shopware's message queue.** With no worker running they
  are never delivered and nothing is logged anywhere. Run
  `bin/console messenger:consume async` before concluding a subscription is
  broken.
- **`webhook_event_log` stays empty** in a default dev install, so it is not a
  reliable place to look for delivery evidence.
- **Shopware's `APP_URL` must be reachable from the connector.** dockware ships
  `http://localhost`, which from outside the container is the wrong port; the
  registration then stores a `shopUrl` the connector cannot reach.
- **Store API registration validates `storefrontUrl`** against the sales
  channel's configured domain.

## What this says about the next connector

Every one of these lived in the gap between documentation and behaviour, and
none was reachable from a test the same author wrote. The cheapest way to find
them was to install the thing.

Budget for a live install before claiming a connector works, and capture real
payloads as fixtures the first time they arrive.
