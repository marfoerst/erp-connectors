import type { VatScope } from "@erp/scopevisio-core";

import type {
  MagentoStore,
  RefundRecord,
  ScopevisioConnection,
  ScopevisioSettings,
  SyncEvent,
  SyncRecord,
} from "../generated/prisma/index.js";

/**
 * Server-rendered screens. German, because every user is a German-market
 * bookkeeper; the accounting terms have no useful English equivalent anyway.
 *
 * No client-side script at all. Every action is a plain form POST carrying a
 * CSRF token bound to the session, which keeps the Content-Security-Policy
 * down to `default-src 'none'`.
 */

export function h(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATE_LABEL: Record<string, string> = {
  pending: "In Arbeit",
  ready_to_export: "Bereit zum Export",
  exported: "Exportiert – Import bestätigen",
  booked: "Gebucht",
  held: "Zurückgehalten",
  declined: "Abgelehnt",
};

const REASON_LABEL: Record<string, string> = {
  not_configured: "Anbindung nicht eingerichtet",
  sync_disabled: "Übergabe ausgeschaltet",
  tax_mismatch: "Steuer stimmt nicht",
  vat_id_unvalidated: "USt-IdNr. nicht bestätigt",
  vat_scope_unconfigured: "Steuersachverhalt fehlt",
  no_revenue_account: "Kein Erlöskonto",
  revenue_account_lookup_failed: "Erlöskonto nicht abrufbar",
  scopevisio_rejected: "Scopevisio hat abgelehnt",
  invoice_create_failed: "Beleg nicht angenommen",
  invoice_not_created: "Beleg nicht erzeugt",
  order_not_found: "Bestellung nicht gefunden",
  magento_unreachable: "Magento nicht erreichbar",
  unexpected_error: "Unerwarteter Fehler",
  refunded_before_export: "Vor Übergabe erstattet",
  partial_refund_before_export: "Teilerstattung vor Übergabe",
  credit_note_required: "Gutschrift erforderlich",
  possible_duplicate_contact: "Möglicher Kontakt-Duplikat",
};

const TAX_CASES: Array<{ field: keyof ScopevisioSettings; label: string; help: string }> = [
  { field: "vatScopeDomestic", label: "Inland", help: "Lieferungen innerhalb Ihres Heimatlandes." },
  { field: "vatScopeEuB2c", label: "EU-Privatkunden (ohne OSS)", help: "Privatkunden in anderen EU-Staaten, solange Sie nicht am OSS-Verfahren teilnehmen." },
  { field: "vatScopeEuB2cOss", label: "EU-Privatkunden (OSS)", help: "Privatkunden in anderen EU-Staaten im OSS-Verfahren." },
  { field: "vatScopeEuB2bReverse", label: "EU-Unternehmen (Reverse Charge)", help: "Nur mit einer von VIES bestätigten USt-IdNr." },
  { field: "vatScopeThirdCountry", label: "Drittland (Ausfuhr)", help: "Lieferungen außerhalb der EU." },
];

const STYLE = `
:root{--ink:#1d2330;--muted:#5f6878;--line:#dde1e8;--bg:#f6f7f9;--card:#fff;--accent:#0b5cad;--ok:#1f7a3a;--warn:#946200;--bad:#b42318}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
header{background:#1d2330;color:#fff;padding:.9rem 1.25rem;display:flex;flex-wrap:wrap;gap:1rem;align-items:center}
header strong{font-weight:600;margin-right:1rem}header a{color:#cfd6e4;text-decoration:none;padding:.2rem 0}header a[aria-current]{color:#fff;border-bottom:2px solid #fff}
main{max-width:72rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.5rem;margin:.2rem 0 1rem}h2{font-size:1.1rem;margin:2rem 0 .75rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.25rem;margin-bottom:1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.75rem}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.8rem 1rem}.stat b{display:block;font-size:1.7rem;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.flash{padding:.7rem 1rem;border-radius:6px;margin-bottom:1rem;border:1px solid}.flash.ok{background:#eaf6ee;border-color:#b7dfc3}.flash.bad{background:#fdeceb;border-color:#f2c1bc;color:var(--bad)}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{text-align:left;padding:.55rem .75rem;border-bottom:1px solid var(--line);vertical-align:top}th{background:#fafbfc;font-weight:600;white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.8rem;border:1px solid var(--line);white-space:nowrap}
.badge.booked,.badge.ready_to_export{color:var(--ok);border-color:#b7dfc3;background:#eaf6ee}.badge.held,.badge.exported{color:var(--warn);border-color:#ecd39a;background:#fdf6e3}.badge.declined{color:var(--bad);border-color:#f2c1bc;background:#fdeceb}
form.inline{display:inline}label{display:block;font-weight:600;margin:.9rem 0 .25rem}.help{font-weight:400;color:var(--muted);font-size:.88rem;margin:.15rem 0 0}
input[type=text],input[type=password],input[type=number],select{font:inherit;padding:.45rem .55rem;border:1px solid #b9c0cc;border-radius:4px;width:100%;max-width:28rem}
.check{display:flex;gap:.5rem;align-items:flex-start;font-weight:600;margin-top:.9rem}.check input{margin-top:.3rem}
button,.button{font:inherit;display:inline-block;padding:.45rem .95rem;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;text-decoration:none}
button.secondary,.button.secondary{background:#fff;color:var(--accent)}button.danger{background:#fff;color:var(--bad);border-color:var(--bad)}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}
`;

export interface PageOptions {
  title: string;
  body: string;
  active?: string;
  flash?: { kind: "ok" | "bad"; text: string } | null;
  nav?: boolean;
}

export function page({ title, body, active, flash, nav = true }: PageOptions): string {
  const links: Array<[string, string]> = [
    ["/magento/app", "Übersicht"],
    ["/magento/app/invoices", "Rechnungen"],
    ["/magento/app/export", "CSV-Export"],
    ["/magento/app/settings", "Einstellungen"],
    ["/magento/app/connection", "Verbindung"],
    ["/magento/app/journal", "Protokoll"],
  ];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} · Scopevisio für Magento</title><style>${STYLE}</style></head><body>
<header><strong>Scopevisio für Magento</strong>${
    nav
      ? links.map(([href, label]) => `<a href="${href}"${active === href ? ' aria-current="page"' : ""}>${label}</a>`).join("")
      : ""
  }</header>
<main>${flash ? `<div class="flash ${flash.kind}">${h(flash.text)}</div>` : ""}<h1>${h(title)}</h1>${body}</main></body></html>`;
}

const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–";

const csrfField = (csrf: string) => `<input type="hidden" name="csrf" value="${h(csrf)}">`;

function badge(state: string) {
  return `<span class="badge ${h(state)}">${h(STATE_LABEL[state] ?? state)}</span>`;
}

export function reasonLabel(reason: string | null) {
  return reason ? (REASON_LABEL[reason] ?? reason) : "";
}

// --- overview ---------------------------------------------------------------

export function overviewPage(args: {
  store: MagentoStore;
  connection: ScopevisioConnection | null;
  settings: ScopevisioSettings | null;
  counts: Record<string, number>;
  attention: SyncRecord[];
  csrf: string;
  flash?: PageOptions["flash"];
}) {
  const { store, connection, settings, counts, attention, csrf } = args;

  const steps: string[] = [];
  if (!connection) steps.push(`<a href="/magento/app/connection">Scopevisio verbinden</a>`);
  if (connection && !settings?.vatScopeDomestic) steps.push(`<a href="/magento/app/settings">Steuersachverhalte zuordnen</a>`);
  if (settings && !settings.syncEnabled) steps.push(`<a href="/magento/app/settings">Übergabe einschalten</a>`);

  const stat = (state: string) =>
    `<a class="stat" style="color:inherit;text-decoration:none" href="/magento/app/invoices?state=${state}">${h(STATE_LABEL[state])}<b>${counts[state] ?? 0}</b></a>`;

  const body = `
${steps.length ? `<div class="card"><strong>Noch zu tun:</strong> ${steps.join(" · ")}</div>` : ""}
<div class="grid">${["ready_to_export", "exported", "held", "declined", "booked"].map(stat).join("")}</div>

<h2>Verbindungen</h2>
<div class="card">
  <p><strong>Magento:</strong> ${h(store.storeBaseUrl)} –
    ${store.status === "active" ? `<span class="ok">aktiv</span>` : `<span class="bad">${h(store.status)}</span>`}
    ${store.statusDetail ? `<br><span class="muted">${h(store.statusDetail)}</span>` : ""}</p>
  <p><strong>Scopevisio:</strong> ${
    connection
      ? `Kunde ${h(connection.customer)}, ${h(connection.organisation || "Organisation automatisch")} – <span class="ok">verbunden</span>`
      : `<span class="warn">nicht verbunden</span>`
  }</p>
  <p class="muted">Übergabe: ${settings?.syncEnabled ? "eingeschaltet" : "ausgeschaltet"} · Weg: ${settings?.deliveryMode === "api" ? "API (blockiert)" : "CSV-Import"} · Letzter Abgleich mit Magento: ${fmtDate(store.lastPolledAt)}</p>
  <form method="post" action="/magento/app/poll" class="inline">${csrfField(csrf)}<button class="secondary">Jetzt bei Magento nach bezahlten Rechnungen suchen</button></form>
</div>

<h2>Braucht Aufmerksamkeit</h2>
${attention.length ? invoiceTable(attention, csrf) : `<p class="muted">Nichts – alle Rechnungen sind verarbeitet.</p>`}
`;
  return page({ title: "Übersicht", body, active: "/magento/app", flash: args.flash });
}

// --- invoices ---------------------------------------------------------------

function invoiceTable(rows: SyncRecord[], csrf: string) {
  return `<div class="table-wrap"><table><thead><tr>
<th>Rechnung</th><th>Bestellung</th><th>Status</th><th>Hinweis</th><th>Kontakt / Debitor</th><th>Land</th><th class="num">USt Shop</th><th>Aktualisiert</th><th></th>
</tr></thead><tbody>${rows
    .map((r) => {
      const canRetry = ["held", "declined", "pending"].includes(r.state) && r.reason !== "refunded_before_export";
      return `<tr>
<td>${h(r.externalRef ?? r.externalId)}</td>
<td>${h(r.orderRef ?? r.orderId ?? "")}</td>
<td>${badge(r.state)}</td>
<td>${r.reason ? `<strong>${h(reasonLabel(r.reason))}</strong><br>` : ""}<span class="muted">${h(r.detail ?? "")}</span></td>
<td>${r.contactId ? `${h(r.contactId)} / ${h(r.personalAccount ?? "–")}` : "–"}</td>
<td>${h(r.countryUsed ?? "")}</td>
<td class="num">${r.sourceTaxCents !== null ? (r.sourceTaxCents / 100).toFixed(2).replace(".", ",") : ""}</td>
<td>${fmtDate(r.updatedAt)}</td>
<td>${canRetry ? `<form method="post" action="/magento/app/invoices/retry" class="inline">${csrfField(csrf)}<input type="hidden" name="id" value="${h(r.id)}"><button class="secondary">Erneut verarbeiten</button></form>` : ""}</td>
</tr>`;
    })
    .join("")}</tbody></table></div>`;
}

export function invoicesPage(args: { rows: SyncRecord[]; state: string | null; csrf: string; flash?: PageOptions["flash"] }) {
  const filters = [["", "Alle"], ...Object.entries(STATE_LABEL)]
    .map(([s, label]) => `<a class="button ${args.state === s || (!args.state && !s) ? "" : "secondary"}" href="/magento/app/invoices${s ? `?state=${s}` : ""}">${h(label)}</a>`)
    .join(" ");
  const body = `
<div class="actions">${filters}</div>
<div class="actions"><form method="post" action="/magento/app/invoices/retry-held" class="inline">${csrfField(args.csrf)}<button class="secondary">Alle zurückgehaltenen erneut verarbeiten</button></form></div>
${args.rows.length ? invoiceTable(args.rows, args.csrf) : `<p class="muted">Keine Rechnungen in dieser Ansicht.</p>`}
<p class="muted">Es werden die neuesten 200 angezeigt.</p>`;
  return page({ title: "Rechnungen", body, active: "/magento/app/invoices", flash: args.flash });
}

// --- export -----------------------------------------------------------------

export function exportPage(args: {
  pending: SyncRecord[];
  batches: Array<{ batchId: string; count: number; exportedAt: Date | null }>;
  csrf: string;
  flash?: PageOptions["flash"];
}) {
  const { pending, batches, csrf } = args;
  const body = `
<div class="card">
  <p>Der Connector hat Kontakt, Debitor, Steuersachverhalt, Erlöskonto und Steuerschlüssel bereits bestimmt. Die CSV-Datei importieren Sie in Scopevisio unter
  <strong>Abrechnung → Abrechnungsbelege → Import</strong>. Die Spaltennamen entsprechen den Scopevisio-Feldern.</p>
  <p><strong>${pending.length}</strong> Rechnung(en) bereit.</p>
  <form method="post" action="/magento/app/export/download">${csrfField(csrf)}
    <button ${pending.length ? "" : "disabled"}>CSV herunterladen und als exportiert markieren</button>
  </form>
  <p class="muted">Nach dem Herunterladen erscheinen diese Rechnungen in keinem weiteren Export – ein doppelter Import würde doppelte Rechnungen erzeugen.</p>
</div>

<h2>Wartet auf Bestätigung</h2>
${
  batches.length
    ? `<div class="table-wrap"><table><thead><tr><th>Batch</th><th class="num">Rechnungen</th><th>Exportiert</th><th></th></tr></thead><tbody>${batches
        .map(
          (b) => `<tr><td>${h(b.batchId)}</td><td class="num">${b.count}</td><td>${fmtDate(b.exportedAt)}</td><td>
<a class="button secondary" href="/magento/app/export/batch?id=${encodeURIComponent(b.batchId)}">Erneut herunterladen</a>
<form method="post" action="/magento/app/export/confirm" class="inline">${csrfField(csrf)}<input type="hidden" name="id" value="${h(b.batchId)}"><button>Import erfolgreich</button></form>
<form method="post" action="/magento/app/export/return" class="inline">${csrfField(csrf)}<input type="hidden" name="id" value="${h(b.batchId)}"><input type="hidden" name="reason" value="Import fehlgeschlagen"><button class="danger">Import fehlgeschlagen</button></form>
</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : `<p class="muted">Keine offenen Batches.</p>`
}

${pending.length ? `<h2>Bereit</h2>${invoiceTable(pending, csrf)}` : ""}`;
  return page({ title: "CSV-Export", body, active: "/magento/app/export", flash: args.flash });
}

// --- connection -------------------------------------------------------------

export function connectionPage(args: {
  connection: ScopevisioConnection | null;
  csrf: string;
  returnUrl: string | null;
  flash?: PageOptions["flash"];
}) {
  const { connection, csrf, returnUrl } = args;
  const body = `
${
  connection
    ? `<div class="card"><p class="ok"><strong>Verbunden</strong> mit Kunde ${h(connection.customer)}, ${h(connection.organisation)} als ${h(connection.username)}.</p>
       <p class="muted">Ihr Passwort ist nicht gespeichert – nur ein widerrufbarer Token. Neue Zugangsdaten ersetzen die Verbindung.</p></div>`
    : `<p>Melden Sie diesen Shop bei Ihrer Scopevisio-Organisation an. Die Zugangsdaten werden vor dem Speichern geprüft; das Passwort wird gegen einen Token getauscht und danach verworfen.</p>`
}
<form method="post" action="/magento/app/connection" class="card">${csrfField(csrf)}
  <label for="customer">Kundennummer<p class="help">Siebenstellig, z. B. 2039915.</p></label>
  <input type="text" id="customer" name="customer" inputmode="numeric" required value="${h(connection?.customer ?? "")}">
  <label for="organisation">Organisation<p class="help">Leer lassen, wenn der Benutzer nur zu einer Organisation gehört.</p></label>
  <input type="text" id="organisation" name="organisation" value="${h(connection?.organisation ?? "")}">
  <label for="username">Benutzer (E-Mail)</label>
  <input type="text" id="username" name="username" autocomplete="username" required value="${h(connection?.username ?? "")}">
  <label for="password">Passwort</label>
  <input type="password" id="password" name="password" autocomplete="current-password" required>
  <div class="actions"><button>Prüfen und speichern</button></div>
</form>
${returnUrl && connection ? `<div class="actions"><a class="button" href="/magento/app/settings">Weiter zu den Einstellungen</a><a class="button secondary" href="${h(returnUrl)}">Aktivierung abschließen und zu Magento zurück</a></div>` : ""}`;
  return page({ title: "Scopevisio-Verbindung", body, active: "/magento/app/connection", flash: args.flash });
}

// --- settings ---------------------------------------------------------------

export function settingsPage(args: {
  settings: ScopevisioSettings;
  scopes: VatScope[] | null;
  scopesError: string | null;
  csrf: string;
  returnUrl: string | null;
  flash?: PageOptions["flash"];
}) {
  const { settings: s, scopes, scopesError, csrf, returnUrl } = args;
  const check = (name: keyof ScopevisioSettings, label: string, help: string) =>
    `<div class="check"><input type="checkbox" id="${name}" name="${name}" value="1" ${s[name] ? "checked" : ""}><label for="${name}" style="margin:0">${label}<p class="help">${help}</p></label></div>`;
  const text = (name: keyof ScopevisioSettings, label: string, help: string, type = "text") =>
    `<label for="${name}">${label}<p class="help">${help}</p></label><input type="${type}" id="${name}" name="${name}" value="${h(s[name] ?? "")}">`;

  const scopeSelect = (field: keyof ScopevisioSettings, label: string, help: string) => {
    const current = s[field] as number | null;
    const options = (scopes ?? [])
      .map((v) => `<option value="${v.caseId}" ${current === v.caseId ? "selected" : ""}>${h(v.caseId)} – ${h(v.caseName)}</option>`)
      .join("");
    return `<label for="${field}">${label}<p class="help">${help}</p></label>
<select id="${field}" name="${field}"><option value="">– nicht zugeordnet (Rechnungen werden zurückgehalten) –</option>${options}</select>`;
  };

  const body = `
<form method="post" action="/magento/app/settings">${csrfField(csrf)}
<div class="card">
  <h2 style="margin-top:0">Übergabe</h2>
  ${check("syncEnabled", "Bezahlte Rechnungen verarbeiten", "Ausgeschaltet werden eingehende Rechnungen zurückgehalten, nicht verworfen.")}
  <label for="deliveryMode">Weg in die Buchhaltung</label>
  <select id="deliveryMode" name="deliveryMode">
    <option value="csv" ${s.deliveryMode !== "api" ? "selected" : ""}>CSV-Import in Scopevisio (empfohlen)</option>
    <option value="api" ${s.deliveryMode === "api" ? "selected" : ""}>Direkt per API – derzeit blockiert, hält jede Rechnung zurück</option>
  </select>
</div>

<div class="card">
  <h2 style="margin-top:0">Steuer</h2>
  <p class="muted">Der Connector berechnet keine Umsatzsteuer. Er bestimmt nur den Steuersachverhalt und fragt Ihre Steuermatrix nach Erlöskonto und Steuerschlüssel. Die Steuer aus Magento dient nur als Prüfsumme.</p>
  ${text("homeCountry", "Heimatland", "ISO-Code, z. B. DE.")}
  ${check("ossRegistered", "Teilnahme am OSS-Verfahren", "Dann werden EU-Privatkunden mit dem OSS-Steuersachverhalt gebucht.")}
  ${scopesError ? `<p class="bad">Steuersachverhalte konnten nicht geladen werden: ${h(scopesError)}</p>` : ""}
  ${TAX_CASES.map((c) => scopeSelect(c.field, c.label, c.help)).join("")}
  ${text("taxToleranceCents", "Toleranz der Steuerprüfung (Cent)", "Rundungsdifferenz je Steuersatz, zusätzlich zu einem Cent je Position.", "number")}
</div>

<div class="card">
  <h2 style="margin-top:0">Kunden</h2>
  ${text("customerGroup", "Kundengruppe für Kundenkonten", "Wird in Scopevisio angelegt, falls sie fehlt.")}
  ${text("guestCustomerGroup", "Kundengruppe für Gastbestellungen", "")}
  ${check("guestUseCpd", "Gäste als CpD-Konto (Conto pro Diverse) anlegen", "Hält den Debitorenstamm frei von Einmalkunden.")}
  ${text("numberRangeNumber", "Debitoren-Nummernkreis (optional)", "Leer lassen für den Standard-Nummernkreis.", "number")}
</div>
<div class="actions"><button>Speichern</button>${returnUrl ? `<a class="button secondary" href="${h(returnUrl)}">Aktivierung abschließen und zu Magento zurück</a>` : ""}</div>
</form>`;
  return page({ title: "Einstellungen", body, active: "/magento/app/settings", flash: args.flash });
}

// --- journal ----------------------------------------------------------------

export function journalPage(args: { events: SyncEvent[]; refunds: RefundRecord[] }) {
  const body = `
<h2>Erstattungen</h2>
${
  args.refunds.length
    ? `<div class="table-wrap"><table><thead><tr><th>Gutschrift</th><th>Rechnung</th><th>Ergebnis</th><th>Zeit</th></tr></thead><tbody>${args.refunds
        .map((r) => `<tr><td>${h(r.externalRef ?? r.externalId)}</td><td>${h(r.invoiceExternalId ?? "–")}</td><td>${h(r.detail)}</td><td>${fmtDate(r.createdAt)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="muted">Keine.</p>`
}
<h2>Ereignisse</h2>
<div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Ebene</th><th>Ereignis</th><th>Meldung</th></tr></thead><tbody>${args.events
    .map((e) => `<tr><td>${fmtDate(e.createdAt)}</td><td class="${e.level === "error" ? "bad" : e.level === "warn" ? "warn" : ""}">${h(e.level)}</td><td><code>${h(e.event)}</code></td><td>${h(e.message)}</td></tr>`)
    .join("")}</tbody></table></div>
<p class="muted">Die neuesten 300 Einträge. Das Protokoll wird nie verändert; Zugangsdaten werden vor dem Schreiben entfernt.</p>`;
  return page({ title: "Protokoll", body, active: "/magento/app/journal" });
}

// --- plain messages ---------------------------------------------------------

export function messagePage(title: string, message: string, refreshSeconds?: number) {
  const refresh = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : "";
  return page({ title, body: `${refresh}<div class="card"><p>${h(message)}</p></div>`, nav: false });
}
