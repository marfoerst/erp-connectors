import http from "node:http";

import { tryDecrypt } from "@erp/scopevisio-core";

import { loadConfig } from "./config.js";
import { connectScopevisio, listVatScopes } from "./connection.js";
import prisma from "./db.js";
import {
  confirmImported,
  createExportBatch,
  openBatches,
  pendingExport,
  rebuildBatch,
  returnBatchToQueue,
} from "./export.js";
import { pollStore, processInvoice, startPolling } from "./intake.js";
import { syncCreditMemo } from "./refunds.js";
import { ACTIVATION_WINDOW_MS, handleIntegrationEndpoint } from "./registration.js";
import {
  createSession,
  csrfToken,
  readSession,
  verifyAdminLink,
  verifyCsrf,
  verifyWebhook,
} from "./signature.js";
import { recordEvent } from "./store.js";
import { acceptInvoice } from "./sync.js";
import * as ui from "./ui.js";

/**
 * The connector's HTTP surface.
 *
 *   GET  /healthz                        liveness, touches the database
 *   POST /magento/integration/endpoint   Magento hands over OAuth consumer credentials
 *   GET  /magento/integration/identity   the activation popup Magento opens
 *   POST /magento/webhook                signed outbox deliveries
 *   GET  /magento/admin                  signed link from the Magento admin → session
 *   *    /magento/app/…                  the merchant's screens (session + CSRF)
 *
 * Framework-free, like the Shopware connector: a webhook receiver, a job
 * runner and six forms do not need one.
 */

const config = loadConfig();
const SESSION_COOKIE = "sv_mg_session";
const RETURN_COOKIE = "sv_mg_return";
const secureCookies = config.appUrl.startsWith("https://");

type Res = http.ServerResponse;

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function json(res: Res, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function html(res: Res, status: number, body: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function redirect(res: Res, location: string, cookies: string[] = []) {
  res.writeHead(303, { location, ...SECURITY_HEADERS, ...(cookies.length ? { "set-cookie": cookies } : {}) });
  res.end();
}

function cookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/magento; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookies ? "; Secure" : ""}`;
}

function readCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function flashFrom(url: URL): ui.PageOptions["flash"] {
  const ok = url.searchParams.get("ok");
  const err = url.searchParams.get("err");
  if (err) return { kind: "bad", text: err };
  if (ok) return { kind: "ok", text: ok };
  return null;
}

const withFlash = (path: string, kind: "ok" | "err", text: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`;

// --- webhook ----------------------------------------------------------------

async function handleWebhook(req: http.IncomingMessage, res: Res) {
  const raw = await readBody(req);
  const consumerKey = req.headers["x-scopevisio-consumer-key"] as string | undefined;
  if (!consumerKey) return json(res, 400, { error: "Missing X-Scopevisio-Consumer-Key." });

  const store = await prisma.magentoStore.findUnique({ where: { consumerKey } });
  if (!store) return json(res, 404, { error: "Unknown store." });
  const secret = tryDecrypt(store.consumerSecretEnc);
  if (!secret) return json(res, 500, { error: "Store secret unreadable." });

  const verified = verifyWebhook({
    consumerSecret: secret,
    timestamp: req.headers["x-scopevisio-timestamp"] as string | undefined,
    signature: req.headers["x-scopevisio-signature"] as string | undefined,
    rawBody: raw,
  });
  if (!verified.ok) {
    await recordEvent(store.id, {
      level: "warn",
      event: "webhook.rejected",
      message: `Webhook abgewiesen: ${verified.reason}.`,
    });
    return json(res, 401, { error: `Invalid signature: ${verified.reason}.` });
  }
  // Not active yet (mid-handshake): a non-2xx makes the outbox retry later.
  if (store.status !== "active") return json(res, 409, { error: "Store is not active." });

  let body: { event?: string; entityId?: number; orderId?: number | null };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "Body was not JSON." });
  }
  const entityId = Number(body.entityId);
  if (!Number.isInteger(entityId) || entityId <= 0) return json(res, 400, { error: "No entityId." });

  if (body.event === "invoice.paid") {
    // Durable before the 2xx: once Magento marks the row delivered, this record
    // is the only trace, and polling retries anything left pending.
    await acceptInvoice(store.id, `invoice:${entityId}`, { orderId: body.orderId ?? null, orderRef: null });
    json(res, 202, { ok: true });
    processInvoice(store.id, entityId).catch((err: Error) =>
      recordEvent(store.id, { level: "error", event: "webhook.invoice_failed", message: err.message, externalId: `invoice:${entityId}` }),
    );
    return;
  }
  if (body.event === "creditmemo.created") {
    json(res, 202, { ok: true });
    syncCreditMemo(store.id, entityId).catch((err: Error) =>
      recordEvent(store.id, { level: "error", event: "webhook.refund_failed", message: err.message, externalId: `creditmemo:${entityId}` }),
    );
    return;
  }

  // Acknowledged, or the outbox would retry an event we will never understand.
  await recordEvent(store.id, { level: "warn", event: "webhook.unhandled", message: `Unbekanntes Ereignis ${body.event}.` });
  return json(res, 200, { ok: true, handled: false });
}

