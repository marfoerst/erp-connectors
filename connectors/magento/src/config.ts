import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { encrypt } from "@erp/scopevisio-core";

/**
 * Environment, read once and validated loudly.
 *
 * A connector that boots with a missing secret and only fails on the first
 * webhook is far harder to diagnose than one that refuses to start.
 */

/**
 * Load `.env` into `process.env` if it is there. Real environment variables
 * always win, so a container that sets them directly is unaffected by a stray
 * .env in the image.
 */
export function loadDotenv(dir = process.cwd()): void {
  const file = path.join(dir, ".env");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in — see connectors/magento/README.md.`,
    );
  }
  return v.trim();
}

export interface Config {
  appUrl: string;
  port: number;
  pollIntervalMinutes: number;
  magentoUrlOverride: string | null;
  /** Derived from the encryption key; signs the admin session cookie. */
  sessionKey: Buffer;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  loadDotenv();

  const key = required("SCOPEVISIO_ENCRYPTION_KEY");
  try {
    encrypt("boot-check");
  } catch (err) {
    throw new Error(`SCOPEVISIO_ENCRYPTION_KEY is unusable: ${(err as Error).message}`);
  }

  const override = process.env.MAGENTO_URL_OVERRIDE?.trim();
  cached = {
    appUrl: required("APP_URL").replace(/\/+$/, ""),
    port: Number(process.env.PORT ?? 3200),
    pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES ?? 10),
    magentoUrlOverride: override ? override.replace(/\/+$/, "") : null,
    // A separate key per purpose, without asking the operator for a second
    // secret: HKDF over the one they already keep safe.
    sessionKey: Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(key), "scopevisio-magento", "admin-session", 32),
    ),
  };
  return cached;
}
