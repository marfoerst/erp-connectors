# OpenScope API Findings

Engineering reference. Verified against the live spec on 2026-09-08.
Kept separate from `PRD.md` so the PRD stays about outcomes.

**Spec (public, no auth):** `https://appload.scopevisio.com/rest/openapi.json`
— OpenAPI 3.0.1, 293 paths, "Scopevisio OpenScope REST API" v1.0.0
**Interactive:** https://appload.scopevisio.com/static/swagger/index.html
**Getting started:** https://help.scopevisio.com/de/articles/467358-rest-api-erste-schritte
**Search grammar:** https://help.scopevisio.com/de/articles/467360-search-scope-documentation

---

## 1. Conventions (non-obvious — read first)

| Pattern | Meaning |
|---|---|
| `POST /{plural}` — `/contacts`, `/orders`, `/outgoinginvoices` | **Query**, not create. Body is a JSON search filter (see §6) |
| `POST /{thing}/new` or `/{plural}/import` | Create |
| `POST /{thing}/{number}/post` | **Commit to the ledger. Irreversible.** |
| `GET /datasource/*` | 52 read-only reporting endpoints |

Path parameter `{number}` generally means *interne Nummer*, not the surrogate id.

## 2. Authentication

```
POST https://appload.scopevisio.com/rest/token
  grant_type=password
  customer=<7-digit customer number>     # e.g. 2039915
  organisation=<organisation name>
  username=<user email>
  password=<password>
→ short-lived access token + long-lived refresh token
```

Requests: `Authorization: Bearer <token>`, `accept: */*`.
Tokens are revocable by the customer at
`https://account.scopevisio.com/login` → Schnittstelle (OpenScope) → API Token.

Refresh-token rotation removes the need to store the password after setup —
relevant to the credential-custody expectation in the PRD.

Every endpoint documents required Scopevisio **profiles** (e.g. `Kontakte
(Bearbeiten)`, `Stammdaten, Steuermatrix (Anzeigen)`, `Datenimport
(Bearbeiten)`). Insufficient profiles are the most likely cause of a failed
self-serve setup → see OQ-2.

## 3. Customer → contact + debitor

Two calls. The second is idempotent.

```
POST /contact/new            body: KontaktForm  → contact id
POST /createdebitor          body: PersonalAccountForm
```

**`KontaktForm`** — required: `lastname`, `person`. 108 properties. Relevant:

| Field | Note |
|---|---|
| `person` | `true` = Person, `false` = Gesellschaft. **Evaluated only at creation — cannot be changed later** |
| `legacyNumber` | "ID Vorsystem". **Store the Shopify customer GID here** — see §4 |
| `tags` | Schlagwörter, single free-text field. Use for `shopify-review` |
| `email`…`email6` | Six slots; `email` is Geschäftlich |
| `vatId` | Umsatzsteuer-ID |
| `street1..6`, `city1..6`, `postcode1..6`, `country1..6` | Six address slots |
| `paymentTypeName` | Enum incl. `PayPal`, `AmazonPay`, `Kreditkarte`, `Rechnung`, `Vorkasse`, `Nachnahme`, `Billpay` — near-direct map from Shopify gateway |
| `customerNumber` | Kontaktnummer |
| `currency`, `language`, `customFields` | |

There is **no role/debitor field on `KontaktForm`** (only `sphereEmployee`,
`sphereWorker`). The debitor role comes from `/createdebitor`.

**`PersonalAccountForm`** — "at least one of the parameters is needed":

