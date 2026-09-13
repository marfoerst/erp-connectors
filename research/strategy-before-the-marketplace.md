# Before the marketplace

Scopevisio has thirteen integrations. Comparable platforms have a hundred and
fifty. The gap is not a backlog of connectors — it is three missing fields in
the OAuth layer, without which a marketplace cannot be governed at all.

## The blocker is smaller than it looks, and worse

An earlier reading held that OpenScope forces the password grant. **That was
wrong**, and the correction matters: the delegated flow already exists.

Read directly from `appload.scopevisio.com/rest/openapi.json` on 13 Sept 2026:

| Evidence | What it means |
|---|---|
| `grant_type ∈ password \| refresh_token \| authorization_code` | The delegated flow is implemented. A tenant can authenticate on a Scopevisio page instead of handing an ERP password to a connector |
| `security: [{oauth: []}]` on all **321** operations; `/static/authorize.html` returns 200 | The whole API is nominally OAuth2-secured and the page is live |
| `"scopes": { }` | **Empty.** A token is all-or-nothing, bounded only by the user's profiles |
| `client_id` — *"if not set, will revert to `sv`"*, secret optional | **The auth layer cannot tell one app from another** |
| `pkce` / `code_challenge` — 0 occurrences in 831 KB | No protection against authorisation-code interception |
| `webhook` / `callbacks` / `subscription` — 0 occurrences each | No event delivery of any kind. `/events` is the calendar object |
| `ratelimit` / `x-rate` — 0 occurrences | No published limits |

The shared `client_id` decides whether a marketplace is possible. Certification,
per-app install counts, per-app rate limits, suspending one bad connector and any
delisting policy all require identifying which app made which call. **Scopevisio
cannot today revoke one connector without revoking all of them, throttle one, or
measure any of them.**

The uncomfortable comparison: this carries OAuth's full implementation complexity
while delivering the same unscoped access as weclapp's and Xentral's plain static
tokens — and unlike those, cannot distinguish callers.

So the ask is not "build OAuth". It is **finish the OAuth that is already
there**: scopes, client registration, PKCE.

## Two gaps that multiply each other

Polling-only is survivable — Odoo did it for fifteen years. Undocumented limits
are survivable. A shared client identity is survivable at one connector.

All three together is the failure mode. Twenty connectors poll the same tenant
independently; roughly 1.5% of polls find anything, so freshness costs ~65× the
request volume events would. They hit one undocumented ceiling from one
undifferentiated bucket, and because every one authenticates as `sv`, **the load
cannot be attributed to the connector causing it.** One badly written integration
degrades every other and Scopevisio's own traffic, with no way to find it.

That is not a scaling curve. It is a cliff, and it arrives the first time the
ecosystem works.

## What has to ship first

1. **Per-app client registration** — bind the credential to an endpoint, not just
   to possession (see CVE-2026-31889 in report 06)
2. **Real scopes**
3. **Mandatory secret plus PKCE**
4. **Published rate limits and an error contract**
5. A sandbox tenant
6. A versioning and deprecation policy
7. Self-service developer signup
8. Webhooks (later, but see the compounding above)
9. **An abandonment policy, written on day one** — cheap now, politically
   impossible to retrofit onto existing partners

## Sequencing: do not build a storefront yet

Xero opened its API in 2009 and did not launch a store until 2021. Intuit
recruited its first twenty apps rather than building them. Personio requires ten
live customers before review; DATEV twenty-five.

**Fix items 1–4, publish the API properly, recruit the first ten integrations,
then build a storefront.** The two developers who already shipped unofficial
OpenScope SDKs are where recruiting starts.

## Which connectors

Two filters change the obvious answer. **~5,000 of 7,500 customers are
Dienstleister**, so commerce serves the smallest slice. And **do not connect what
Scopevisio already sells** — it ships project management, time tracking, CRM, DMS
and BI.

1. **Payroll** — Personio, HRworks, DATEV LODAS. The HR module advertises
   external payroll interfaces and has one narrow partner.
2. **E-signature** — DocuSign, Skribble. Zero integrations against a mature DMS.
3. **Travel and expense** — Circula, Moss.
4. **Shopware**, then Otto and Kaufland. *(Built — see `connectors/shopware`.)*
5. **Care documentation** — MEDIFOX DAN, Connext Vivendi.

## The strategic tension worth naming

DATEV reportedly ended its Premium Partnership with Personio after Personio
shipped competing payroll. Scopevisio's own pattern is *buy the capability* —
Filosof for hotel PMS, act'o-soft for POS.

**Thirteen integrations is not a resourcing failure. It is the natural output of
a buy-or-partner posture.** A marketplace asks partners to invest in a platform
whose owner has repeatedly acquired into adjacent space. That is a change of
posture, not a project, and partners will price in the risk.

Two things make the commercial side easier than expected: the most mature
ecosystems charge developers nothing, and the direction of travel is away from
revenue share (Xero retired its 15% in March 2026; Intuit moved to flat tiers in
July 2025). At thirteen integrations, supply is the constraint.

## What connector #1 and #2 already proved

The Shopify connector hit these blockers before any third party could. It took
weeks, surfaced fourteen defects findable only by testing, and still has one
capability blocked — built by someone with direct access to the OpenScope team.
**A third party without that access would have abandoned it.**

The Shopware connector then made the same point from the other side: it passed 69
unit tests and a 16-case harness, and a real install broke it in five places
within the hour (`docs/SHOPWARE-FINDINGS.md`). Both connectors confirm the same
thing — the API is the product, and every hour spent on items 1–4 is an hour not
spent by every future connector author.

## Verification status

**Read first-hand, not taken from research:** every auth finding above, by
counting occurrences across the whole spec; `/static/authorize.html` live; the
connector defects, from the repository.

**Directional only:** integration counts (a careful enumeration of a public
partner page, not an official figure); per-vertical customer splits; app-revenue
figures; the DATEV–Personio termination (search snippet, article blocked).
