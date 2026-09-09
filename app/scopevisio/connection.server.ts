import prisma from "../db.server";
import { DEFAULT_BASE_URL } from "./constants";
import { encrypt } from "./crypto.server";
import { ScopevisioClient, ScopevisioError, type ConnectionInput } from "./client.server";
import { logEvent } from "./log.server";

/**
 * Connection lifecycle. Everything here is driven from the embedded app's
 * Settings screen — the merchant owns their own connection (PRD C-001).
 */


export async function getConnection(shop: string) {
  return prisma.scopevisioConnection.findUnique({
    where: { shop },
    include: { settings: true },
  });
}

export async function getSettings(shop: string) {
  const conn = await getConnection(shop);
  return conn?.settings ?? null;
}

/**
 * Verify credentials *before* storing them, so a merchant never ends up with a
 * saved connection that has never worked.
 */
export async function testCredentials(shop: string, input: ConnectionInput) {
  const client = ScopevisioClient.ephemeral(shop, input);
  const { account } = await client.verify();
  return account;
}

export async function saveConnection(shop: string, input: ConnectionInput) {
  const baseUrl = (input.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const organisation = (input.organisation ?? "").trim();

  // Prove it works first. Any failure propagates to the UI unchanged.
  // The probe also resolves the organisation when the merchant left it blank.
  const probe = ScopevisioClient.ephemeral(shop, { ...input, baseUrl, organisation });
  const verified = await probe.verify();
  const resolvedOrganisation = organisation || verified.organisation || "";

  const connection = await prisma.scopevisioConnection.upsert({
    where: { shop },
    create: {
      shop,
      baseUrl,
      customer: input.customer.trim(),
      organisation: resolvedOrganisation,
      username: input.username.trim(),
      passwordEnc: encrypt(input.password),
      status: "connected",
      statusDetail: null,
      lastCheckAt: new Date(),
    },
    update: {
      baseUrl,
      customer: input.customer.trim(),
      organisation: resolvedOrganisation,
      username: input.username.trim(),
      passwordEnc: encrypt(input.password),
      // New credentials invalidate every cached token.
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      refreshTokenEnc: null,
      status: "connected",
      statusDetail: null,
      lastCheckAt: new Date(),
    },
  });

  // Settings must exist before the merchant can configure the mapping.
  await prisma.scopevisioSettings.upsert({
    where: { shop },
    create: { shop, connectionId: connection.id },
    update: { connectionId: connection.id },
  });

  await logEvent(shop, {
    event: "connection.saved",
    message: `Connected to Scopevisio organisation "${resolvedOrganisation}" as ${input.username}.`,
  });

  return connection;
}

/** Re-probe an existing connection and record the outcome for the UI. */
export async function refreshStatus(shop: string) {
  const conn = await prisma.scopevisioConnection.findUnique({ where: { shop } });
  if (!conn) return null;

  try {
    const client = await ScopevisioClient.forShop(shop);
    await client.verify();
    return prisma.scopevisioConnection.update({
      where: { shop },
      data: { status: "connected", statusDetail: null, lastCheckAt: new Date() },
    });
  } catch (err) {
    const detail =
      err instanceof ScopevisioError ? err.message : "Scopevisio is unreachable.";
    await logEvent(shop, {
      level: "error",
      event: "connection.error",
      message: detail,
    });
    return prisma.scopevisioConnection.update({
      where: { shop },
      data: { status: "error", statusDetail: detail, lastCheckAt: new Date() },
    });
  }
}

export async function deleteConnection(shop: string) {
  await prisma.scopevisioConnection.deleteMany({ where: { shop } });
  await prisma.masterDataCache.deleteMany({ where: { shop } });
  await logEvent(shop, {
    event: "connection.removed",
    message: "Scopevisio connection removed.",
  });
}

export type SettingsPatch = Partial<{
  syncEnabled: boolean;
  autoPost: boolean;
  customerGroup: string;
  guestCustomerGroup: string;
  numberRangeNumber: number | null;
  guestUseCpd: boolean;
  vatScopeDomestic: number | null;
  vatScopeEuB2c: number | null;
  vatScopeEuB2cOss: number | null;
  vatScopeEuB2bReverse: number | null;
  vatScopeThirdCountry: number | null;
  ossRegistered: boolean;
  homeCountry: string;
  taxToleranceCents: number;
  copyVatFromProduct: boolean;
  copyAccountsFromProduct: boolean;
  documentTemplate: string | null;
  deliveryMode: string;
}>;

export async function updateSettings(shop: string, patch: SettingsPatch) {
  const conn = await prisma.scopevisioConnection.findUnique({ where: { shop } });
  if (!conn) {
    throw new ScopevisioError(
      "Connect Scopevisio before changing the mapping.",
      undefined,
      undefined,
      true,
    );
  }
  const updated = await prisma.scopevisioSettings.upsert({
    where: { shop },
    create: { shop, connectionId: conn.id, ...patch },
    update: patch,
  });
  await logEvent(shop, {
    event: "settings.updated",
    message: "Mapping settings updated.",
    data: patch,
  });
  return updated;
}

/**
 * Settings that must be answered before sync can be switched on. Returned to
 * the UI so the merchant learns what is missing up front rather than
 * order-by-order (PRD R-005).
 */
export function missingSettings(
  settings: { vatScopeDomestic: number | null; homeCountry: string } | null,
): string[] {
  if (!settings) return ["Mapping has not been configured yet."];
  const gaps: string[] = [];
  if (!settings.vatScopeDomestic) {
    gaps.push("Domestic tax case (Steuersachverhalt) is not chosen.");
  }
  if (!settings.homeCountry) {
    gaps.push("The organisation's country of taxation is not set.");
  }
  return gaps;
}
