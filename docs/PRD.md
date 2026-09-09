# PRD — Scopevisio Connector for Shopify

| Field | Value |
|-------|-------|
| **Title** | Scopevisio Connector for Shopify — Order-to-Cash |
| **Outcome (one line)** | A Shopify order becomes a correct, GoBD-compliant Faktura in Scopevisio without a bookkeeper touching it |
| **Author** | Martin Förster (Director of Product) |
| **Date** | 2026-09-08 |
| **Status** | Draft |
| **PRD Mode** | A — Full PRD |
| **Target Outcome Window** | First paying tenants live by end of Q4 2026 |
| **Outcome Review Date** | 6 weeks after GA (apply decision rules) |
| **Stakeholders** | Engineering Lead [TBD], Design [TBD], OpenScope API owner [TBD], Tax/Compliance [TBD], CS [TBD] |

---

## Problem & Desired Outcome

### The Problem

A German SMB that sells on Shopify and keeps its books in Scopevisio has no
connection between the two. Every paid order is re-entered by hand: the
bookkeeper opens the Shopify admin, reads the order, looks up or creates the
customer as a debitor, decides the VAT treatment, types the positions, and posts
the invoice. Refunds are worse — they require a credit note that has to be
matched back to an invoice that may have been posted weeks earlier.

Three costs follow:

1. **Time that scales with revenue.** Manual entry is linear in order volume, so
   growth on Shopify is punished with bookkeeping headcount. This is the reason
   merchants give for not putting their shop revenue into their ERP at all.
2. **VAT classification errors.** The person typing the invoice has to decide the
   Steuersachverhalt from a shipping address and a tax amount. Cross-border B2C
   (OSS), intra-EU B2B (reverse charge) and third-country export all look similar
   on a Shopify order and are legally distinct. An error flows into the UStVA.
3. **A gap in the audit trail.** Because entry is manual and batched, the shop
   and the ledger disagree for days at a time, and there is no systematic link
   from a booked document back to the order that caused it.

The workaround today is either a generic middleware (Zapier/Make) that cannot
reason about German VAT, a CSV import that loses the customer link, or simply not
booking shop revenue in detail.

### Evidence

**[EVIDENCE NEEDED]** — No quantitative or qualitative evidence has been attached
to this problem statement. Before this PRD moves to "In Review" we need at least
one of:

- Count of existing Scopevisio tenants who also run Shopify (queryable internally)
- Support/CS tickets or sales-call notes requesting a Shopify connection
- Interview notes from 3–5 bookkeepers doing this manually today, with a measured
  time-per-order
- Competitive check: what Shopify-to-DATEV/ERP connectors these merchants use instead

The design constraints in this document are verified against the OpenScope API
(see `docs/API-FINDINGS.md`); the *demand* is not yet evidenced.

### Customer Outcome

The bookkeeper stops transcribing orders. Shop revenue lands in the ledger
continuously and correctly classified, so the shop stops being a separate world
they reconcile at month-end and becomes just another source of bookings they
supervise. Their job changes from typing to reviewing exceptions.

### Business Outcome

Scopevisio becomes viable for e-commerce SMBs, a segment it currently loses by
default. Two effects: a new acquisition channel via the Shopify App Store (where
these merchants already look for solutions), and reduced churn risk among
existing tenants who grow into e-commerce and would otherwise migrate to a suite
that already integrates. Connects to Net Revenue Retention and new-customer
acquisition.

---

## Outcome Hypothesis

We believe that enabling **the bookkeeper of a Shopify-selling SMB** to **have
every paid order arrive in Scopevisio as a correctly classified, ready-to-post
Faktura they only need to supervise** will achieve **the elimination of manual
order entry and of VAT misclassification on shop revenue**.

We'll know we're **right** when **the share of paid orders that become a posted
Faktura with no human edit** moves from **0% (no integration exists)** to
**≥ 95%** by **6 weeks after GA**.

We'll know we're **wrong** if **more than 10% of documents land in the exception
queue, or if bookkeepers routinely edit the generated Faktura before posting** —
either signal means we have not actually removed the work, only moved it. At that
point we stop adding scope and re-examine the VAT and customer-matching
assumptions, which are where we expect to be wrong.

---

## Success Metrics & Decision Rules

