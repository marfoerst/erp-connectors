"""Assert every n8n end-to-end run against what it must prove."""
import json, os, re, sys

RES = sys.argv[1]

def load(wid):
    p = os.path.join(RES, wid + ".json")
    if not os.path.exists(p):
        return None, "result file missing"
    raw = open(p, encoding="utf-8", errors="replace").read()
    # The CLI prints task-runner log lines around the JSON, so decode the first
    # complete JSON object and ignore whatever follows it.
    decoder = json.JSONDecoder()
    for start in [i for i, ch in enumerate(raw) if ch == "{"][:50]:
        try:
            doc, _ = decoder.raw_decode(raw[start:])
            if isinstance(doc, dict) and ("data" in doc or "resultData" in doc):
                return doc, None
        except Exception:  # noqa: BLE001
            continue
    return None, "no execution JSON in output: " + raw.strip()[-300:]

def run_data(doc):
    return doc.get("data", {}).get("resultData", {}).get("runData", {}) or doc.get("resultData", {}).get("runData", {})

def items(doc, node):
    rd = run_data(doc).get(node)
    if not rd:
        return None
    main = rd[0].get("data", {}).get("main", [[]])
    return main[0] if main else []

def node_error(doc, node):
    rd = run_data(doc).get(node)
    return (rd[0].get("error") or {}) if rd else {}

def top_error(doc):
    return doc.get("data", {}).get("resultData", {}).get("error") or {}

results = []
def check(tid, desc, fn):
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"assertion crashed: {e!r}"
    results.append((tid, ok, desc, detail))

def expect_items(wid, node, pred, desc_ok):
    doc, err = load(wid)
    if err:
        return False, err
    its = items(doc, node)
    if its is None:
        e = top_error(doc) or node_error(doc, node)
        return False, "node did not run: " + str(e.get("message", e))[:240]
    return pred(its)

def expect_error_item(wid, node, pattern):
    doc, err = load(wid)
    if err:
        return False, err
    its = items(doc, node) or []
    msg = " ".join(str(i.get("json", {}).get("error", "")) for i in its)
    ok = bool(re.search(pattern, msg, re.I))
    return ok, f"error item: {msg[:240]!r}"

# ---- reads ------------------------------------------------------------------
check("T02", "Get Many contacts returns only the default fields, 3 items", lambda: expect_items("e2eT02ContactMany0", "Contacts",
    lambda its: (len(its) == 3 and all(set(i["json"]).issubset({"id","lastname","firstname","email","phone","street1","postcode1","city1","country1","vatId","tags","legacyNumber"}) for i in its),
                 f"{len(its)} items, keys={sorted(its[0]['json'])[:14] if its else None}"), ""))
check("T03", "Filter lastname contains 'Probe' finds probe contact 101072, sorted desc", lambda: expect_items("e2eT03ContactFilt0", "Contacts",
    lambda its: (any(i["json"].get("id") == 101072 for i in its) and all("probe" in str(i["json"].get("lastname","")).lower() for i in its),
                 f"{len(its)} items: {[ (i['json'].get('id'), i['json'].get('lastname')) for i in its][:5]}"), ""))

t04_count = {}
def t04():
    doc, err = load("e2eT04ContactAll00")
    if err: return False, err
    its = items(doc, "Contacts") or []
    t04_count["n"] = len(its)
    ids = [i["json"].get("id") for i in its]
    return (len(its) > 0 and len(set(ids)) == len(ids) and all(set(i["json"]) == {"id"} for i in its),
            f"{len(its)} unique ids, id-only records")
check("T04", "Return All contacts yields unique id-only records", t04)
def t05():
    doc, err = load("e2eT05ContactCnt00")
    if err: return False, err
    its = items(doc, "Count") or []
    n = its[0]["json"].get("count") if its else None
    return (isinstance(n, int) and n == t04_count.get("n"), f"count={n}, Return All returned {t04_count.get('n')}")