| Field | Note |
|---|---|
| `contactId` | Link to the contact |
| `contoProDiverse` | **CPD / Conto pro Diverse — the native construct for one-off customers.** Use for guest checkouts (the field's description is a copy-paste error reading "vatNumber"; the name is authoritative) |
| `group` | Kundengruppe — **auto-created if it does not exist.** Pass e.g. `"Shopify"` / `"Shopify Guest"` |
| `numberRangeNumber` | Debitoren-Nummernkreis |
| `personalAccountNumber`, `sumAccountNumber` | Explicit Kontonummer / Sammelkonto |
| `vatCode` | Steuerkennzeichen |
| `vatId`, `vatNumber`, `currency`, `language` | |
| `paymentTermId`, `paymentType` | |

`/createdebitor` is documented as *"Create debitor for a given contact, if the
contact is not already a debitor"* → safe to retry, which is what makes the
two-call sequence tolerable.

## 4. Contact lookup / identity

`GET /contact/{keyIdentifier}/{id}` accepts `keyIdentifier` of **`ID` or
`LEGACYNUMBER` only** — no email lookup. Non-unique `legacyNumber` returns
**HTTP 404**, so ambiguity surfaces instead of silently resolving.

→ Store the Shopify customer GID in `legacyNumber` and look up with
`GET /contact/LEGACYNUMBER/{gid}`. O(1), exact, self-detecting on duplicates.

Email is only a first-contact merge heuristic, via `POST /contacts` (§6).

Other useful: `PATCH /contact/modify/{contactId}` (only `birthDate`),
`DELETE /contact/{contactIdOrLegacyNumber}`, `POST /contact/{id}` (full update),
`GET /contact/{id}/employees`, `/childOrganisations`, `/employers`.

## 5. VAT determination — the ERP is the engine

**Do not compute VAT. Resolve it.**

```
GET /vatscopes                → Steuersachverhalte (VatScopeType: caseId, caseName,
                                 caseDescription, active)
                                 ?active=true
GET /vatmatrixentries         → VatMatrixEntry: vatRate, vatKey, vatKeyDescription,
                                 vatCode, datevKey, salesAccount, purchaseAccount
                                 (also POST / PATCH to write)
GET /revenueaccounts/products → Erlöskonten per product
GET /revenueaccounts/standard → standard Erlöskonten
GET /revenueaccounts/product/{id}
POST /revenueaccounts/new
```

`GET /revenueaccounts/products` query parameters **are** the determination:

| Param | Meaning |
|---|---|
| `country` | 2-letter ISO. "Defaults to the organisation's country in regard to taxation" → destination country |
| `vatScope` | Steuersachverhalt (negative value has special meaning — check) |
| `servicesRenderedDate` | Leistungsdatum/Buchungsdatum/Rechnungsdatum → handles rate changes and validity windows |
| `active` | Restrict to those active at that date |
| `fields`, `page`, `pageSize` | Paging; max 1000 |

`RevenueAccountType` returns: `accountNumber`, `vatKey`, `taxKey`, `taxCaseId`,
`taxCaseName`, `countryIso`, `originalCountryIso`, `reverseCharge`, `productId`,
`merchandiseGroupId`, `validFrom`, `validTill`, `matrix`, `advance`.

**OSS is modelled as a `(country, vatScope)` pair** — destination-country
Erlöskonten carrying an OSS tax case, with validity dates. No special API mode.

**Why the shop's tax rate cannot be the input:** 0% is ambiguous across
intra-EU B2B supply (§4 Nr. 1b), third-country export (§4 Nr. 1a), reverse
charge (§13b) and Kleinunternehmer (§19) — four different Steuersachverhalte,
UStVA lines and Erlöskonten. Shopify's `tax_lines` is a **checksum only**
(compare against the resolved `VatMatrixEntry.vatRate` before posting).

The only genuinely new logic to build: **VIES VAT-ID validation with a stored
timestamp** (validity at time of supply governs reverse charge), and the
per-tenant OSS opt-in / €10,000 threshold setting.

## 6. Search filter grammar (`POST /{plural}`)

```json
{
  "search": [ { "field": "email", "value": "a@b.de", "operator": "equal" } ],
  "fields": ["id", "lastname", "email"],
  "page": 0,
  "pageSize": 250,
  "formatValues": false,
  "order": ["lastname = desc"]
}
```

⚠️ **The body must be a raw JSON object, even though the spec types it as
`string`.** Sending a JSON-*encoded* string (i.e. the object serialised into a
JSON string literal) is accepted with HTTP 200 and the filter is **silently
ignored** — you get the first page of the entire collection back, which looks
like a legitimate result set. Verified 2026-09-08: encoded-string form returned
100 unrelated contacts, raw-object form returned the 2 matching ones.

Operators: `startswith`, `endswith`, `contains`, `icontains`, `equal`,
`notequal`, `less`, `greater`, `lessorequal`, `greaterorequal`, `is null`,
`is not null`. OR = comma-separated values within one criterion; AND = multiple
objects in the array. `pageSize` default 100, max 1000. `{"count": true}`
returns a count.

## 7. Documents

Chain with explicit converters:
**Offer → Order → Dispatch → OutgoingInvoice → Credit**
(`POST /order/{number}/convertToOutgoingInvoice`, `…/convertToDispatch`, etc.)

### Creating an invoice — ⚠️ BLOCKED, investigated 2026-09-08

`POST /outgoinginvoices/import` is the **only** create path, and its document
format could not be determined. What is established:

| Finding | Evidence |
|---|---|
| The payload **is XML** | Non-XML `data` → HTTP 400 `"data: must be a valid XML document"`. CSV, JSON and TSV all rejected this way |
| Scopevisio's own docs say Abrechnungsbelege import as **CSV** | `scopevisio.com/downloads/allgemein/Datenimport.pdf` — but that describes the UI importer, not this endpoint |
| Unrecognised XML **fails silently** | HTTP 200 + `{"message":"Importierte Abrechnungsbelege: []","invoices":[],"customers":[],"vendors":[]}`. Success and total failure are indistinguishable by status code |
| **29 structural variants** were rejected | roots tried: `outgoingInvoices`, `invoices`, `Abrechnungsbelege`, `Belege`, `documents`, `data`, `import`, `Import`, `scopevisio`, `dataset`, `entities`, `table`, `rows`, bare `outgoingInvoice`; element *and* attribute styles; `positions` / `positionsForm` / `invoicePosition` / `Positionen`; dd.MM.yyyy *and* epoch-millis dates; with and without `numberRange`/`type`/`taxCaseId`; with an import namespace |
| There is **no JSON alternative** | `POST /outgoinginvoice/{number}` is update-only — it answers 404 `"No outgoingInvoice with the given number found"` for any non-existent number, whatever the body. Confirmed with 5 payload shapes |
| `/mlexport/invoice` would reveal Scopevisio's own posting XML | but returns 403 `"Missing profile. Require read access for any of: enterprise.MlEngineExport"` |

**What is needed:** the import-document schema (or one working sample) from
whoever owns OpenScope. This cannot be derived by experiment because the
endpoint returns no error for an unrecognised document.

**Worth reporting to that team as a defect in its own right:** an import that
answers 200 with an empty result set, for a document it did not understand, will
silently lose data in any integration that does not treat `invoices: []` as a
failure.

Field names that ARE known, from the JSON schemas — likely the correct element
names once the envelope is known:

- Document (`OutgoingInvoiceForm`, required `customerContactId` + `documentDate`):
  `customerPersonalAccountNumber`, `currency`, `text`, `documentNumber`,
  `postingDate`, `reference`, `taxCountryCodeIso2`, `gross`, `paymentTypeName`,
  `positionsForm`
- Position (`OutgoingInvoicePositionForm`, required `name`): `number`
  (Produktnummer), `quantity`, `unit`, `singleAmount`, `account`, `vatKey`,
  `discount`, `description`
- On a real invoice read back from `POST /outgoinginvoices`, dates are **epoch
  milliseconds** and `numberRange` is `"accounting.OutgoingInvoiceInvoice"`

### Import flags (verified accepted)


`POST /outgoinginvoices/import` — body `OutgoingInvoiceImportForm`:

| Field | Note |
|---|---|
| `data` | **XML import document** (not JSON) |
| `skipDuplicates` | **Built-in idempotency** |
| `doPost` | Post immediately. **Set `false`** — create, verify, then post separately |
| `generateDocumentNumbers` | |
| `createPdf`, `template` | |
| `copyProductToPosition`, `copyProductToPositionOverwriteMode` | Pull position data from the product master |
| `copyVatKeyAndTaxRateToPosition` | **Let the ERP derive `vatKey` + rate** |
| `copyImpersonalAccountFieldsToPosition` | **Let the ERP derive the Erlöskonto** |

Required profiles: `Angebote, Aufträge, Lieferscheine, Rechnungen (Bearbeiten)`.

Then `POST /outgoinginvoice/{number}/post`.

`OutgoingInvoiceBaseForm` — required `customerContactId`, `documentDate`; plus
`customerPersonalAccountId` / `…Number` / `…Name` / `…ExternalNumber`.

`OutgoingInvoicePositionForm` — required `name`; plus `singleAmount` (net or
gross depending on the document), `account` (Konto), `vatKey`
(Steuerschlüssel), `singleCostAmount`.

Reads: `GET /outgoinginvoice/{number}`, `/positions`, `/file`, `/parent`.

### Credit notes (refunds)

`POST /credits` (query), `GET /credit/{number}`, `/positions`, `/parent`,
`POST /credit/{number}/post`.

## 8. Products / SKU mapping

**Scopevisio already models e-commerce SKU mapping:**

```
GET /product/{id}/ecommerceskus → eCommerceSKU:
      id, organisation, productNumber, ecommerceAccount,
      ecommerceAccountDisplay, platformNumber
```

`ProductType` has **306 properties**, including `sku`, `ean`, `platformNumber`,
`externalSystemId`, `externalSource`, `externalNumber`, `taxRate`, `taxKey`,
`taxTypeId`, `singleAmount`/`2`/`3`, `singleAmountGross*`, `costPrice`,
`productGroup`, `merchandiseGroup`, `warehouse`, `nonStockItem`,
`batchManagement`, `weight`/`height`/`width`/`depth`, `revenueAccount0..3`,
`revenueAccountsMode`, `nameLng1..5`, and 30 sets of `customText/Boolean/
Amount/Long/Date/DateTime{n}`.

Also: `POST /product/new`, `POST /product/{id}`, `GET /productGroups`,
`POST /productGroup/new`, `POST /products` (query),
`GET /datasource/product`.

→ Use the native `eCommerceSKU` / `platformNumber` mapping rather than inventing
one in Shopify metafields.

## 9. Accounting

74 endpoints. Relevant beyond the above:

```
POST /createdebitor            POST /createkreditor
POST /debitoraccounts          POST /debitoraccounts/{accountNumber}
POST /openitems/debtors        POST /openitems/debitor/list
POST /openitems/debitor/clearing   POST /openitems/debitor/rebook
POST /impersonalaccounts       POST /createimpersonalaccounts
GET  /datasource/personalAccount/debtor
GET  /datasource/susa/debtors
GET  /gainandlossadjustmentaccounts
GET  /catalog/accounting/statisticsunit
```

## 10. Hard limits (drive the PRD's non-goals)

1. **No stock/inventory read.** Searched the whole spec for
   stock/inventory/Lager/Bestand/warehouse/on-hand: nothing. None of the 52
   `/datasource/*` endpoints returns quantity on hand. `ProductType` has
   `warehouse` and `nonStockItem` but **no quantity field**. Material management
   is BETA and write-only:
   ```
   POST /material/purchaseorder/new
   POST /material/purchasedelivery/new
   POST /material/purchasedelivery/{idOrDocumentNumber}/post
   POST /material/posting/credit
   ```
   → stock sync is blocked (PRD NG1 / OQ-1). Workarounds, in order of
   preference: (a) get an endpoint added; (b) push only deltas the connector
   itself originates; (c) reconstruct from dispatch positions minus purchase
   deliveries — fragile, will drift, do not ship.

2. **No webhooks.** Any ERP→Shopify direction is polling only.

3. **No contact-merge endpoint.** Duplicate resolution must happen in the
   Scopevisio client; the connector can only surface candidates.

4. **Rate limits undocumented in the spec** → OQ-3.

## 11. Datasource endpoints (read side, all 52)

`auditLog`, `blog`, `budgetGroup`, `contact`, `contactProperties`,
`conversion`, `creditNote`, `dispatch`, `event`, `expense`, `humanResource`,
`humanResourceAvailability`, `incomingInvoice`, `journal`, `offer`,
`opportunity`, `order`, `outgoingInvoice`, `personalAccount/creditor`,
`personalAccount/debtor`, `personalJournal`, `plan`, `positions/{creditNote,
dispatch, incomingInvoice, offer, opportunity, order, outgoingInvoice}`,
`proReport`, `product`, `productUsage/{creditNote, dispatch, offer,
opportunity, order, outgoingInvoice}`, `project`, `projectResource`,
`projectRevenue`, `salesProject`, `statisticsJournal`, `susa/{creditors,
debtors, impersonalAccounts}`, `task`, `teamwork`, `timeEntry`,
`timeEntryRun`, `timeEntryRunEntry`, `travelEntry`, `travelEntryPositions`.

`/datasource/contact` takes a `roles` filter: `interested`, `lead`, `customer`,
`vendor`, `debitor`, `kreditor`, `employee`.

## 12. Test instance

Customer `2039915`, user `martin.foerster@scopevisio.com`.
Credentials were shared in plaintext in a chat transcript on 2026-09-08 and
**should be rotated**. Configure them as environment variables
(`SCOPEVISIO_*`), never in source. See `.env.example`.
