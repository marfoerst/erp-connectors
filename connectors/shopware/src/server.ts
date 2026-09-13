import http from "node:http";

import { loadConfig } from "./config.js";
import prisma from "./db.js";
import { handleConfirm, handleRegister, parseRegisterQuery } from "./registration.js";
import { rawQueryString, verify } from "./signature.js";
import { ShopwareClient } from "./admin-api.js";
import { mapOrder } from "./order-mapper.js";
import { syncOrder } from "./sync.js";
import { shopIdFrom, transactionIdsFrom, type ShopwareWebhookBody } from "./webhooks.js";

/**
 * The connector's HTTP surface. Four endpoints and nothing else:
 *
 *   GET  /healthz                 liveness, touches the database
 *   GET  /app/register            the handshake Shopware starts
 *   POST /app/register/confirm    where Shopware hands over API credentials
 *   POST /webhook/*               signed events from an installed shop
 *
 * Deliberately framework-free. A connector is a webhook receiver and a job
 * runner; a web framework would be more to keep current than it would save.
 */

const config = loadConfig();

function json(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(text);
}

/** Read the body as a raw string — the HMAC is computed over exactly these bytes. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // A webhook body is small. Anything large is not one.
      if (size > 2_000_000) {
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

/** Verify a webhook against the secret we issued that shop at registration. */
async function verifiedShopId(
  rawBody: string,
  signature: string | undefined,
): Promise<{ shopId: string } | { error: string; status: number }> {
  let body: ShopwareWebhookBody;
  try {
    body = JSON.parse(rawBody) as ShopwareWebhookBody;
  } catch {
    return { error: "Body was not JSON.", status: 400 };
  }

  const shopId = shopIdFrom(body);
  if (!shopId) return { error: "No shop id in payload.", status: 400 };

  const shop = await prisma.shopwareShop.findUnique({ where: { shopId } });
  if (!shop) return { error: "Unknown shop.", status: 404 };

  if (!verify(rawBody, signature, shop.shopSecret)) {
    return { error: "Invalid shop signature.", status: 401 };
  }
  return { shopId };
}

async function handleOrderPaid(rawBody: string, shopId: string) {
  const body = JSON.parse(rawBody) as ShopwareWebhookBody;
  const transactionIds = transactionIdsFrom(body);
  if (transactionIds.length === 0) return { handled: 0 };

  const client = await ShopwareClient.forShop(shopId);
  let handled = 0;

  for (const transactionId of transactionIds) {
    // The webhook carries the transaction, not the order.
    const orderId = await client.fetchOrderIdForTransaction(transactionId);
    if (!orderId) continue;

    const raw = await client.fetchOrder(orderId);
    if (!raw) continue;

    await syncOrder(shopId, mapOrder(raw));
    handled += 1;
  }
  return { handled };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    // --- liveness ---------------------------------------------------------
    if (req.method === "GET" && url.pathname === "/healthz") {
      // Touches the database on purpose: the failure that matters is not "the
      // process is up" but "the process is up and its volume is mounted".
      try {
        await prisma.$queryRaw`SELECT 1`;
        return json(res, 200, { ok: true });
      } catch {
        return json(res, 503, { ok: false, reason: "database" });
      }
    }

    // --- registration -----------------------------------------------------
    if (req.method === "GET" && url.pathname === "/app/register") {
      const query = parseRegisterQuery(url);
      if (!query) return json(res, 400, { error: "Missing shop-id, shop-url or timestamp." });

      const result = await handleRegister({
        config,
        query,
        // Signed over the query string as sent. Re-encoding from parsed params
        // reorders and re-escapes, and the HMAC then fails for reasons that
        // look exactly like a wrong secret.
        rawQuery: rawQueryString(req.url ?? ""),
        appSignature: req.headers["shopware-app-signature"] as string | undefined,
        shopSignature: req.headers["shopware-shop-signature"] as string | undefined,
      });
      return json(res, result.status, result.body);
    }

    if (req.method === "POST" && url.pathname === "/app/register/confirm") {
      const rawBody = await readBody(req);
      const result = await handleConfirm({
        rawBody,
        shopSignature: req.headers["shopware-shop-signature"] as string | undefined,
      });
      return json(res, result.status, result.body);
    }

    // --- webhooks ---------------------------------------------------------
    if (req.method === "POST" && url.pathname.startsWith("/webhook/")) {
      const rawBody = await readBody(req);
      const verified = await verifiedShopId(
        rawBody,
        req.headers["shopware-shop-signature"] as string | undefined,
      );
      if ("error" in verified) return json(res, verified.status, { error: verified.error });

      const { shopId } = verified;

      if (url.pathname === "/webhook/order-paid") {
        // Answer before doing the work. Shopware retries on a slow or failed
        // response, and a retry that arrives mid-sync is exactly what the
        // idempotency key exists to absorb — but there is no reason to invite
        // it by holding the connection open through a Scopevisio round trip.
        json(res, 200, { ok: true });
        handleOrderPaid(rawBody, shopId).catch(async (err: Error) => {
          await prisma.syncEvent.create({
            data: {
              shopId,
              level: "error",
              event: "webhook.order_paid_failed",
              message: err.message.slice(0, 1000),
            },
          });
        });
        return;
      }

      if (url.pathname === "/webhook/app-deleted") {
        await prisma.shopwareShop.updateMany({ where: { shopId }, data: { active: false } });
        await prisma.syncEvent.create({
          data: {
            shopId,
            event: "app.deleted",
            message: "The merchant removed the app; syncing stopped.",
          },
        });
        return json(res, 200, { ok: true });
      }

      // A webhook we subscribed to but have not implemented yet must still be
      // acknowledged, or Shopware retries it forever.
      await prisma.syncEvent.create({
        data: {
          shopId,
          level: "warn",
          event: "webhook.unhandled",
          message: `No handler for ${url.pathname}.`,
        },
      });
      return json(res, 200, { ok: true, handled: false });
    }

    return json(res, 404, { error: "Not found." });
  } catch (err) {
    return json(res, 500, { error: (err as Error).message });
  }
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Scopevisio Shopware connector listening on ${config.port} (public: ${config.appUrl})`,
  );
});

export default server;