// --- activation popup and admin link ----------------------------------------

function sameOrigin(a: string, b: string) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.protocol === y.protocol && x.host === y.host;
  } catch {
    return false;
  }
}

async function handleIdentity(url: URL, res: Res) {
  const consumerKey = url.searchParams.get("oauth_consumer_key") ?? "";
  const callback = url.searchParams.get("success_call_back");
  const store = consumerKey ? await prisma.magentoStore.findUnique({ where: { consumerKey } }) : null;

  if (!store || store.status === "handshake") {
    return html(res, 200, ui.messagePage("Verbindung wird hergestellt", "Magento und der Connector tauschen gerade die Zugangsschlüssel aus. Diese Seite aktualisiert sich selbst.", 2));
  }
  if (store.status === "failed") {
    return html(res, 200, ui.messagePage("Aktivierung fehlgeschlagen", `Der Schlüsselaustausch mit Magento ist fehlgeschlagen: ${store.statusDetail ?? "unbekannter Fehler"}. Bitte in Magento erneut aktivieren.`));
  }
  // This page carries no signature — Magento does not sign identity links. It
  // may only open a session shortly after a handshake that proved possession
  // of the verifier; afterwards the signed admin link is the only way in.
  if (!store.activatedAt || Date.now() - store.activatedAt.getTime() > ACTIVATION_WINDOW_MS) {
    return html(res, 403, ui.messagePage("Link abgelaufen", "Öffnen Sie den Connector aus dem Magento-Admin unter Verkäufe → Scopevisio ERP."));
  }

  const cookies = [cookie(SESSION_COOKIE, createSession(config.sessionKey, store.id, "Magento-Aktivierung", 3600), 3600)];
  // Only ever send the merchant back to their own Magento.
  if (callback && sameOrigin(callback, store.storeBaseUrl)) cookies.push(cookie(RETURN_COOKIE, callback, 3600));
  const connection = await prisma.scopevisioConnection.findUnique({ where: { storeId: store.id } });
  return redirect(res, connection ? "/magento/app/settings" : "/magento/app/connection", cookies);
}

async function handleAdminLink(url: URL, res: Res) {
  const consumerKey = url.searchParams.get("consumer_key") ?? "";
  const store = consumerKey ? await prisma.magentoStore.findUnique({ where: { consumerKey } }) : null;
  const secret = store ? tryDecrypt(store.consumerSecretEnc) : null;
  const user = url.searchParams.get("user");
  if (
    !store ||
    !secret ||
    !verifyAdminLink({
      consumerSecret: secret,
      consumerKey,
      timestamp: url.searchParams.get("ts"),
      user,
      signature: url.searchParams.get("signature"),
    })
  ) {
    return html(res, 403, ui.messagePage("Link ungültig", "Der Link ist abgelaufen oder nicht von Ihrem Magento signiert. Öffnen Sie den Connector erneut aus dem Magento-Admin."));
  }
  return redirect(res, "/magento/app", [
    cookie(SESSION_COOKIE, createSession(config.sessionKey, store.id, user!), 8 * 3600),
    `${RETURN_COOKIE}=; Path=/magento; Max-Age=0`,
  ]);
}

// --- merchant screens -------------------------------------------------------