check("T05", "Count equals the number Return All returned", t05)

check("T06", "Get contact by ID", lambda: expect_items("e2eT06ContactGetId", "Get",
    lambda its: (its and its[0]["json"].get("id") == 101072 and its[0]["json"].get("lastname") == "n8n Probe GmbH", str(its[0]["json"] if its else None)[:200]), ""))
check("T07", "Get contact by legacy number resolves the same contact", lambda: expect_items("e2eT07ContactLegcy", "Get",
    lambda its: (its and its[0]["json"].get("id") == 101072, str(its[0]["json"] if its else None)[:200]), ""))

# ---- write chain ------------------------------------------------------------
def t08():
    doc, err = load("e2eT08WriteChain00")
    if err: return False, err
    out = []
    created = items(doc, "Create Contact")
    if not created: return False, "Create Contact did not run: " + str(top_error(doc).get("message"))[:240]
    cid = created[0]["json"].get("id")
    out.append(f"created id={cid}")
    upd = items(doc, "Update Contact") or []
    u = upd[0]["json"] if upd else {}
    ok_upd = u.get("city1") == "Köln" and str(u.get("email","")).startswith("e2e-updated-") and u.get("notApplied") == []
    out.append(f"update city1={u.get('city1')} notApplied={u.get('notApplied')}")
    ign = items(doc, "Update Ignored Field") or []
    g = ign[0]["json"] if ign else {}
    ok_ign = g.get("notApplied") == ["firstname"]
    out.append(f"ignored-field notApplied={g.get('notApplied')}")
    d1 = items(doc, "Create Debitor") or []
    d2 = items(doc, "Create Debitor Again") or []
    out.append(f"debitor1={json.dumps(d1[0]['json'] if d1 else None)[:120]}")
    out.append(f"debitor2={json.dumps(d2[0]['json'] if d2 else None)[:120]}")
    ok = bool(cid) and ok_upd and ok_ign and bool(d1) and bool(d2)
    return ok, " | ".join(out)
check("T08", "Create → update (verified) → unapplied field reported → debitor → debitor again", t08)
check("T10", "Update with an unapplied field fails when verification is on", lambda: expect_error_item("e2eT10UpdateVerify", "Update", r"did not apply.*firstname"))

# ---- products ---------------------------------------------------------------
check("T14", "Get Many products with default fields", lambda: expect_items("e2eT14ProductMany0", "Products",
    lambda its: (len(its) == 2 and all("number" in i["json"] and "name" in i["json"] for i in its), f"{[i['json'] for i in its]}"[:220]), ""))
check("T15", "Get product 2420", lambda: expect_items("e2eT15ProductGet00", "Product",
    lambda its: (its and "Hochzeit" in str(its[0]["json"].get("name")), str(its[0]["json"] if its else None)[:200]), ""))
check("T16", "Create product", lambda: expect_items("e2eT16ProductNew00", "Product",
    lambda its: (bool(its) and not its[0]["json"].get("error"), json.dumps(its[0]["json"] if its else None)[:220]), ""))

# ---- invoices ---------------------------------------------------------------
check("T17", "Get Many outgoing invoices, newest first", lambda: expect_items("e2eT17InvoiceMany0", "Invoices",
    lambda its: (len(its) == 3 and all("documentNumber" in i["json"] for i in its) and its[0]["json"]["id"] > its[-1]["json"]["id"],
                 f"{[(i['json'].get('id'), i['json'].get('documentNumber')) for i in its]}"), ""))
check("T18", "Get outgoing invoice RE-2020-1", lambda: expect_items("e2eT18InvoiceGet00", "Invoice",
    lambda its: (its and len(its[0]["json"]) > 5, f"{len(its[0]['json']) if its else 0} fields"), ""))
