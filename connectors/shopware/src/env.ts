import fs from "node:fs";
import path from "node:path";

/**
 * Load `.env` into `process.env` if it is there.
 *
 * Deliberately not a dependency: this is fifteen lines, and the alternative was
 * relying on whatever the shell happened to export — which is how this
 * connector first "started successfully" while being unable to encrypt
 * anything.
 *
 * Real environment variables always win, so a container that sets them
 * directly is unaffected by a stray .env in the image.
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
    // Strip one layer of matching quotes, as every .env reader does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