| ID | Metric | Type | Baseline | Target | How we'll know (data source) | Timeline |
|----|--------|------|----------|--------|------------------------------|----------|
| M-001 | Share of paid orders becoming a posted Faktura with no human edit | Leading | 0% (no integration) | ≥ 95% | Connector's own sync log, per tenant | 2–4 weeks post-launch |
| M-002 | Median time from `orders/paid` to Faktura posted | Leading | n/a (manual: hours–days) | < 15 min | Connector sync log | 2–4 weeks post-launch |
| M-003 | Exception rate — documents held for human decision | Leading | n/a | < 5% of orders | Connector exception queue | 2–4 weeks post-launch |
| M-004 | Self-serve setup completion — installs that reach first successful posted Faktura without support contact | Leading | n/a | ≥ 70% | Install funnel + CS ticket join | 2–4 weeks post-launch |
| M-005 | Bookkeeper minutes per 100 shop orders | Lagging | **[BASELINE NEEDED — measure with 3–5 merchants before launch]** | ≤ 10 min | Timed observation / customer interview | 1–3 months post-launch |
| M-006 | VAT correction bookings on shop revenue per quarter | Lagging | **[BASELINE NEEDED — sample current manual tenants]** | ≤ 1 per tenant per quarter | Scopevisio journal, correction bookings on shop revenue accounts | 1–3 months post-launch |
| M-007 | Tenants with an active, non-erroring connection 30 days after install | Lagging | n/a | ≥ 80% | Connector health telemetry | 1–3 months post-launch |

### Decision Rules (applied at the Outcome Review)

| Result | Decision |
|--------|----------|
| M-001 ≥ 95% and M-003 < 5% | Scale — invest in the deferred capabilities (stock, payment reconciliation, B2B terms) |
| M-001 80–94%, or M-003 5–15% | Iterate on the specific failure classes before adding any new scope |
| M-001 < 80%, or M-003 > 15%, or M-004 < 40% | Stop and rethink. Either the VAT/customer model is wrong, or self-serve configuration is not achievable and this needs to be a service, not an app |

---

## Goals

| # | Goal (outcome-framed) | Connected Metric | Priority |
|---|----------------------|-----------------|----------|
| G1 | Shop revenue reaches the ledger without manual transcription | M-001, M-005 | Must |
| G2 | Every document carries the legally correct VAT treatment, including cross-border | M-006 | Must |
| G3 | A merchant can connect and maintain Scopevisio themselves, entirely inside Shopify | M-004, M-007 | Must |
| G4 | When something cannot be decided automatically, the bookkeeper sees it, understands it, and can resolve it | M-003 | Must |
| G5 | Refunds produce a legally correct Gutschrift tied to the original invoice | M-001 | Must |
| G6 | The connection survives unattended — credentials, retries and duplicates never require a developer | M-007 | Should |

## Non-Goals

| # | Non-Goal | Why It's Out of Scope |
|---|----------|-----------------------|
| NG1 | Stock / inventory sync in either direction | The OpenScope API exposes no stock-level read. Blocked on OQ-1, not on effort. Shipping a half-correct stock figure to a storefront is worse than shipping none |
| NG2 | ERP → Shopify customer push | Confirmed: no business case. Customer flow is one-way by decision |
| NG3 | ERP → Shopify product & price master sync | Real value, but independent of order-to-cash and would double the surface area. Candidate for V2 |
| NG4 | Payment reconciliation / bank matching of Shopify payouts | Belongs to the banking module's domain, needs payout-level data, separate outcome |
| NG5 | Building our own VAT determination engine | Scopevisio's Steuermatrix already is the authority. Duplicating it guarantees divergence |
| NG6 | B2B net terms, dunning, credit limits at checkout | Requires open-item data at checkout time; different persona and outcome |
| NG7 | Non-EUR currencies and multi-entity consolidation | V1 targets single-entity EUR tenants. Multi-currency changes the whole VAT and posting model |
| NG8 | Shopify POS / in-store orders | Different tax and document treatment; not the wedge |

---

## Customer Story

**Buchhalter/in (persona-1)** needs every sale the company makes to end up in the
ledger, correctly classified, in time for the UStVA on the 10th. Today, shop
orders are the exception: they arrive in a system she doesn't own, so once or
twice a week she works through the Shopify admin, retyping orders into
Scopevisio, guessing which orders are intra-EU B2B, and hand-matching refunds to
invoices she posted a fortnight ago. It takes hours she resents, and she is never
fully confident the VAT is right on the cross-border ones.

