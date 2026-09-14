import { encrypt, tryDecrypt } from "@erp/scopevisio-core";

import prisma from "./db.js";
import { exchangeTokens, reachableBaseUrl } from "./magento-api.js";
import { recordEvent } from "./store.js";

/**
 * The integration handshake Magento starts when the merchant presses
 * Activate → Allow (or runs `scopevisio:integration:setup --activate`).
 *
 * 1. Magento POSTs oauth_consumer_key, oauth_consumer_secret, oauth_verifier and
 *    store_base_url to our endpoint. We answer 200 at once.
 * 2. We exchange them for an access token against that store — request token,
 *    then access token. Magento only issues one to a caller holding the
 *    verifier it just generated, within its five-minute consumer window.
 * 3. Only then is the store usable.
 *
 * The endpoint is unauthenticated by nature — the credentials ARE the
 * authentication — so an attacker can post invented credentials. That creates
 * at most a store record pointing at a Magento they control. What it must not
 * do is take over an existing store: an existing consumer key is only updated
 * after the exchange succeeds against the SAME base URL, which proves the
 * caller is that Magento.
 */

function normaliseBaseUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}/`.toLowerCase();
}

export interface EndpointResult {
  status: number;
  body: unknown;
}

export async function handleIntegrationEndpoint(form: URLSearchParams): Promise<EndpointResult> {
  const consumerKey = form.get("oauth_consumer_key")?.trim();
  const consumerSecret = form.get("oauth_consumer_secret")?.trim();
  const verifier = form.get("oauth_verifier")?.trim();
  const storeBaseUrlRaw = form.get("store_base_url")?.trim();

  if (!consumerKey || !consumerSecret || !verifier || !storeBaseUrlRaw) {
    return { status: 400, body: { error: "Missing oauth_consumer_key, oauth_consumer_secret, oauth_verifier or store_base_url." } };
  }
  let storeBaseUrl: string;
  try {
    storeBaseUrl = normaliseBaseUrl(storeBaseUrlRaw);
  } catch {
    return { status: 400, body: { error: "store_base_url is not a URL." } };
  }

  const existing = await prisma.magentoStore.findUnique({ where: { consumerKey } });
  if (existing && normaliseBaseUrl(existing.storeBaseUrl) !== storeBaseUrl) {
    return { status: 409, body: { error: "This consumer key belongs to another store." } };
  }

  // Answer first. Magento's HTTP client waits for this response, and the token
  // exchange that follows calls back into the same Magento.
  setTimeout(() => {
    void completeHandshake({ consumerKey, consumerSecret, verifier, storeBaseUrl });
  }, 0);
  return { status: 200, body: { ok: true } };
}

export async function completeHandshake(args: {
  consumerKey: string;
  consumerSecret: string;
  verifier: string;
  storeBaseUrl: string;
}) {
  const { consumerKey, consumerSecret, verifier, storeBaseUrl } = args;

  // A brand-new store gets a row right away, so the activation popup — which
  // Magento opens as soon as our endpoint answered — has something to show.
  let store = await prisma.magentoStore.findUnique({ where: { consumerKey } });
  if (!store) {
    store = await prisma.magentoStore.create({
      data: { consumerKey, consumerSecretEnc: encrypt(consumerSecret), storeBaseUrl, status: "handshake" },
    });
  }

  let lastError: Error | null = null;
  for (const delayMs of [0, 1000, 3000, 6000]) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const token = await exchangeTokens({
        baseUrl: reachableBaseUrl(storeBaseUrl),
        consumerKey,
        consumerSecret,
        verifier,
      });
      // The exchange proved this caller is the Magento at storeBaseUrl; only
      // now may secrets on an existing store be replaced.
      await prisma.magentoStore.update({
        where: { id: store.id },
        data: {
          consumerSecretEnc: encrypt(consumerSecret),
          accessTokenEnc: encrypt(token.token),
          accessTokenSecretEnc: encrypt(token.secret),
          storeBaseUrl,
          status: "active",
          statusDetail: null,
          activatedAt: new Date(),
        },
      });
      await recordEvent(store.id, {
        event: "integration.activated",
        message: `Magento-Integration aktiviert für ${storeBaseUrl}.`,
      });
      return true;
    } catch (err) {
      lastError = err as Error;
    }
  }

  // Leave a previously working store working: a failed re-activation must not
  // destroy the tokens it already has.
  const hadTokens = Boolean(tryDecrypt(store.accessTokenEnc));
  await prisma.magentoStore.update({
    where: { id: store.id },
    data: hadTokens
      ? { statusDetail: `Erneute Aktivierung fehlgeschlagen: ${lastError?.message}` }
      : { status: "failed", statusDetail: lastError?.message ?? "Token exchange failed." },
  });
  await recordEvent(store.id, {
    level: "error",
    event: "integration.handshake_failed",
    message: `OAuth-Austausch mit ${storeBaseUrl} fehlgeschlagen: ${lastError?.message}`,
    data: { body: (lastError as { body?: string } | null)?.body },
  });
  return false;
}

/** How long after activation the unsigned identity popup may set up a store. */
export const ACTIVATION_WINDOW_MS = 15 * 60 * 1000;
