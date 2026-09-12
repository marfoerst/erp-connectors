# Protected customer data — declaration prep

Shopify requires an app requesting protected customer data to declare what it
accesses, why, and what safeguards are in place. This is the prepared answer
set, grounded in the code rather than in intent, so the Partner Dashboard form
can be filled in directly.

Request: **Level 2** — name, address, phone or email put an app at level 2 by
definition; we request Name, Address and Email, and not phone.

**There is no review for this app.** Levels 1 and 2 are *always available* to a
custom-distribution app; only public apps are reviewed
([distribution table](https://shopify.dev/docs/apps/launch/protected-customer-data)).
Select the data and the three fields once in the Partner Dashboard and the
`orders/paid` and `refunds/create` subscriptions in `shopify.app.toml` start
working.

That removes a gate, not an obligation. The level 1 and 2 requirements below are
binding through the Partner Program Agreement whether or not anyone checks them,
and the four rows marked as needing infra facts still need real answers — for
our own compliance file, and for the merchant's GDPR paperwork, which is the
harder audience.

## Why each field is needed

| Field | Why the app cannot work without it |
|---|---|
| **Name** | A German invoice must name the recipient. `KontaktForm.lastname` is a mandatory field on the Scopevisio contact, and the Faktura carries it |
| **Address** | §14 UStG requires the recipient's full address on an invoice. The address also determines the destination country, which in turn determines the VAT treatment — it is the single most consequential input in the app |
| **Email** | Identifies a returning customer against an existing Scopevisio contact, so the connector does not create a duplicate debitor. Also the merchant's own dedupe key for contacts that predate the integration |
| Phone | **Not requested.** Nice to have on a contact, not needed to book an invoice |
| Payment details | **Not requested and never accessed** |

## Safeguards, as implemented

| Shopify's question | Answer |
|---|---|
| Purpose limitation | Data is used solely to create the contact, debitor account and invoice in the merchant's own Scopevisio organisation. No analytics, no profiling, no secondary use |
| Data minimisation | The app stores **no** customer names, addresses, phone numbers or e-mail addresses in its own database. It transmits them to the merchant's ERP and retains only identifiers — Scopevisio contact id, debitor account number, document number — plus the destination country and tax figures needed for the audit trail |
| Encryption at rest | Scopevisio credentials are AES-256-GCM encrypted. The password is deleted once a refresh token exists. Order records hold no personal data to encrypt |
| Encryption in transit | All Shopify and Scopevisio traffic is HTTPS |
| Access controls | Data is queried by shop domain on every path, so one merchant's data is unreachable from another's session. Credentials are redacted from logs by field name and by scanning text for embedded tokens |
| Retention | Held while installed; deleted in full on `shop/redact`. Documents in the merchant's Scopevisio organisation are the merchant's own records |
| Staff access | *[Fill in: who at Scopevisio can access production data, and under what process]* |
| Sub-processors | Shopify; the merchant's own Scopevisio organisation; VIES (VAT number validation only). *[Confirm the hosting provider and add it]* |
| Encryption of backups | *[Fill in from the hosting setup]* |
| Data residency | *[Fill in — EU hosting is expected for a German ERP integration and is likely a customer requirement]* |

## Testing vs production

Order intake does **not** depend on this grant: the app polls the Admin API with
the already-granted `read_orders` and `read_customers` scopes. The grant is what
enables the `orders/paid` and `refunds/create` webhook subscriptions, which are
the low-latency path. With the subscriptions present and the grant absent,
`shopify app dev` refuses to start — which is why they are commented out in
`shopify.app.toml` with instructions.

For a **public** app the grant also governs API reads, so it is required for App
Store distribution regardless of the intake path.

## Open items for a human

1. Staff access process, sub-processor list, backup encryption and data
   residency — the four rows marked *[Fill in]* above.
2. The GDPR-vs-GoBD retention position needs a written legal sign-off; the code
   already implements restriction-not-deletion (PRD OQ-4, and the reasoning is
   in `docs/PRIVACY.md`).
