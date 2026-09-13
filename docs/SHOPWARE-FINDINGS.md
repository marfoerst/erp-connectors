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
