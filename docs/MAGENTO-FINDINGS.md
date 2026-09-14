# What a real Magento install found

The Magento connector was tested against Magento Open Source 2.4.9 with Luma
sample data, running in Docker, and the real Scopevisio tenant (customer
2039915, organisation "Simplify AG"). Orders went through Magento's own cart and
checkout API, Magento created the invoices and credit memos, the extension's
observer and outbox delivered them, and the connector fetched everything back
over OAuth-signed REST. Delivery mode was CSV throughout; nothing was posted to
the ledger.

The Shopware lesson held again: the defects that mattered were invisible to
unit tests written from the same assumptions as the code, and three of them sit
in the gap between what an API answers and what it does.

## 1. Scopevisio can return a debitor number it never created

**Affects every connector — fixed in core.**

Several invoices arrived within milliseconds and were synced concurrently. For
two guest contacts, `POST /createdebitor` answered:

- once with debitor number `10086`, which was **never persisted** — the contact
  had no debitor account at all, and `10086` was later assigned to a different
  contact;
- once with **no number**, and again no account.

The response of a successful call is
`{"status":201,"number":"10087","created":true,"errors":{}}`. Core previously took
any number in the response on trust, so both invoices were drafted — one naming
a debitor that belongs to somebody else, one naming none.

**Fixed:**

- `ensureDebitor` (core) treats a non-empty `errors` or a missing number as a
  failure, **reads the account back** with `POST /debitoraccounts` filtered by
  `contactId`, retries once, and otherwise throws. The invoice is retried; it is
  never drafted against an unconfirmed debitor.
- The Magento connector syncs one invoice per store at a time, so a tenant never
  sees concurrent debitor creation from it.

Worth reporting to the OpenScope team: a create endpoint that answers with a
number under concurrency and persists nothing is a data-loss defect.

## 2. A refunded invoice was exported

The outbox delivers a credit memo right behind its invoice. The refund arrived
while the invoice was still being synced, found the record `pending`, withdrew
it — and the sync then finished and wrote `ready_to_export` over the
withdrawal. The refunded invoice went out in the CSV.

The e2e check had used "refund says withdrawn **or** record says withdrawn", so
it passed. It now requires both.

**Fixed:** every final state is written only over `pending` (a conditional
update, so it holds across processes too); a refund waits for an in-flight sync
of its invoice and re-reads the record; and a withdrawn invoice counts as final,
so a redelivered webhook cannot revive it.

## 3. A row that does not divide into cents

Two bags at 45.00 gross are a net row of 75.63. As one position that is
2 × 37.815, which a document can only carry as 37.81 or 37.82 — the CSV said
37.81 and the invoice lost a cent.

Shopify reports unit prices, so its connector never meets this. Magento reports
row totals, and at 19% most gross prices produce such rows.

**Fixed:** the mapper splits the row into `(qty − r) × 37.81` and `r × 37.82`,
so positions add up to Magento's net total exactly. The e2e now checks the sum.

## 4. Things that are true of Magento and cost time

- **Integration tokens are OAuth 1.0a, and must be signed.** Since 2.4.4 they are
  not accepted as bearer tokens unless the merchant enables
  `oauth/consumer/enable_integration_as_bearer` store-wide, which weakens every
  integration. The connector signs (HMAC-SHA256) instead. Signed `GET`s with
  `searchCriteria[filter_groups][0]…` brackets verify fine once the query is part
  of the base string.
- **Activate only calls `postToConsumer`.** The admin button posts the consumer
  key, secret, verifier and store URL to the endpoint and nothing more; the
  connector must then fetch the request and access tokens itself within the
  consumer's five-minute window. The extension's
  `scopevisio:integration:setup --activate` does exactly the same for scripted
  installs.
- **The identity link is not signed.** Magento opens it with only
  `oauth_consumer_key` and `success_call_back`. The connector accepts it only for
  15 minutes after a handshake that proved possession of the verifier; after
  that, the signed admin link is the only way in.
- **"Paid" is an invoice, not an order.** One order can have several invoices.
  The connector books per invoice and keys guest contacts on the order, so two
  partial invoices of one guest land on one contact (verified live).
- **Configurable products are invoiced twice**: the parent with the price, the
  child with `row_total: null` and `price: 0`. Item `discount_amount` is `null`,
  not `0`.
- **Shipping tax is rounded on the gross figure** — 12.60 net × 19% is 2.394, and
  Magento says 2.40. The checksum allows a cent per position.
- **Sample data ships US tax rates only.** The dev install script adds DE 19% and
  switches the store to gross prices, so the test exercises the gross path that
  broke the Shopware connector.
- **Admin-token checkout has no `payment-information` route** — that exists only
  for guest and `mine` carts. Use `billing-address` then `PUT …/order`. And
  `POST /customers/:id/carts` returns the customer's existing active cart,
  including items an interrupted run left in it.
- **The sample customer's default address merges into a new one.** Region 33
  (Michigan) was carried onto a German address and Magento refused the order
  until the region was cleared explicitly.
- **`fetch().text()` strips a UTF-8 BOM**, so a test that checks the CSV's BOM
  must read bytes.

## 5. Not a defect, but decide it: the EU B2C account lookup

An Austrian consumer order from a merchant **not** in OSS is classified
`eu_b2c` and mapped to Steuersachverhalt 1 (Inland), which is right: German VAT
applies. Core then asks for revenue accounts with `country=AT`, and the test
tenant has none, so the invoice is held (`no_revenue_account`).

Whether that lookup should use the destination country or the home country for a
below-threshold EU consumer sale depends on how Scopevisio models such tenants'
Steuermatrix. It is the open question PRD **OQ-5** already asks Tax to sign off,
and it lives in shared VAT code, so it was deliberately not changed here. The
connector holds rather than guesses either way.

## Test data left in the tenant

Contacts from `101075` upwards and debitor accounts from `10085`, tagged
`magento` / `magento-guest`, groups "Magento E2E" and "Magento E2E Gast". Contact
`101076` has no debitor (the lost one from finding 1). Nothing was posted to the
ledger. Delete when convenient.
