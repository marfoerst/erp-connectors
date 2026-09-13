# What a connector marketplace requires first

Twelve comparables studied: weclapp, Xentral, Odoo, lexoffice, sevDesk, DATEV,
Personio, HubSpot, Sage, Xero, QuickBooks/Intuit, Shopware.

## The minimum capability set, ranked by what blocks what

1. **Per-app client registration** — a unique `client_id`/secret per connector.
   The non-negotiable one. Certification, per-app rate limits, per-app analytics,
   revoking a single app and any abandonment policy all depend on the platform
   being able to tell apps apart at the auth layer. Without it there is no
   governance, only trusting everyone equally forever.
2. **Real OAuth2 scopes**, not all-or-nothing. Least privilege, a tiered trust
   model, and a defensible answer under GDPR Art. 5(1)(c).
3. **Mandatory client secret plus PKCE.** Table stakes under OAuth 2.1.
4. **Published numeric rate limits** with a structured error contract.
5. **A sandbox or test tenant.** Free trials are the baseline; nobody in this set
   has a resettable synthetic sandbox, so a modest one is competitive.
6. **A versioning and deprecation policy.** Lexware gives 180 days; HubSpot runs
   date-based versions with an 18-month window.
7. **Self-service developer signup.** Odoo, HubSpot, Personio and sevDesk let a
   developer start today; lexoffice, Xentral and DATEV require a sales
   conversation first, and grow measurably slower.
8. **Webhooks** — ranked low deliberately. Odoo ran polling-only for 15 years and
   still built a 51,000-module store.
9. **A criteria-based review that scales without a named human.** HubSpot is the
   only one with numeric, SLA'd, self-service criteria (3 installs to list, 60 to
   certify; 10 business days first response, 60 days full review).
10. **Commercial clarity** — matters least. See below.

## Credential sharing is a settled question

**Zero of twelve** let a connector hold the customer's actual login password.

Xero's certification checklist, verbatim: *"Never request a user's Xero login
details within your application; you should always use OAuth for
authentication."*

The regulatory analogue is PSD2's ban on screen scraping. The reasoning maps
directly onto an ERP: raw credentials cannot be scoped, cannot be revoked for one
integration without breaking every other, multiply breach surface, and conflict
with data minimisation. Operationally, a password rotation or an offboarding
silently breaks every connector holding a copy, with no registry of who holds
what.

**Intuit has a precedent for forcing the migration**: new third-party security
requirements published 18 Dec 2019, deadline 11 Feb 2020, and non-compliant apps
simply stopped syncing. Nobody was grandfathered.

**Even non-OAuth models avoid it.** Shopware's handshake mints an apiKey/secretKey
pair and never sees admin credentials — which is the property that matters, not
OAuth specifically. But it still shipped **CVE-2026-31889** (CVSS 8.9):
re-registration did not re-verify domain control, so anyone with an app secret
could re-point an installed shop. Bind the credential to an endpoint, not just to
possession.

## Polling-only at scale

Common, and in poor company: sevDesk (none), DATEV (async task polling), weclapp
(5 resources), Xentral (feature-flagged, never GA), Personio (3 retries in
30–60s, so integrators build reconciliation anyway).

Cost: Zapier's published figure is that ~1.5% of polls find anything, so matching
webhook freshness costs roughly 65× the request volume. A single fixed polling
interval can exhaust a 100,000/day quota before any real work.

**The compounding case is the dangerous one.** Twenty connectors polling the same
tenant independently, against one undocumented ceiling, from one undifferentiated
bucket — and with a shared client identity, the load cannot be attributed to the
connector causing it. One bad integration degrades everyone with no way to find
or throttle it.

## How these fail

- **Odoo — volume without curation.** 51,000 modules; the review gate checks for
  an icon, a cover image, a licence and a rating above 3.0. Community advice is
  to check the publisher's last update date, because "a module untouched for two
  years or more will likely break at your next upgrade."
- **weclapp — the retreat.** A direct competitor opened a marketplace and pulled
  back: new listings are *"vorübergehend nur für unsere Vertriebspartner
  möglich."*
- **Sage — thin despite scale.** Promised "hundreds of trusted apps" to two
  million customers; 79 at launch, ~116–141 years later. Several non-unified
  marketplaces, and the commerce layer licensed from AppDirect rather than owned.
- **DATEV — deliberate contraction**, raising the bar in 2026 and ending or
  downgrading partnerships. DATEV reportedly ended its Premium Partnership with
  Personio after Personio launched competing payroll. *(Sourced via a search
  snippet only — verify before repeating it with partners in the room.)*
- **The cross-cutting cause:** with the exception of HubSpot and DATEV's Premium
  tier, **none publish any re-certification or delisting-for-inactivity policy.**
  Nothing ever removes a dead connector, which is precisely how catalogues become
  ghost towns.

## Sequencing — the most useful finding

**Xero opened its API in 2009, certified its first app in 2011, and did not
launch a transactable App Store until 4 August 2021.** A decade of open API and
independent build-out came first; discovery, certification and billing were
bolted on once there was something to list. Intuit's 2009 App Center launched
with twenty-plus apps it *recruited* rather than built.

Two comparables enforce that ordering as policy: Personio will not review a
partner below ten live customers, DATEV requires twenty-five.

So: fix the auth model, publish the API properly, recruit the first ten
integrations, and only then build a storefront.

## Commercial model

Do not design in a revenue share. HubSpot and Personio charge developers nothing
and take nothing — the marketplace is a discovery and trust layer, not a billing
layer. **Xero retired its 15% referral share on 2 March 2026** for flat
developer-paid tiers; **Intuit introduced tiered platform fees in July 2025**.
Two of the three most mature ecosystems concluded a pure revenue share does not
fund platform operations. DATEV inverts it entirely: partners pay DATEV.

## Not found

Revenue-share percentages for weclapp, Xentral and Shopware; approval SLAs for
everyone except HubSpot and Personio; whether SAP Store has stagnated
(inconclusive either way).