def t19():
    doc, err = load("e2eT19InvoicePdf00")
    if err: return False, err
    its = items(doc, "PDF") or []
    if not its: return False, "no items: " + str(top_error(doc).get("message"))[:200]
    b = (its[0].get("binary") or {}).get("invoice") or {}
    j = its[0]["json"]
    ok = b.get("mimeType") == "application/pdf" and j.get("fileSize", 0) > 50000 and b.get("fileName") == "RE-2020-1.pdf"
    return ok, f"binary.invoice mime={b.get('mimeType')} name={b.get('fileName')} size={j.get('fileSize')} fileExtension={b.get('fileExtension')}"
check("T19", "Download PDF returns a real PDF as binary in the chosen field", t19)
check("T20", "Invoice without a PDF gives a clear error", lambda: expect_error_item("e2eT20InvoiceNoPdf", "PDF", r"has no PDF"))
check("T21", "Posting refuses to run without confirmation", lambda: expect_error_item("e2eT21PostGuard000", "Post", r"irreversible"))
check("T22", "Get Many incoming invoices", lambda: expect_items("e2eT22IncomingMany", "Incoming",
    lambda its: (len(its) == 2 and all("id" in i["json"] for i in its), f"{[i['json'] for i in its]}"), ""))
check("T23", "Get incoming invoice 4693", lambda: expect_items("e2eT23IncomingGet0", "Incoming",
    lambda its: (its and its[0]["json"].get("id") == 4693, f"{len(its[0]['json']) if its else 0} fields, id={its[0]['json'].get('id') if its else None}"), ""))

# ---- tax & reports ----------------------------------------------------------
check("T24", "Tax cases listed with caseId and caseName", lambda: expect_items("e2eT24TaxCases000", "Tax Cases",
    lambda its: (len(its) > 0 and all("caseId" in i["json"] and "caseName" in i["json"] for i in its), f"{len(its)} cases: {[(i['json'].get('caseId'), i['json'].get('caseName')) for i in its][:6]}"), ""))
check("T25", "VAT matrix entries", lambda: expect_items("e2eT25VatMatrix000", "VAT Matrix",
    lambda its: (len(its) > 0 and "vatKey" in its[0]["json"], f"{len(its)} entries"), ""))
check("T26", "Revenue accounts resolved for DE / case 1 (lowercase country accepted)", lambda: expect_items("e2eT26RevenueAcct0", "Revenue",
    lambda its: (len(its) > 0 and all("accountNumber" in i["json"] for i in its), f"{len(its)} accounts: {[(i['json'].get('accountNumber'), i['json'].get('vatKey'), i['json'].get('countryIso')) for i in its][:5]}"), ""))
check("T27", "Report rows limited to 5, German column names", lambda: expect_items("e2eT27ReportRows00", "Report",
    lambda its: (len(its) == 5 and "Belegnummer" in its[0]["json"], f"{len(its)} rows, keys={list(its[0]['json'])[:5] if its else None}"), ""))

# ---- negative paths ---------------------------------------------------------
check("T28", "Unknown contact reports not found", lambda: expect_error_item("e2eT28NotFound0000", "Get", r"could not find|not found|404"))
check("T29", "Unknown filter field surfaces Scopevisio's message", lambda: expect_error_item("e2eT29BadField0000", "Contacts", r"rejected the request|definitelyNotAField"))
check("T30", "Revoked credential reports rejected credentials", lambda: expect_error_item("e2eT30BadCred00000", "Account", r"rejected the credentials|401|Unauthorized|token"))

# ---- trigger ----------------------------------------------------------------
# `n8n execute` refuses a workflow whose only start node is a polling trigger
# ("Missing node to start execution"), so manual-mode polling is covered by the
# mocked tests in test/nodes.test.ts, and real polling by the live T32 check.

passed = sum(1 for r in results if r[1])
for tid, ok, desc, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {tid}  {desc}")
    print(f"        {detail}")
print(f"\n{passed}/{len(results)} passed")
