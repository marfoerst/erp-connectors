# Privacy policy — Scopevisio ERP (Shopify app)

**Draft for legal review. Do not publish unreviewed.**
Last updated: 2026-09-09

The Shopify App Store requires a public privacy policy URL, and this is written
to be that page. It is grounded in what the connector actually stores — verified
against `prisma/schema.prisma`, not assumed — so it should be checked against
the code again if the schema changes.

---

## Who we are

Scopevisio AG provides the Scopevisio ERP app for Shopify ("the app"), which
connects a Shopify store to the merchant's own Scopevisio organisation.

**The merchant is the controller** of their customers' personal data. Scopevisio
acts as a **processor** on the merchant's behalf when operating the app, and as
controller for the merchant's own account data. A data processing agreement
under Art. 28 GDPR is required. *[Legal: confirm the DPA route and add the link.]*

## What the app stores, and what it does not

The app is deliberately built to hold as little personal data as possible. It
passes customer data to the merchant's Scopevisio organisation and then keeps
only the identifiers needed to avoid double-booking.

**Stored by the app:**

| Data | Why | Retention |
|---|---|---|
| Shopify shop domain and access token | To call the Shopify API on the merchant's behalf | Until uninstall |
| Name and e-mail of the Shopify staff user who installed it | Shopify session, provided by Shopify | Until uninstall |
| Scopevisio customer number, organisation and user name | To reach the merchant's ERP | Until the connection is removed |
| Scopevisio password, access and refresh tokens | To authenticate. **Encrypted at rest with AES-256-GCM**; the password is deleted as soon as a refresh token is issued | Until the connection is removed |
| Per order: Shopify order id and name, destination country, resolved Scopevisio contact id, debitor account, document number, tax figures | Idempotency (so an order is never booked twice) and the audit trail | See retention below |
| VAT identification numbers and their VIES validation result, with a timestamp | Reverse charge requires an ID that was valid at the time of supply | See retention below |
| A journal of what the app did per order | So a bookkeeper can answer "what happened to order #1234" | See retention below |

**Not stored by the app:** customer names, postal addresses, telephone numbers,
e-mail addresses, payment details or order line contents. Those are transmitted
to the merchant's Scopevisio organisation to create the contact and the invoice,
and are not retained in the app's own database. Credentials never appear in the
journal — log entries are redacted by key *and* scanned for tokens embedded in
text.

## Where data goes

- **Shopify** — the app reads orders, customers and products with the
  `read_orders`, `read_customers` and `read_products` scopes.
- **The merchant's own Scopevisio organisation** — contacts, debitor accounts
  and billing documents are created there. This is the merchant's own system.
- **VIES** (European Commission VAT validation service) — a VAT identification
  number is sent for validation when a merchant's customer supplies one. No
  other data is sent.

No data is sold, and none is shared with any other third party.

## Retention

Order sync records, VAT checks and the journal are kept while the app is
installed, because they are what prevents double-booking and what evidences
the audit trail.

**On uninstall**, Shopify sends a `shop/redact` request 48 hours later and the
app deletes everything it holds for that shop: the connection and its encrypted
credentials, cached master data, VAT checks, order sync records and the journal.

Documents already created in the merchant's Scopevisio organisation are not
affected — they belong to the merchant's own accounting records and are subject
to their own statutory retention.

## Erasure requests, and why booked invoices are kept

Shopify's `customers/redact` request is answered, but **the app does not delete
personal data attached to a posted accounting document.**

German law requires it: GoBD and §147 AO oblige a business to retain booked
documents and the debitor they reference. An erasure request that would remove a
booked invoice cannot be honoured by deletion. The lawful response is to
restrict processing (Art. 18 GDPR) and retain the record until the retention
period expires (Art. 17(3)(b) GDPR — a legal obligation).

The app therefore records such a request, surfaces it to the merchant, and
deletes nothing automatically. The merchant, as controller, applies restriction
in Scopevisio.

*[Legal: this is the position the code implements — PRD OQ-4. Please confirm the
wording and the article references before publication.]*

## Security

- Scopevisio credentials are encrypted at rest with AES-256-GCM. The key is held
  in the app's environment and is never merchant-configurable, so a tenant
  cannot weaken the protection of its own secrets.
- The password is discarded once a refresh token exists.
- Credentials are redacted from all logs, by field name and by scanning text for
  tokens and bearer credentials.
- Each shop's data is isolated by shop domain on every query.
- Merchants can revoke the app's Scopevisio access at any time from their
  Scopevisio customer portal (Schnittstelle (OpenScope) → API Token), and can
  disconnect from the app's Connection screen.

## Your rights

Merchants and their customers have the rights under GDPR Art. 15–22: access,
rectification, erasure, restriction, portability and objection — subject to the
retention obligation described above.

## Contact

*[Fill in before publication: data protection contact address, postal address,
and the DPO if one is appointed.]*

- Support: `[support e-mail]`
- Data protection: `[dpo or privacy e-mail]`