After this, shop orders simply appear in Scopevisio as Fakturen, already carrying
the right Erlöskonto and Steuerschlüssel, with the customer already a debitor.
Her work is a short review queue: a handful of orders the system refused to guess
on, each explaining what it needs from her. Refunds arrive as credit notes
already tied to their invoice.

As a result, shop bookkeeping drops from hours per week to minutes, and the
cross-border VAT question is answered by the Steuermatrix she already maintains
rather than by her memory.

---

## Target Persona

| Field | Detail |
|-------|--------|
| **Persona ID** | persona-1 |
| **Name / Role** | Buchhalter/in — Bookkeeper |
| **Context** | German SMB, 5–250 employees, sells physical goods via Shopify, books in Scopevisio. Often the only person who understands both the shop's numbers and the ledger |
| **Current Pain** | Manual re-entry that scales with order volume; low confidence on cross-border VAT; refunds are archaeology |
| **Desired Outcome** | Shop revenue is booked continuously and correctly; her role is supervision, not transcription |
| **Usage Frequency** | Daily (review queue), with peaks at month-end and before the UStVA deadline |

**Secondary:** persona-2 Geschäftsführer/in — installs the app and owns the
decision; needs to trust that shop revenue is booked correctly without becoming
the person who operates it.

**Secondary:** persona-3 Steuerberater/in — never touches the app, but inherits
its output. If the Erlöskonten and Steuerschlüssel are wrong, the tax advisor is
who discovers it, and their trust is what the merchant actually relies on.

---

## Capabilities the Customer Needs

### What the customer is trying to accomplish

Two distinct jobs, by two people. The **merchant/owner** wants to connect their
shop to their accounting once, understand that it is working, and not think about
it again. The **bookkeeper** wants shop revenue to arrive in the ledger correctly
classified, and wants to be told — clearly and in accounting terms — about
anything the system could not decide on its own.

### Capabilities

