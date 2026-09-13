import { encrypt } from "@erp/scopevisio-core";

import { loadDotenv } from "./env.js";

/**
 * Environment, read once and validated loudly.
 *
 * A connector that boots with a missing secret and only fails on the first
 * webhook is far harder to diagnose than one that refuses to start.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in — see connectors/shopware/README.md.`,
    );
  }
  return v.trim();
}

export interface Config {
  appName: string;
  appSecret: string;
  appUrl: string;
  port: number;
}

export function loadConfig(): Config {
  loadDotenv();

  // Prove the encryption key works now rather than on the first registration.
  // A connector that boots happily and then fails to store credentials is far
  // harder to diagnose than one that refuses to start — and this exact failure
  // cost a debugging round during development.
  required("SCOPEVISIO_ENCRYPTION_KEY");
  try {
    encrypt("boot-check");
  } catch (err) {
    throw new Error(`SCOPEVISIO_ENCRYPTION_KEY is unusable: ${(err as Error).message}`);
  }

  return {
    appName: required("SHOPWARE_APP_NAME"),
    appSecret: required("SHOPWARE_APP_SECRET"),
    appUrl: required("APP_URL").replace(/\/+$/, ""),
    port: Number(process.env.PORT ?? 3100),
  };
}
