import {
  DEFAULT_BASE_URL,
  encrypt,
  ScopevisioClient,
  type RecordsResponse,
  type VatScope,
} from "@erp/scopevisio-core";

import prisma from "./db.js";
import { connectionStore, recordEvent, scopevisioContext } from "./store.js";

/**
 * The merchant's Scopevisio connection: verify before storing, store
 * encrypted, drop the password as soon as a refresh token exists (core does
 * the dropping on the first token response).
 */
export async function connectScopevisio(
  storeId: string,
  input: { customer: string; organisation?: string; username: string; password: string },
  by: string,
) {
  const baseUrl = DEFAULT_BASE_URL;
  const customer = input.customer.trim();
  const username = input.username.trim();
  const organisation = (input.organisation ?? "").trim();

  // Prove it works before anything is written. A failure propagates to the form.
  const probe = ScopevisioClient.ephemeral({ baseUrl, customer, organisation, username, password: input.password });
  const verified = await probe.verify();

  await prisma.scopevisioConnection.upsert({
    where: { storeId },
    create: {
      storeId,
      baseUrl,
      customer,
      organisation: organisation || verified.organisation || "",
      username,
      passwordEnc: encrypt(input.password),
      status: "connected",
    },
    update: {
      baseUrl,
      customer,
      organisation: organisation || verified.organisation || "",
      username,
      passwordEnc: encrypt(input.password),
      // New credentials invalidate every cached token.
      refreshTokenEnc: null,
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      status: "connected",
      statusDetail: null,
    },
  });

  // Exchange the password for a refresh token now, so it is not kept a moment
  // longer than the form submission.
  const client = await ScopevisioClient.fromStore(connectionStore(storeId));
  await client.verify();

  await prisma.scopevisioSettings.upsert({ where: { storeId }, create: { storeId }, update: {} });
  await recordEvent(storeId, {
    event: "connection.saved",
    message: `${by} hat die Scopevisio-Verbindung gespeichert (Kunde ${customer}, ${client.organisation || "Organisation automatisch"}).`,
  });
}

/** Steuersachverhalte offered on the mapping screen — the tenant's own. */
export async function listVatScopes(storeId: string): Promise<VatScope[]> {
  const ctx = await scopevisioContext(storeId);
  const res = await ctx.client.get<RecordsResponse<VatScope> | VatScope[]>("/vatscopes", { active: true });
  const scopes = Array.isArray(res) ? res : (res?.records ?? []);
  return scopes.filter((s) => s.active !== false);
}
