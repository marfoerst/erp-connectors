"""Generate the n8n end-to-end test workflows.

Each test is its own workflow — Manual Trigger → one or more Scopevisio nodes —
so a failure isolates cleanly. Expected-failure tests set the node to continue
on error and the assertions check the error item.

Tenant-specific values (the probe contact and its legacy number, the product,
the invoice numbers) point at the Scopevisio test tenant these tests were first
run against. Change them before running against another tenant.

Usage:  python3 generate-workflows.py <output-dir>
"""
import json, os, sys, time

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
STAMP = str(int(time.time()))
GOOD = {"scopevisioApi": {"id": "svCredE2E0000001", "name": "Scopevisio E2E"}}
BAD = {"scopevisioApi": {"id": "svCredBAD0000001", "name": "Scopevisio Revoked"}}

# Tenant-specific fixtures
PROBE_CONTACT = "101072"
PROBE_LEGACY = "n8n-probe-1789371289534"
PRODUCT_ID = "2420"
INVOICE_WITH_PDF = "RE-2020-1"
INVOICE_WITHOUT_PDF = "RE-2026-26"
INCOMING_INVOICE_ID = "4693"
C = "continueRegularOutput"


def node(name, params, x=300, cred=GOOD, on_error=None):
    n = {"id": name.lower().replace(" ", "-"), "name": name, "type": "n8n-nodes-scopevisio.scopevisio",
         "typeVersion": 1, "position": [x, 300], "parameters": params, "credentials": cred}
    if on_error:
        n["onError"] = on_error
    return n


def wf(wid, name, chain):
    start = {"id": "trigger", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1,
             "position": [0, 300], "parameters": {}}
    conns, prev = {}, "Start"
    for n in chain:
        conns[prev] = {"main": [[{"node": n["name"], "type": "main", "index": 0}]]}
        prev = n["name"]
    return {"id": wid, "name": name, "nodes": [start] + chain, "connections": conns, "active": False,
            "settings": {"executionOrder": "v1"}}