async function handleApp(req: http.IncomingMessage, res: Res, url: URL) {
  const cookies = readCookies(req);
  const token = cookies[SESSION_COOKIE];
  const session = readSession(config.sessionKey, token);
  if (!session || !token) {
    return html(res, 401, ui.messagePage("Bitte anmelden", "Öffnen Sie den Connector aus dem Magento-Admin unter Verkäufe → Scopevisio ERP."));
  }
  const store = await prisma.magentoStore.findUnique({ where: { id: session.storeId } });
  if (!store) return html(res, 404, ui.messagePage("Unbekannter Shop", "Dieser Shop ist nicht mehr verbunden."));

  const storeId = store.id;
  const csrf = csrfToken(config.sessionKey, token);
  const returnUrl = cookies[RETURN_COOKIE] || null;
  const path = url.pathname;
  const flash = flashFrom(url);

  let form = new URLSearchParams();
  if (req.method === "POST") {
    form = new URLSearchParams(await readBody(req));
    if (!verifyCsrf(config.sessionKey, token, form.get("csrf"))) {
      return html(res, 403, ui.messagePage("Sitzung abgelaufen", "Bitte laden Sie die Seite neu und versuchen Sie es erneut."));
    }
  }

  if (req.method === "GET" && path === "/magento/app") {
    const [connection, settings, grouped, attention] = await Promise.all([
      prisma.scopevisioConnection.findUnique({ where: { storeId } }),
      prisma.scopevisioSettings.findUnique({ where: { storeId } }),
      prisma.syncRecord.groupBy({ by: ["state"], where: { storeId }, _count: { _all: true } }),
      prisma.syncRecord.findMany({
        where: { storeId, OR: [{ state: { in: ["held", "declined", "pending"] } }, { reason: "credit_note_required" }] },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    ]);
    const counts = Object.fromEntries(grouped.map((g) => [g.state, g._count._all]));
    return html(res, 200, ui.overviewPage({ store, connection, settings, counts, attention, csrf, flash }));
  }

  if (req.method === "POST" && path === "/magento/app/poll") {
    try {
      const r = await pollStore(storeId);
      return redirect(res, withFlash("/magento/app", "ok",
        `${r.invoices} bezahlte Rechnung(en) gefunden, ${r.processed} neu verarbeitet, ${r.retried} erneut versucht, ${r.creditMemos} Erstattung(en).`));
    } catch (err) {
      return redirect(res, withFlash("/magento/app", "err", (err as Error).message));
    }
  }

  if (req.method === "GET" && path === "/magento/app/invoices") {
    const state = url.searchParams.get("state");
    const rows = await prisma.syncRecord.findMany({
      where: { storeId, ...(state ? { state } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return html(res, 200, ui.invoicesPage({ rows, state, csrf, flash }));
  }

  if (req.method === "POST" && path === "/magento/app/invoices/retry") {
    const record = await prisma.syncRecord.findFirst({ where: { id: form.get("id") ?? "", storeId } });
    if (!record) return redirect(res, withFlash("/magento/app/invoices", "err", "Rechnung nicht gefunden."));
    const outcome = await processInvoice(storeId, Number(record.externalId.replace("invoice:", "")));
    return redirect(res, withFlash("/magento/app/invoices", outcome.state === "held" || outcome.state === "declined" ? "err" : "ok",
      `Rechnung ${record.externalRef ?? record.externalId}: ${ui.reasonLabel("reason" in outcome ? outcome.reason : null) || outcome.state}${"detail" in outcome ? ` – ${outcome.detail}` : ""}`));
  }

  if (req.method === "POST" && path === "/magento/app/invoices/retry-held") {
    const held = await prisma.syncRecord.findMany({ where: { storeId, state: "held" }, take: 200 });
    let done = 0;
    for (const record of held) {
      const outcome = await processInvoice(storeId, Number(record.externalId.replace("invoice:", "")));
      if (outcome.state !== "held") done++;
    }
    return redirect(res, withFlash("/magento/app/invoices", "ok", `${held.length} zurückgehaltene Rechnung(en) erneut verarbeitet, ${done} davon nicht mehr zurückgehalten.`));
  }

  if (req.method === "GET" && path === "/magento/app/export") {
    const [pending, batches] = await Promise.all([pendingExport(storeId), openBatches(storeId)]);
    return html(res, 200, ui.exportPage({ pending, batches, csrf, flash }));
  }

  if (req.method === "POST" && path === "/magento/app/export/download") {
    const batch = await createExportBatch(storeId, session.user);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="scopevisio-${batch.batchId}.csv"`,
      ...SECURITY_HEADERS,
    });
    return res.end(batch.csv);
  }

  if (req.method === "GET" && path === "/magento/app/export/batch") {
    const batchId = url.searchParams.get("id") ?? "";
    const batch = await rebuildBatch(storeId, batchId);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="scopevisio-${batchId.replace(/[^A-Za-z0-9-]/g, "")}.csv"`,
      ...SECURITY_HEADERS,
    });
    return res.end(batch.csv);
  }

  if (req.method === "POST" && path === "/magento/app/export/confirm") {
    const n = await confirmImported(storeId, form.get("id") ?? "", session.user);
    return redirect(res, withFlash("/magento/app/export", "ok", `${n} Rechnung(en) als gebucht bestätigt.`));
  }

  if (req.method === "POST" && path === "/magento/app/export/return") {
    const n = await returnBatchToQueue(storeId, form.get("id") ?? "", form.get("reason") || "Import fehlgeschlagen", session.user);
    return redirect(res, withFlash("/magento/app/export", "ok", `${n} Rechnung(en) zurück in die Warteschlange gestellt.`));
  }

  if (path === "/magento/app/connection") {
    if (req.method === "POST") {
      try {
        await connectScopevisio(storeId, {
          customer: form.get("customer") ?? "",
          organisation: form.get("organisation") ?? "",
          username: form.get("username") ?? "",
          password: form.get("password") ?? "",
        }, session.user);
        return redirect(res, withFlash("/magento/app/connection", "ok", "Verbindung geprüft und gespeichert."));
      } catch (err) {
        return redirect(res, withFlash("/magento/app/connection", "err", (err as Error).message));
      }
    }
    const connection = await prisma.scopevisioConnection.findUnique({ where: { storeId } });
    return html(res, 200, ui.connectionPage({ connection, csrf, returnUrl, flash }));
  }

  if (path === "/magento/app/settings") {
    const connection = await prisma.scopevisioConnection.findUnique({ where: { storeId } });
    if (!connection) return redirect(res, withFlash("/magento/app/connection", "err", "Bitte zuerst Scopevisio verbinden."));
    const settings = await prisma.scopevisioSettings.upsert({ where: { storeId }, create: { storeId }, update: {} });

    if (req.method === "POST") {
      const int = (name: string) => {
        const v = (form.get(name) ?? "").trim();
        return v === "" ? null : Number.parseInt(v, 10);
      };
      const home = (form.get("homeCountry") ?? "DE").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(home)) {
        return redirect(res, withFlash("/magento/app/settings", "err", "Heimatland muss ein ISO-Code aus zwei Buchstaben sein."));
      }
      await prisma.scopevisioSettings.update({
        where: { storeId },
        data: {
          syncEnabled: form.get("syncEnabled") === "1",
          deliveryMode: form.get("deliveryMode") === "api" ? "api" : "csv",
          homeCountry: home,
          ossRegistered: form.get("ossRegistered") === "1",
          customerGroup: (form.get("customerGroup") ?? "").trim() || "Magento",
          guestCustomerGroup: (form.get("guestCustomerGroup") ?? "").trim() || "Magento Gast",
          guestUseCpd: form.get("guestUseCpd") === "1",
          numberRangeNumber: int("numberRangeNumber"),
          taxToleranceCents: Math.max(0, int("taxToleranceCents") ?? 2),
          vatScopeDomestic: int("vatScopeDomestic"),
          vatScopeEuB2c: int("vatScopeEuB2c"),
          vatScopeEuB2cOss: int("vatScopeEuB2cOss"),
          vatScopeEuB2bReverse: int("vatScopeEuB2bReverse"),
          vatScopeThirdCountry: int("vatScopeThirdCountry"),
        },
      });
      await recordEvent(storeId, { event: "settings.saved", message: `${session.user} hat die Einstellungen gespeichert.` });
      return redirect(res, withFlash("/magento/app/settings", "ok", "Einstellungen gespeichert."));
    }

    let scopes = null;
    let scopesError: string | null = null;
    try {
      scopes = await listVatScopes(storeId);
    } catch (err) {
      scopesError = (err as Error).message;
    }
    return html(res, 200, ui.settingsPage({ settings, scopes, scopesError, csrf, returnUrl, flash }));
  }

  if (req.method === "GET" && path === "/magento/app/journal") {
    const [events, refunds] = await Promise.all([
      prisma.syncEvent.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 300 }),
      prisma.refundRecord.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return html(res, 200, ui.journalPage({ events, refunds }));
  }

  return html(res, 404, ui.messagePage("Nicht gefunden", "Diese Seite gibt es nicht."));
}

// --- routing ----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://connector.invalid");
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return json(res, 200, { ok: true });
      } catch {
        return json(res, 503, { ok: false, reason: "database" });
      }
    }
    if (req.method === "POST" && url.pathname === "/magento/integration/endpoint") {
      const result = await handleIntegrationEndpoint(new URLSearchParams(await readBody(req)));
      return json(res, result.status, result.body);
    }
    if (req.method === "GET" && url.pathname === "/magento/integration/identity") return await handleIdentity(url, res);
    if (req.method === "POST" && url.pathname === "/magento/webhook") return await handleWebhook(req, res);
    if (req.method === "GET" && url.pathname === "/magento/admin") return await handleAdminLink(url, res);
    if (url.pathname === "/magento/app" || url.pathname.startsWith("/magento/app/")) return await handleApp(req, res, url);
    if (req.method === "GET" && url.pathname === "/") return redirect(res, "/magento/app");
    return json(res, 404, { error: "Not found." });
  } catch (err) {
    if (!res.headersSent) return json(res, 500, { error: (err as Error).message });
    res.end();
  }
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Scopevisio Magento connector listening on ${config.port} (public: ${config.appUrl})`);
});
startPolling(config.pollIntervalMinutes);

export default server;
