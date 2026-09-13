import { encrypt } from "@erp/scopevisio-core";

import type { Config } from "./config.js";
import prisma from "./db.js";
import { generateShopSecret, registrationProof, verify } from "./signature.js";

/**
 * The Shopware app handshake, in two calls.
 *
 * 1. Shopware GETs our registrationUrl with shop-id, shop-url and timestamp,
 *    signed with the APP secret. We answer with a proof that we know that same
 *    secret, plus a freshly minted SHOP secret.
 * 2. Shopware POSTs to our confirmation_url with the Admin API credentials,
 *    signed with the SHOP secret we just issued.
 *
 * Nothing here ever sees the merchant's Shopware password. That is the whole
 * point of the design, and it is what a credential-sharing model gives up.
 */

export interface RegisterQuery {
  shopId: string;
  shopUrl: string;
  timestamp: string;
}

export function parseRegisterQuery(url: URL): RegisterQuery | null {
  const shopId = url.searchParams.get("shop-id");
  const shopUrl = url.searchParams.get("shop-url");
  const timestamp = url.searchParams.get("timestamp");
  if (!shopId || !shopUrl || !timestamp) return null;
  return { shopId, shopUrl, timestamp };
}

export interface RegisterResponse {
  proof: string;
  secret: string;
  confirmation_url: string;
}

/**
 * Handle the registration request.
 *
 * The shop secret is generated here and stored immediately, because the
 * confirmation call that follows is signed with it — if we did not persist it
 * first, a confirmation arriving before the write completed would be rejected
 * as unsigned.
 *
 * Re-registration is supported: an existing shop keeps its row and gets a new
 * secret. Shopware sends `shopware-shop-signature` on a re-registration, signed
 * with the OLD secret; we verify it when we have one, so that a stranger who
 * learns a shopId cannot re-point an installed shop at themselves. That is
 * exactly the hole CVE-2026-31889 opened in Shopware's own implementation.
 */
export async function handleRegister(args: {
  config: Config;
  query: RegisterQuery;
  rawQuery: string;
  appSignature: string | undefined;
  shopSignature: string | undefined;
}): Promise<{ status: number; body: RegisterResponse | { error: string } }> {
  const { config, query, rawQuery, appSignature, shopSignature } = args;

  if (!verify(rawQuery, appSignature, config.appSecret)) {
    return { status: 401, body: { error: "Invalid app signature." } };
  }

  const existing = await prisma.shopwareShop.findUnique({ where: { shopId: query.shopId } });
  if (existing) {
    // Re-registration. Prove possession of the current secret before replacing it.
    if (!verify(rawQuery, shopSignature, existing.shopSecret)) {
      return { status: 401, body: { error: "Invalid shop signature on re-registration." } };
    }
  }

  const secret = generateShopSecret();

  await prisma.shopwareShop.upsert({
    where: { shopId: query.shopId },
    create: {
      shopId: query.shopId,
      shopUrl: query.shopUrl,
      shopSecret: secret,
      active: true,
    },
    update: { shopUrl: query.shopUrl, shopSecret: secret, active: true },
  });

  return {
    status: 200,
    body: {
      proof: registrationProof({
        shopId: query.shopId,
        shopUrl: query.shopUrl,
        appName: config.appName,
        appSecret: config.appSecret,
      }),
      secret,
      confirmation_url: `${config.appUrl}/app/register/confirm`,
    },
  };
}

export interface ConfirmBody {
  apiKey?: string;
  secretKey?: string;
  shopId?: string;
  shopUrl?: string;
  timestamp?: string;
}

/**
 * Handle the confirmation request, which carries the Admin API credentials.
 *
 * They are encrypted at rest with the same key that protects the Scopevisio
 * credentials — a leak of this database should not hand over the ability to
 * read the merchant's orders.
 */
export async function handleConfirm(args: {
  rawBody: string;
  shopSignature: string | undefined;
}): Promise<{ status: number; body: { ok: true } | { error: string } }> {
  let parsed: ConfirmBody;
  try {
    parsed = JSON.parse(args.rawBody) as ConfirmBody;
  } catch {
    return { status: 400, body: { error: "Body was not JSON." } };
  }

  const { shopId, apiKey, secretKey } = parsed;
  if (!shopId || !apiKey || !secretKey) {
    return { status: 400, body: { error: "Missing shopId, apiKey or secretKey." } };
  }

  const shop = await prisma.shopwareShop.findUnique({ where: { shopId } });
  if (!shop) {
    return { status: 404, body: { error: "Unknown shop. Register first." } };
  }

  // Signed over the RAW body with the secret we issued at registration.
  if (!verify(args.rawBody, args.shopSignature, shop.shopSecret)) {
    return { status: 401, body: { error: "Invalid shop signature." } };
  }

  await prisma.shopwareShop.update({
    where: { shopId },
    data: {
      apiKeyEnc: encrypt(apiKey),
      secretKeyEnc: encrypt(secretKey),
      shopUrl: parsed.shopUrl ?? shop.shopUrl,
      active: true,
    },
  });

  await prisma.syncEvent.create({
    data: {
      shopId,
      event: "app.registered",
      message: "Shopware handed over Admin API credentials; the app is installed.",
    },
  });

  return { status: 200, body: { ok: true } };
}
