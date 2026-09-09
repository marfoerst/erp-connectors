# App Store listing copy

Written to the listing rules in the App Store requirements, which are stricter
than they look:

- *"Your app and app listing should only include factual information."*
- *"Do not use any statistics or data in your app's listing content, overview
  of the app, and/or app introduction."* — so no "saves 5 hours a week".
- *"Do not use reviews and testimonials."*
- BFS 4.3.1: no guaranteeing, promising or strongly suggesting merchant
  outcomes.
- *"The Languages section of your app listing must only list languages in which
  merchants can use your app's UI."* → **German and English**, which is what the
  UI now supports.

Everything below describes what the app does, not what it will achieve for you.

---

## App name

**Scopevisio ERP**

Short enough not to truncate in the admin navigation (BFS 4.1.3), and leads
with the brand identifier as required.

## Languages

German, English. *(Do not add others — the UI supports these two.)*

## Category

**Finance / Accounting.** Deliberately **not** *Invoices and Receipts*: that
category triggers requirement 5.9.1, which mandates an admin print action
extension for printing invoices and packing slips. This app books revenue into
an ERP; it does not print documents for the merchant. See
`docs/BUILT-FOR-SHOPIFY.md`.

---

## German (primary market)

### App introduction

> Shopify-Aufträge als Fakturen in Ihrer Scopevisio-Buchhaltung — mit der
> Umsatzsteuer aus Ihrer eigenen Steuermatrix.

### App details

> Scopevisio ERP verbindet Ihren Shop mit Ihrer eigenen
> Scopevisio-Organisation. Aus jedem bezahlten Auftrag wird ein
> Abrechnungsbeleg: der Käufer wird als Kontakt mit Debitorenkonto angelegt,
> Gäste eingeschlossen, und die Positionen übernehmen Erlöskonto und
> Steuerschlüssel, die Ihre Steuermatrix für dieses Zielland und dieses Datum
> vorsieht.
>
> Die App rechnet die Umsatzsteuer nicht selbst aus. Sie bestimmt den
> Steuersachverhalt — Inland, innergemeinschaftliche Lieferung mit geprüfter
> USt-IdNr., Drittland — und fragt dann Scopevisio, welches Konto dafür gilt.
> Der von Shopify berechnete Steuerbetrag dient nur als Gegenprüfung vor dem
> Buchen.
>
> Was nicht eindeutig entschieden werden kann, wird zurückgehalten statt
> gebucht, mit einer Begründung in der Sprache der Buchhaltung. Ein gebuchter
> Beleg lässt sich nach GoBD nicht zurücknehmen — deshalb ist Zurückhalten der
> Standardfall bei Unklarheit.
>
> Einrichtung und Zuordnung erfolgen vollständig im Shopify-Adminbereich.

### Feature list

1. **Kunden werden Debitoren** — Käufer werden als Scopevisio-Kontakt mit
   Debitorenkonto angelegt, Gastbestellungen über Conto pro Diverse.
2. **Umsatzsteuer aus Ihrer Steuermatrix** — Erlöskonto und Steuerschlüssel
   kommen aus Ihren Stammdaten, nicht aus einer Annahme der App.
3. **USt-IdNr.-Prüfung über VIES** — mit Zeitstempel, weil für das
   Reverse-Charge-Verfahren die Gültigkeit zum Leistungszeitpunkt zählt.
4. **Nichts wird auf Verdacht gebucht** — unklare Fälle landen mit Begründung
   in einer Prüfliste.
5. **Keine Doppelbuchungen** — jeder Auftrag wird genau einmal verarbeitet,
   auch nach einem erneuten Versuch.

### Search terms

`Scopevisio`, `Buchhaltung`, `ERP`, `Faktura`, `Umsatzsteuer`, `Debitor`,
`GoBD`, `Erlöskonto`, `Steuermatrix`, `Rechnungen`

---

## English

### App introduction

> Shopify orders as invoices in your Scopevisio accounting — with VAT resolved
> from your own Steuermatrix.

### App details

> Scopevisio ERP connects your shop to your own Scopevisio organisation. Every
> paid order becomes a billing document: the buyer is created as a contact with
> a debitor account, guests included, and the positions carry the revenue
> account and tax key that your Steuermatrix prescribes for that destination
> country and date.
>
> The app does not calculate VAT itself. It determines the tax case — domestic,
> intra-EU supply with a validated VAT ID, third-country export — and then asks
> Scopevisio which account applies. Shopify's calculated tax amount is used only
> as a cross-check before posting.
>
> Anything that cannot be decided unambiguously is held rather than booked, with
> a reason written in accounting terms. A posted document cannot be withdrawn
> under GoBD, which is why holding is the default when something is unclear.
>
> Setup and mapping happen entirely inside the Shopify admin.

### Feature list

1. **Customers become debitors** — buyers are created as a Scopevisio contact
   with a debitor account; guest checkouts use a Conto pro Diverse account.
2. **VAT from your Steuermatrix** — the revenue account and tax key come from
   your master data, not from an assumption in the app.
3. **VAT ID validation via VIES** — with a timestamp, because reverse charge
   depends on validity at the time of supply.
4. **Nothing is booked on a guess** — unclear cases go to a review list with a
   reason.
5. **No double bookings** — each order is processed exactly once, including
   after a retry.

---

## Screenshots

**Captured — see `assets/screenshots/`** (six PNGs, German, 1568×773). The
rationale for each and the rule-by-rule check are in that folder's README.

Original plan, for reference:

Listing rules: *"Images should primarily show your app's actual user
interface"*, *"Each image in your app listing must be unique"*, no browser
chrome, no desktop background, no pricing text, no app-logo-only images.

1. **Overview** with the three-step onboarding partly complete — shows the app
   states whether it is set up and working (BFS 4.2.3).
2. **Mapping**, tax-case section, dropdowns open enough to show real
   Steuersachverhalte from a tenant.
3. **Mapping**, the readiness report, showing one case ready and one that will
   be held — this is the most distinctive thing the app does.
4. **Orders**, a held order with the VAT cross-check figures side by side.
5. **Export**, a batch ready with the resolved account and tax key per order.

Capture in German, since that is the primary market.

## Testing instructions for the reviewer

Required: *"Include account credentials in your testing instructions"* and they
must *"grant full access to the app's complete feature set"*.

Draft — fill in before submission:

> The app connects to a Scopevisio ERP organisation. Test credentials for a
> demo organisation: `[customer number] / [user] / [password]`.
>
> 1. Open the app; the Overview shows a three-step setup.
> 2. Connection: enter the credentials above and leave Organisation blank — the
>    app resolves it and shows which organisation it connected to.
> 3. Mapping: choose a Steuersachverhalt per tax case from the dropdowns, which
>    are populated from the demo organisation's own Steuermatrix. Use "Check
>    what will actually book" to see which destinations resolve.
> 4. Switch sync on, then use "Check now" on Orders to pull in paid orders.
> 5. Export: download the CSV and confirm the batch.
>
> Notes for review:
> - This is an accounting/ERP connector, not a POS integration (requirement
>   1.1.8 permits ERP integrations).
> - The app reads Shopify refunds and creates a credit note in the ERP. It never
>   processes a refund or touches a payment method (requirement 1.1.15).
> - Customer name, address and email are needed because German law (§14 UStG)
>   requires the recipient's full address on an invoice, and the destination
>   country determines the VAT treatment.
