# What building the n8n node found

The n8n community node was built against the live OpenScope API from the start,
with every assumption checked before it went into code. It still turned up
defects in two places a unit test cannot see: in how OpenScope behaves, and in
how n8n itself handles errors.

## OpenScope behaviour, confirmed live

These now live in the node as handled cases and in its README.

**1. Contact updates silently skip fields.** `POST /contact/{id}` is a partial
merge — it wiped nothing in testing — but it answered HTTP 200 with
`errors: {}` while ignoring `firstname` on a company contact, twice. A misspelt
field name, by contrast, is rejected (`400 Unrecognized field firstName`). The
node's Update reads the contact back and fails naming every field that was not
applied, unless *Verify Update* is switched off.

**2. Unknown field names are handled inconsistently.** Asking `/contacts` for a
field that does not exist returns `404 the field … does not exist`. Asking
`/products` for one silently drops it and returns only `id`. The node's default
field lists were checked name by name against the live API.

**3. An unfiltered read is enormous.** A contact with no field list comes back
with 441 fields on `GET /contact/{id}` and 805 on a search. Every read in the
node asks for a useful default set.

**4. Searches carry no total count**, and pages are zero-based. *Return All*
pages until a short page arrives. Verified: Return All returned 598 contacts and
Count returned 598.

**5. Not every invoice has a PDF.** `/outgoinginvoice/{number}/file` returned a
real `application/pdf` (98,570 bytes) for `RE-2020-1` and a JSON 404 for
`RE-2026-26`. The node explains the second case instead of failing opaquely.

**6. Creation responses are not `{ id }`.** `/contact/new` returns
`{ status: 201, contactId, location }`, and `/product/new` returns `productId`.

**7. Creating a debitor is idempotent.** Called twice for the same contact it
returned `created: true` with number `10084`, then `created: false` with the same
number.

## n8n behaviour, found only inside a real n8n

**8. Error explanations were being thrown away.** n8n-core's request helper
already throws a `NodeApiError`, and constructing a new `NodeApiError` around
one hands back the original with the new message and description discarded. So
every Scopevisio-specific explanation was lost, and users saw only n8n's generic
"Bad request - please check your parameters". Fixed by writing the explanation
onto the existing error; covered by a unit test that reproduces what n8n-core
throws, and confirmed live:

| Before | After |
|---|---|
| Bad request - please check your parameters | Scopevisio rejected the request for contacts — *The field "definitelyNotAField" was not found.* |
| Authorization failed - please check your credentials | Scopevisio rejected the credentials — *The refresh token may have been revoked…* |
| The resource you are requesting could not be found | Scopevisio could not find contact 999999999 |

**9. `n8n execute` cannot run a polling trigger** ("Missing node to start
execution"), and inside a running container it collides with the server's task
broker unless `N8N_RUNNERS_BROKER_PORT` is changed. The trigger was tested by
activating it for real instead.

## The polling trigger, live

Activated at 07:53. The first poll recorded a baseline of contact `101073` and
emitted nothing — activation does not replay history. A contact was created at
07:54:47. The 07:55:37 poll ran as execution 27 and emitted exactly one item,
contact `101074`, and the cursor advanced to it.

## Verification against n8n's rules

- No runtime dependencies; `n8n-workflow` is a peer dependency only.
- No environment variable or file access.
- MIT licence, English only, one service.
- `n8n-node lint` passes in strict mode.
- `@n8n/scan-community-package` — n8n's verification scan — could not be run.
  Pointed at the local package it printed nothing but npm warnings, and its
  `--help` did the same, so whether it accepts an unpublished package is
  unconfirmed. Run it against the package name once published.
- Publishing must go through a GitHub Action with provenance (mandatory since
  1 May 2026). The scaffold's workflows sit in `connectors/n8n/.github/` and do
  not run from a subfolder; they need moving to the repository root, or the
  package to its own repository, before the first release.

## Test data left in the Scopevisio test tenant

Nothing was posted to the ledger. Delete when convenient:

- Contacts `101072` (n8n Probe GmbH, tag `n8n-probe`), `101073` (n8n E2E GmbH,
  tag `n8n-e2e`), `101074` (n8n Trigger Test GmbH, tags `n8n-e2e,n8n-trigger`)
- Debitor account `10084`, customer group "n8n E2E"
- Product `21796` (n8n E2E Produkt)
