# n8n-nodes-scopevisio

An [n8n](https://n8n.io) community node for **Scopevisio**, the German cloud ERP.
Read and write contacts, debitor accounts, products and invoices, look up tax
master data, pull Scopevisio reports, and start workflows when new records
appear.

[Installation](#installation) · [Credentials](#credentials) ·
[Operations](#operations) · [Trigger](#trigger) · [Examples](#examples) ·
[Things Scopevisio does that this node handles for you](#things-scopevisio-does-that-this-node-handles-for-you) ·
[Compatibility](#compatibility)

## Installation

**Not published to npm.** This package is deliberately not released yet, so it
cannot be installed from **Settings → Community Nodes**. Install it from source
into a self-hosted n8n:

```bash
# in connectors/n8n
npm install
npm run build
npm pack                                   # → n8n-nodes-scopevisio-0.1.0.tgz
```

Then install the tarball into n8n's community-nodes folder and restart n8n:

```bash
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
[ -f package.json ] || npm init -y
npm install --legacy-peer-deps /path/to/n8n-nodes-scopevisio-0.1.0.tgz
```

In Docker, do the same inside the container's `/home/node/.n8n/nodes` — the
end-to-end harness in [`e2e/README.md`](e2e/README.md) shows a working command.
`--legacy-peer-deps` stops npm from installing its own copy of `n8n-workflow`,
which n8n already provides.

For development, `npm run dev` starts a local n8n with the node hot-reloaded.

## Credentials

The node talks to Scopevisio's OpenScope REST API. Create a **Scopevisio API**
credential with:

| Field | |
|---|---|
| **Authentication Method** | **Refresh Token** (recommended) or **Username and Password** |
| **Customer Number** | Your seven-digit Scopevisio customer number |
| **Organisation** | Only needed when the user belongs to more than one organisation |
| **Refresh Token** | Create one in Scopevisio under *Account → Schnittstelle (OpenScope) → API Token* |
| **Username / Password** | Only for the password method |
| **Base URL** | Leave as `https://appload.scopevisio.com` unless Scopevisio told you otherwise |

**Use a refresh token.** No password is stored, and it is the only method that
works for users with two-factor authentication — the password grant has no way
to supply a one-time code.

The node exchanges the stored secret for a short-lived access token on demand,
refreshes it automatically when it expires, and writes a rotated refresh token
back into the credential so it keeps working.

**Permissions.** Every OpenScope endpoint requires a Scopevisio *profile* on the
user (for example *Kontakte (Bearbeiten)* to create contacts, or *Rechnungen
(Anzeigen)* to read invoices). A missing profile shows up as an error saying the
user may not access that resource. Give the connecting user the profiles for the
operations you use.

## Operations

| Resource | Operations |
|---|---|
| **Account** | Get — the customer, organisation and user the credential belongs to |
| **Contact** | Count · Create · Get (by ID or legacy number) · Get Many · Update |
| **Debitor** | Create — turn a contact into a debitor account; safe to repeat |
| **Product** | Create · Get · Get Many |
| **Outgoing Invoice** | Download PDF · Get · Get Many · Post to Ledger |
| **Incoming Invoice** | Get · Get Many |
| **Tax** | Get Tax Cases · Get VAT Matrix · Resolve Revenue Accounts |
| **Report** | Get Rows — any of Scopevisio's 52 reports for a date range |

**Get Many** operations take filter conditions (field, operator, value, combined
with AND), a field list, sorting, and *Return All* or a *Limit*.

**Post to Ledger** commits an invoice and cannot be undone. Under GoBD a posted
document cannot be withdrawn, only corrected with a credit note. The operation
refuses to run unless **Confirm Irreversible Posting** is switched on.

The node is also available as a tool for n8n's AI agents.

## Trigger

**Scopevisio Trigger** starts a workflow on **New Contact**, **New Outgoing
Invoice**, **New Incoming Invoice** or **New Product**.

Scopevisio has no webhooks, so the trigger polls at the interval you choose. It
remembers the highest record ID it has handled and asks only for newer ones.
Activating the trigger does **not** replay existing records: the first poll only
records where it is. A failed poll changes nothing, so no record is skipped.

## Examples

**Keep Scopevisio contacts in step with a CRM.** Trigger on your CRM → Scopevisio
*Contact → Get* by legacy number (your CRM's ID) → if not found, *Contact →
Create* with that legacy number → *Debitor → Create*.

**Mail every new invoice to the bookkeeper.** Scopevisio Trigger *New Outgoing
Invoice* → Scopevisio *Outgoing Invoice → Download PDF* → Send Email with the
binary attached.

**Check which revenue account an order would book to.** *Tax → Resolve Revenue
Accounts* with the destination country, the tax case and the date of supply
returns the Erlöskonto and tax keys from your own Steuermatrix.

**Monthly open-items export.** Schedule → *Report → Get Rows* for
*Personal Account: Debtor* → Spreadsheet File.

## Things Scopevisio does that this node handles for you

These are behaviours of the OpenScope API that silently produce wrong results if
you call it directly. Each one was observed against a live tenant.

- **Search filters sent as a string are ignored.** `POST /contacts` and the other
  search endpoints accept a JSON-encoded string with HTTP 200 and return the
  whole collection, unfiltered. The node always sends the filter as a JSON
  object.
- **Updates can silently skip fields.** `POST /contact/{id}` answers HTTP 200 with
  no errors even when it ignores a field — a first name on a company contact,
  for example. *Contact → Update* reads the contact back and fails if a field was
  not applied. Turn off **Verify Update** to accept that.
- **Reading a record without a field list returns hundreds of fields** — more than
  400 for a contact. Every Get and Get Many asks for a useful default set; clear
  the **Fields** option to get everything.
- **Revenue accounts live behind two endpoints.** `/revenueaccounts/products` lists
  only product-specific accounts and excludes products that use the standard
  ones. *Resolve Revenue Accounts* queries both and merges them.
- **Searches carry no total count.** *Return All* pages until a short page comes
  back.
- **An invoice may not have a PDF yet.** *Download PDF* explains that rather than
  returning an empty file.

## Compatibility

Built and tested against n8n 2.38.7 (`n8n-workflow` 2.38.1) and the Scopevisio
OpenScope REST API v1.0.0. No runtime dependencies.

## Resources

- [Scopevisio OpenScope API reference](https://appload.scopevisio.com/static/swagger/index.html)
- [Scopevisio search syntax](https://help.scopevisio.com/de/articles/467360-search-scope-documentation)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Licence

[MIT](LICENSE)