| ID | The customer must be able to… | Priority | Done when (observable from the customer's side) | Serves outcome |
|----|-------------------------------|----------|------------------------------------------------|----------------|
| C-001 | Connect their Scopevisio organisation from inside Shopify, without a developer, a config file, or a support call | Must | A merchant with their Scopevisio credentials and customer number reaches a "connected" state in the Shopify app and sees which organisation they are connected to | M-004 |
| C-002 | See, in accounting terms they recognise, how shop data will be mapped before anything is booked — and change it | Must | Before enabling sync, the merchant can review and set: which Kundengruppe and Nummernkreis new customers get, which tax treatment applies to which destination, and which document type is created. Values come from their own Scopevisio master data, not free text | M-001, M-006 |
| C-003 | Have every paid order arrive as a Faktura with the customer already set up as a debitor | Must | For a paid order, a Faktura exists in Scopevisio referencing a debitor, with positions matching the order, and the bookkeeper made no entries | M-001, M-005 |
| C-004 | Trust that a guest checkout is booked properly rather than skipped | Must | An order from a customer with no Shopify account produces a Faktura against a correctly configured one-off customer account, with the buyer's real name and address on the document | M-001 |
| C-005 | Rely on the VAT treatment being taken from their own Steuermatrix, including cross-border and OSS cases | Must | For domestic, EU B2C, EU B2B with a valid VAT ID, and third-country orders, the resulting document carries the Erlöskonto and Steuerschlüssel that their own Scopevisio configuration prescribes for that case and date | M-006 |
| C-006 | Be stopped, not guessed at, when the tax outcome is uncertain | Must | When the shop's calculated tax and the ERP's expected tax disagree beyond rounding, no document is posted; it appears in the review queue naming both figures and the case that was assumed | M-003, M-006 |
| C-007 | Never see the same order booked twice, however many times it is retried | Must | Replaying the same order — by webhook redelivery, manual retry, or reconnection — results in exactly one Faktura | M-001 |
| C-008 | Have a refund become a Gutschrift tied to the original invoice | Must | A full or partial refund in Shopify produces a credit note in Scopevisio referencing the original document, with the refunded positions and the same tax treatment | M-001 |
| C-009 | See what the connector did, per order, in a form they can answer a question with | Must | For any order, the bookkeeper can see whether it was booked, which document it became, and if not, why not — without leaving Shopify | M-003, M-007 |
| C-010 | Resolve a held document themselves and let it proceed | Must | For each exception class, the review queue offers the decision the bookkeeper is qualified to make, and acting on it either books the document or records why it never will be | M-003 |
| C-011 | Learn that the connection has broken before their books are behind | Must | If credentials expire or Scopevisio is unreachable, the merchant is told inside Shopify, and no order is silently lost while it is broken | M-007 |
| C-012 | Reprocess a period after fixing their own master data | Should | After correcting a Steuermatrix entry or product mapping, the bookkeeper can re-run the affected held orders without re-triggering the ones already booked | M-003 |
| C-013 | Know that a customer's erasure request has been honoured as far as the law allows | Should | An erasure request from Shopify results in the contact's personal data being restricted, with booked documents retained, and the merchant can see that this is what happened and why | — (compliance) |
| C-014 | Choose whether a document is posted automatically or left for review | Could | The merchant can run in "create but don't post" mode, and switch to automatic once they trust it | M-001, M-004 |
| C-015 | Map a Shopify payment method to a Zahlungsart so the document reflects how it was paid | Could | Documents carry the payment type matching the order's payment method | — |

### The experience we're aiming for

**Setup happens once, inside Shopify, and reads like accounting.** The merchant
installs the app, enters the Scopevisio credentials they already have, and is
shown their own organisation's master data to confirm choices against — their
customer groups, their number ranges, their tax cases. Nothing asks them to
invent a value or paste an identifier from a documentation page. When they finish,
the app tells them plainly whether it is connected and what will happen to the
next order.

**Steady state is silence, punctuated by a short queue.** Orders are booked
without notification. The bookkeeper's daily interaction is a review list which is
usually empty, and when it isn't, each entry is phrased as an accounting
question — "this order ships to France with a VAT ID we could not validate; book
it with German VAT or hold it?" — not as a technical error. Resolving one takes a
click and a reason, and the reason is recorded.

**Trust is earned by being conservative.** The connector would rather hold a
document than post a wrong one, because a posted document cannot be unposted. The
merchant should come to believe that anything which *was* booked is right, which
is what makes the empty queue meaningful.

**Nothing is ever silently dropped.** Every paid order ends in one of exactly
three visible states: booked, held with a reason, or explicitly declined by a
human. There is no fourth state, and no order that simply isn't there.

### When things go wrong (customer view)

| Situation | What the customer should be able to understand / do |
|-----------|-----------------------------------------------------|
| Scopevisio credentials expire or are revoked | Told inside Shopify that the connection needs re-authorising, told how many orders are waiting, and able to reconnect and have them proceed |
| Shop tax and ERP tax disagree | Document is not posted. Both figures and the assumed tax case are shown. Bookkeeper can accept the ERP treatment, or fix their master data and reprocess |
| A VAT ID cannot be validated | Order is held rather than booked as reverse charge. Bookkeeper can book it with domestic VAT or hold pending the customer's response — the choice is theirs and is recorded |
| A customer might already exist under a different email | A new contact is created rather than a wrong one reused. The possible duplicate is surfaced for a bookkeeper to merge in Scopevisio |
| A product on the order has no counterpart in Scopevisio | Document is held naming the missing article, so the bookkeeper can create or map it and reprocess |
| Scopevisio is unreachable | Orders queue rather than fail. The merchant sees a delay, not a loss, and the queue drains by itself |
| An order is refunded before its invoice was ever posted | No Gutschrift against a non-existent document; the pending invoice is withdrawn instead, and this is visible |
| The same webhook arrives twice | Nothing observable happens the second time |

---

## Quality Expectations & Guardrails

### Quality the customer should feel

| Expectation (customer terms) | Why it matters |
|------------------------------|----------------|
| "Anything that got booked is right" | The entire value is trust. One wrong posting that reaches the Steuerberater costs more credibility than fifty held documents |
| "Nothing I sold is missing from the books" | GoBD completeness. A silently dropped order is an audit finding |
| "It keeps up without me watching it" | If the bookkeeper has to check whether it ran, the work hasn't been removed |
| "When it stops, I find out from the app, not from my accountant" | Discovering a two-week gap at month-end is the failure mode that loses the customer |
| "Setting it up felt like accounting, not IT" | The buyer is a bookkeeper or an owner, not a developer. Self-serve is the business model |

### Guardrails — what must NOT get worse

| Guardrail | Must stay at / above |
|-----------|----------------------|
| GoBD compliance of generated bookings | 100% — non-negotiable |
| Duplicate postings | Zero. Ever |
| Documents posted against the wrong debitor | Zero |
| Orders in an unaccounted-for state | Zero |
| Support ticket volume for connected tenants | No increase vs. comparable non-connected tenants |
| Scopevisio API load per tenant | Must not degrade the tenant's own interactive use of Scopevisio |

### Trust, safety & compliance expectations

- **GoBD (mandatory).** Generated bookings must be complete, unalterable once
  posted, and traceable to their originating order. Correction happens through a
  credit note, never by editing a posted document. Retention obligations apply to
  everything the connector books.
- **GDPR, subordinated to GoBD by decision.** Shopify's mandatory compliance
  webhooks must be answered. Where erasure conflicts with retention of a booked
  document, personal data is restricted and retained, not deleted — and the
  merchant must be able to see that this decision was applied. **A written
  position from Legal is required before GA (OQ-4).**
- **UStVA correctness.** The Steuersachverhalt determines the UStVA line. Any
  case the connector cannot classify with confidence must be held, not defaulted.
- **Credential custody.** The merchant's Scopevisio credentials are entrusted to
  the app. They must be revocable by the merchant from either side, and their
  compromise must not be possible through the app's own interface.
- **Tenant isolation.** One merchant's data must never be reachable from another
  merchant's session. Multi-tenancy is a compliance property here, not just a
  technical one.

---

## Constraints & Dependencies

### Genuine constraints

1. **GoBD immutability.** A posted document cannot be changed or deleted. This
   forces a create-then-post separation and makes idempotency a correctness
   requirement rather than a nicety.
2. **UStVA deadline, monthly by the 10th.** The connector must not be the reason
   a filing is late. Rollouts and breaking changes must avoid the days before the
   10th.
3. **Jahresabschluss season (Jan–Mar).** Per the industry calendar, this is the
   highest-support-load window and the worst time to introduce change into
   Finanzbuchhaltung. **The Q4 2026 target window is deliberate — GA must land
   before January.** A slip into Q1 should become a slip to Q2, not a launch into
   Jahresabschluss.
4. **Shopify App Store review.** Mandatory compliance webhooks, OAuth, and
   billing requirements are gating for public distribution and not negotiable.
5. **No push from Scopevisio.** The OpenScope API offers no webhooks, so any
   ERP-originating change is only ever observable by asking. This constrains what
   ERP→Shopify outcomes are achievable at all.
6. **The merchant's own master data is the authority.** The connector's
   correctness depends on the tenant's Steuermatrix and product master being
   right. It can validate and refuse, but it cannot substitute.

### Dependencies

| ID | This outcome depends on… | Owner | Status | Risk if Delayed |
|----|--------------------------|-------|--------|----------------|
| D-001 | A decision on whether a stock-level read capability will be added to OpenScope | OpenScope API owner [TBD] | Not Started | NG1 stays permanently out of scope; weakens the offering against connectors that do sync stock |
| D-002 | Confirmation of which Scopevisio profiles/permissions a connector user must hold, and whether a dedicated integration user is the intended pattern | OpenScope API owner [TBD] | Not Started | Setup cannot be made self-serve; every install becomes a support case (kills M-004) |
| D-003 | A Legal/Tax position on GDPR erasure vs. GoBD retention for booked customers | Legal + Tax [TBD] | Not Started | Cannot pass App Store review on compliance webhooks; unquantified legal exposure |
| D-004 | Tax sign-off on the mapping from order shape to Steuersachverhalt, including the OSS threshold treatment | Tax/Compliance [TBD] | Not Started | G2 unverifiable. Shipping without it transfers tax risk to customers |
| D-005 | A commercial decision on distribution: public App Store listing vs. private/custom app for existing tenants | Product + Sales [TBD] | Not Started | Changes review requirements, billing, and the whole self-serve bar |
| D-006 | Access to 3–5 merchants running Shopify + Scopevisio for baselining and beta | Sales/CS [TBD] | Not Started | M-005 and M-006 have no baseline; the outcome becomes unmeasurable |
| D-007 | Shopify protected customer data access granted to the app | PM + Eng [TBD] | Not Started | **Hard blocker.** Without it `orders/paid` and `refunds/create` cannot be subscribed at all, so no order can be booked and every Must capability is unreachable |
| D-008 | The `/outgoinginvoices/import` XML schema from the OpenScope team | OpenScope API owner [TBD] | Not Started | **Hard blocker.** Invoice creation is the only unimplementable step; the customer and VAT paths are verified working against a live tenant without it |

---

## Risks and Mitigations

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|----|------|-----------|--------|------------|-------|
| R-001 | **The outcome hypothesis is wrong** — too few Scopevisio tenants sell on Shopify for this to matter, and we have built for a segment that isn't there | M | H | Resolve the evidence gap *before* build: count Shopify-using tenants internally and interview five. This is a one-week question, not a one-quarter bet | PM |
| R-002 | VAT classification is wrong in production and customers file incorrect UStVA | M | H | Never derive treatment from the shop's tax rate; resolve against the tenant's own Steuermatrix, hold on any disagreement, and get D-004 signed off. Prefer holding to guessing | PM + Tax |
| R-003 | Self-serve setup proves impossible because of Scopevisio permission complexity, and every install needs support | M | H | Resolve D-002 early; prototype the connect flow against a fresh tenant, not a prepared one. If it can't be self-serve, that changes the product from an app to a service — better to learn it in week two | PM + Eng |
| R-004 | A duplicate or misassigned posting reaches a customer's ledger and cannot be undone | L | H | Idempotency treated as a correctness requirement; create-then-post separation; conservative customer matching that prefers a duplicate contact over a wrong match | Eng |
| R-005 | Merchants' master data is too incomplete for the connector to work, so the queue is never empty and the value never materialises | M | M | Validate master data at setup and tell the merchant what is missing before they enable sync, rather than discovering it order by order | PM + Eng |
| R-006 | Scopevisio API rate limits or performance make near-real-time booking unachievable at realistic order volumes | M | M | Establish actual limits with the API owner during design; degrade to batched booking rather than failing, since M-002 at 15 minutes has headroom | Eng |
| R-007 | Shopify App Store review rejects the app on compliance-webhook or data-handling grounds | M | M | Treat the mandatory compliance topics as Must from the first milestone, not as launch paperwork | Eng + PM |
| R-008 | Shopify changes its Admin API version and the connector breaks unattended | M | M | Version pinning with a scheduled upgrade obligation; C-011 ensures a break is visible to the merchant rather than silent | Eng |
| R-009 | The connector is blamed for pre-existing errors in the tenant's master data | M | L | C-009's per-order visibility must make the cause legible — "your Steuermatrix has no entry for FR on this date" rather than "sync failed" | PM |

---

## Timeline / Milestones

| Milestone | Description | Target Date | Owner | Exit Criteria |
|-----------|------------|------------|-------|---------------|
| **Evidence gate** | Answer R-001 and secure D-006. Count tenants, interview five, baseline M-005 | 2026-09-19 | PM | Go/no-go on the whole initiative, with a real baseline |
| Design / Discovery | Team chooses the approach; D-002 and D-004 answered | 2026-10-03 | Eng Lead | Approach chosen; permission model and tax mapping confirmed |
| Build Kickoff | Scope confirmed against confirmed constraints | 2026-10-06 | PM | PRD approved; all Must capabilities understood |
| Internal / Alpha | Running against the 2039915 test instance end to end | 2026-10-31 | Eng | C-001 to C-009 demonstrable; zero duplicates under deliberate replay |
| Beta / Limited | 3–5 real merchants, "create but don't post" mode | 2026-11-21 | PM + CS | M-001 and M-003 measured in the wild; no wrong postings |
| Launch / GA | Automatic posting enabled; distribution per D-005 | 2026-12-12 | PM | All Must capabilities delivered; D-003 position in hand |
| **Outcome Review** | Did the metric move? Apply decision rules | 2027-01-23 | PM | Decision recorded: scale / iterate / stop |

⚠️ **Calendar warning.** GA on 2026-12-12 sits immediately before the year-end
code-freeze and holiday window, and the Outcome Review falls inside
Jahresabschluss season. Two consequences: ship GA with enough margin that no
hotfix is needed over the holidays, and expect the January review to be conducted
while support load is at its annual peak. Do not plan V2 build capacity for
January.

---

## Open Questions

| # | Question | Owner | Deadline | Status |
|---|----------|-------|----------|--------|
| OQ-1 | Will a stock-level read capability be added to the OpenScope API? Without it, stock sync is permanently out of scope | OpenScope API owner [TBD] | 2026-10-03 | Open |
| OQ-2 | Which Scopevisio profiles must a connector user hold, and is a dedicated integration user the supported pattern? | OpenScope API owner [TBD] | 2026-09-26 | Open |
| OQ-3 | What are the API rate limits per organisation, and what order volume can we support in near-real-time? | OpenScope API owner [TBD] | 2026-10-03 | Open |
| OQ-4 | What is our written position on GDPR erasure vs. GoBD retention for a booked customer? | Legal [TBD] | 2026-10-31 | Open |
| OQ-5 | Who signs off the order-shape → Steuersachverhalt mapping, and does it cover the OSS threshold? | Tax [TBD] | 2026-10-03 | Open |
| OQ-6 | Public App Store listing or private app for existing tenants? Determines review bar and billing | Product + Sales [TBD] | 2026-10-03 | Open |
| OQ-7 | Do we charge for the connector, and if so on what metric? | PM | 2026-11-21 | Open |
| OQ-8 | How many current Scopevisio tenants sell on Shopify? (R-001) | PM | 2026-09-19 | Open |
| OQ-9 | Is a Shopify order's invoice date the order date or the fulfilment date for Leistungsdatum purposes? Affects which Steuermatrix entry applies | Tax [TBD] | 2026-10-03 | Open |
| OQ-11 | Who requests Shopify protected customer data access for this app, and does a public listing need the full review? `orders/paid` and `refunds/create` cannot be subscribed without it — discovered 2026-09-08 | PM + Eng [TBD] | 2026-09-26 | Open |
| OQ-10 | **BLOCKER.** What is the XML schema for `POST /outgoinginvoices/import`? Confirmed 2026-09-08: the payload must be XML, but 29 structural variants were all silently ignored (HTTP 200, `invoices: []`), and there is no JSON create alternative. Not derivable by experiment — needs the schema or one working sample | OpenScope API owner [TBD] | 2026-09-26 | Open |

---

## Completeness Checklist

| Section | Status | Notes |
|---------|--------|-------|
| Header Metadata | Incomplete | Stakeholder names are [TBD] |
| Problem & Desired Outcome | **Incomplete** | **Evidence is missing — this is the one gap that should block "In Review" (R-001, OQ-8)** |
| Outcome Hypothesis | Complete | — |
| Success Metrics & Decision Rules | Incomplete | M-005 and M-006 need pre-launch baselines (D-006) |
| Goals and Non-Goals | Complete | 6 goals, 8 non-goals |
| Customer Story | Complete | — |
| Target Persona | Complete | persona-1 primary; persona-2 and persona-3 secondary |
| Capabilities the Customer Needs | Complete | 15 capabilities, all traced to a metric or to compliance |
| Quality Expectations & Guardrails | Complete | — |
| Constraints & Dependencies | Incomplete | All six dependencies unowned |
| Risks and Mitigations | Complete | R-001 is the one to act on first |
| Timeline / Milestones | Complete | Includes evidence gate and Outcome Review; calendar conflict flagged |
| Open Questions | Complete | 9 open, all with deadlines; owners [TBD] |

---

## Notes on scope discipline

Two capabilities in this PRD are doing unusual work and should not be traded away
casually:

- **C-006 (hold rather than guess)** is what makes the guardrails achievable. Any
  pressure to "just book it with a default tax code" converts this product from
  an accounting tool into a liability.
- **C-007 (idempotency)** reads like an engineering concern but is a customer
  capability here, because GoBD makes a duplicate posting unfixable rather than
  merely annoying.

The implementation constraints discovered while writing this — what the OpenScope
API does and does not support — are recorded separately in
`docs/API-FINDINGS.md`, so that this document stays about the outcome and the
team keeps the freedom to choose the approach.