W = [
    wf("e2eT01AccountGet00", "T01 account get", [node("Account", {"resource": "account", "operation": "get"})]),
    wf("e2eT02ContactMany0", "T02 contacts default fields", [node("Contacts", {"resource": "contact", "operation": "getMany", "limit": 3})]),
    wf("e2eT03ContactFilt0", "T03 contacts filtered", [node("Contacts", {"resource": "contact", "operation": "getMany", "returnAll": True,
        "filters": {"conditions": [{"field": "lastname", "operator": "contains", "value": "Probe"}]},
        "options": {"fields": "id,lastname,tags", "sortDirection": "desc"}})]),
    wf("e2eT04ContactAll00", "T04 contacts return all ids", [node("Contacts", {"resource": "contact", "operation": "getMany", "returnAll": True, "options": {"fields": "id"}})]),
    wf("e2eT05ContactCnt00", "T05 contacts count", [node("Count", {"resource": "contact", "operation": "count"})]),
    wf("e2eT06ContactGetId", "T06 contact get by id", [node("Get", {"resource": "contact", "operation": "get", "identifyBy": "ID", "identifier": PROBE_CONTACT})]),
    wf("e2eT07ContactLegcy", "T07 contact get by legacy number", [node("Get", {"resource": "contact", "operation": "get", "identifyBy": "LEGACYNUMBER", "identifier": PROBE_LEGACY})]),
    wf("e2eT08WriteChain00", "T08 write chain", [
        node("Create Contact", {"resource": "contact", "operation": "create", "contactType": "company", "lastname": "n8n E2E GmbH " + STAMP,
             "additionalFields": {"email": f"e2e-{STAMP}@example.de", "street1": "Teststr. 8", "postcode1": "53111", "city1": "Bonn",
                                  "country1": "DE", "vatId": "DE811907980", "tags": "n8n-e2e", "legacyNumber": "n8n-e2e-" + STAMP}}, 300),
        node("Update Contact", {"resource": "contact", "operation": "update", "contactId": "={{ $json.id }}",
             "updateFields": {"email": f"e2e-updated-{STAMP}@example.de", "city1": "Köln"}}, 600),
        node("Update Ignored Field", {"resource": "contact", "operation": "update", "contactId": "={{ $json.id }}",
             "updateFields": {"firstname": "Paula"}, "options": {"verify": False}}, 900),
        node("Create Debitor", {"resource": "debitor", "operation": "create", "contactId": "={{ $json.id }}", "additionalFields": {"group": "n8n E2E"}}, 1200),
        node("Create Debitor Again", {"resource": "debitor", "operation": "create", "contactId": "={{ $('Create Contact').item.json.id }}",
             "additionalFields": {"group": "n8n E2E"}}, 1500),
    ]),
    wf("e2eT10UpdateVerify", "T10 update unapplied field fails", [node("Update", {"resource": "contact", "operation": "update", "contactId": PROBE_CONTACT, "updateFields": {"firstname": "Paula"}}, on_error=C)]),
    wf("e2eT14ProductMany0", "T14 products", [node("Products", {"resource": "product", "operation": "getMany", "limit": 2})]),
    wf("e2eT15ProductGet00", "T15 product get", [node("Product", {"resource": "product", "operation": "get", "productId": PRODUCT_ID})]),
    wf("e2eT16ProductNew00", "T16 product create", [node("Product", {"resource": "product", "operation": "create", "name": "n8n E2E Produkt " + STAMP, "unit": "Stück",
        "additionalFields": {"number": "N8N-E2E-" + STAMP, "singleAmount": 12.5, "taxRate": 19}})]),
    wf("e2eT17InvoiceMany0", "T17 outgoing invoices", [node("Invoices", {"resource": "outgoingInvoice", "operation": "getMany", "limit": 3, "options": {"sortDirection": "desc"}})]),
    wf("e2eT18InvoiceGet00", "T18 outgoing invoice get", [node("Invoice", {"resource": "outgoingInvoice", "operation": "get", "documentNumber": INVOICE_WITH_PDF})]),
    wf("e2eT19InvoicePdf00", "T19 invoice pdf", [node("PDF", {"resource": "outgoingInvoice", "operation": "downloadPdf", "documentNumber": INVOICE_WITH_PDF, "binaryPropertyName": "invoice"})]),
    wf("e2eT20InvoiceNoPdf", "T20 invoice without pdf fails", [node("PDF", {"resource": "outgoingInvoice", "operation": "downloadPdf", "documentNumber": INVOICE_WITHOUT_PDF, "binaryPropertyName": "data"}, on_error=C)]),
    wf("e2eT21PostGuard000", "T21 posting refused without confirmation", [node("Post", {"resource": "outgoingInvoice", "operation": "post", "documentNumber": INVOICE_WITHOUT_PDF, "confirmPosting": False}, on_error=C)]),
    wf("e2eT22IncomingMany", "T22 incoming invoices", [node("Incoming", {"resource": "incomingInvoice", "operation": "getMany", "limit": 2, "options": {"fields": "id"}})]),
    wf("e2eT23IncomingGet0", "T23 incoming invoice get", [node("Incoming", {"resource": "incomingInvoice", "operation": "get", "invoiceId": INCOMING_INVOICE_ID})]),
    wf("e2eT24TaxCases000", "T24 tax cases", [node("Tax Cases", {"resource": "tax", "operation": "getTaxCases", "activeOnly": True})]),
    wf("e2eT25VatMatrix000", "T25 vat matrix", [node("VAT Matrix", {"resource": "tax", "operation": "getVatMatrix"})]),
    wf("e2eT26RevenueAcct0", "T26 resolve revenue accounts", [node("Revenue", {"resource": "tax", "operation": "resolveRevenueAccounts", "country": "de", "taxCaseId": 1,
        "servicesRenderedDate": "2026-09-14T00:00:00.000+02:00", "activeOnly": True})]),
    wf("e2eT27ReportRows00", "T27 report rows limited", [node("Report", {"resource": "report", "operation": "getRows", "datasource": "outgoingInvoice",
        "startDate": "2026-01-01T00:00:00.000+01:00", "endDate": "2026-12-31T00:00:00.000+01:00", "returnAll": False, "limit": 5})]),
    wf("e2eT28NotFound0000", "T28 unknown contact", [node("Get", {"resource": "contact", "operation": "get", "identifyBy": "ID", "identifier": "999999999"}, on_error=C)]),
    wf("e2eT29BadField0000", "T29 unknown filter field", [node("Contacts", {"resource": "contact", "operation": "getMany", "limit": 1,
        "filters": {"conditions": [{"field": "definitelyNotAField", "operator": "equal", "value": "x"}]}}, on_error=C)]),
    wf("e2eT30BadCred00000", "T30 revoked credential", [node("Account", {"resource": "account", "operation": "get"}, cred=BAD, on_error=C)]),
]

live_trigger = {"id": "e2eT32TriggerLive0", "name": "T32 trigger live: new contact", "active": False,
    "settings": {"executionOrder": "v1"},
    "nodes": [{"id": "trigger", "name": "Scopevisio Trigger", "type": "n8n-nodes-scopevisio.scopevisioTrigger", "typeVersion": 1, "position": [0, 300],
               "parameters": {"event": "newContact", "pollTimes": {"item": [{"mode": "everyMinute"}]}, "options": {"fields": "id,lastname,tags"}},
               "credentials": GOOD}],
    "connections": {}}

for w in W + [live_trigger]:
    with open(os.path.join(OUT, w["id"] + ".json"), "w", encoding="utf-8") as f:
        json.dump(w, f, ensure_ascii=False)
print(f"{len(W) + 1} workflows written to {OUT}")
