# German accounting and ERP APIs

Surveyed as possible connector targets and as comparables. The finding that
matters most is about DATEV.

## DATEV cannot create an invoice

**No DATEV route lets a third party originate a numbered sales document.** Every
interface — EXTF, Rechnungsdatenservice 1.0/2.0, DATEVconnect — carries
bookkeeping data *toward* a Steuerberater's ledger, where a human finalises it.

That is a structural argument for this entire product category: if the invoice
cannot be created in DATEV, it must be created upstream, and for a commerce
merchant upstream is the shop or the ERP.

### Routes, by realistic feasibility

1. **EXTF / DATEV-Format CSV — lowest barrier, recommended.** No API key, no
   partnership, no approval; the accountant imports the file. Header encodes
   format version and `Datenkategorie` (21 = Buchungsstapel, 16 = Debitoren/
   Kreditoren-Stammdaten). Decades old, universally supported. Community
   consensus on Windows-1252 / CRLF / semicolon could not be confirmed from a
   DATEV-authored spec.
2. **Rechnungsdatenservice 1.0 / 2.0** — moderate barrier; 1.0 produces booking
   *proposals*, 2.0 handles outgoing invoice data with more automation.
   Integrators report real friction (per-mandant configuration, silent failures).
3. **DATEVconnect online** — modern REST with OAuth2/OIDC + PKCE, but gated
   behind DATEV partner status plus a mandatory pre-production technical review.
   A commercial gateway (riecken.io) resells access with a sandbox.
4. **DATEV Marktplatz** — needs **25 live customers on an existing DATEV service
   just to apply**. Unreachable pre-launch by construction. "Schnittstelle
   zertifiziert" is an ISO-27001-class certification, mandatory for Premium
   Partners from 1 July 2026.
5. **DATEV E-Rechnungsplattform (Traffiqx)** — free vendor API access stated,
   was targeted at mid-2026. Worth re-checking; it is invoice-shaped rather than
   journal-shaped.

## The others

"Real invoice" means three different things, and the distinction matters:

- **Direct, posted, numbered immediately:** SAP Business One (`POST /Invoices`),
  sevDesk, lexoffice, easybill, FastBill, Billomat.
- **Draft-then-post, two calls:** Odoo (`action_post`) and Dynamics 365 Business
  Central (`Microsoft.NAV.post`).
- **Order-triggered side effect:** Xentral, Billbee, JTL — and JTL's modern REST
  API does not support it at all.
- **Never:** DATEV.

| System | Access gate | Auth | Webhooks |
|---|---|---|---|
| lexoffice / Lexware Office | self-serve key; OAuth2 Partner API needs approval | Bearer / OAuth2 | Yes |
| sevDesk | self-serve token | static token, no expiry | **None** |
| Billbee | emailed API key | key + Basic | Yes. **Metered since 1 Nov 2025** — 100k free calls/month, then €0.0005/call, billed to the integrator |
| Xentral | self-serve | Personal Access Token, unscoped, non-expiring | behind a feature flag |
| weclapp | self-serve trial | static token, no scopes | 5 resources only |
| Odoo | self-serve; Community self-hosted is free | API key | added in Odoo 17 (2023) |
| SAP Business One | PartnerEdge; **no open sandbox** | session cookie, OAuth2 since 10.0 FP2305 | not found |
| Dynamics 365 BC | free trial | OAuth2 | Yes, but subscriptions expire every 3 days |

Notable: Lexware Office moved its API domain to `api.lexware.io` around May 2025.
BC's German DATEV export truncates invoice numbers at 12 characters. SAP B1
ships a native DATEV-FI interface at no extra licence cost.

## Not found

Exact EXTF spec price, DATEV Marktplatz listing fees, weclapp's webhook reality
(two credible sources contradict each other), JTL's current WaWi REST auth
model, and partner revenue-share percentages for most vendors.
