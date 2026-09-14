/**
 * Credential redaction for journals.
 *
 * Key-only redaction is not enough: access tokens have turned up embedded in
 * URLs (`?access_token=…`) and inside error bodies (`Bearer …`, and for
 * Magento an `Authorization: OAuth oauth_token="…"` header echoed back). So
 * values are scrubbed as well as keys.
 *
 * Was a private copy in each connector; REPO-STRUCTURE.md lists journal
 * redaction as something that must not diverge between them.
 */

const SENSITIVE_KEY = /pass|secret|token|authorization|apikey|api_key|verifier|signature/i;

export function scrubValue(value: string): string {
  return value
    .replace(
      /(access_token|refresh_token|password|secret|api_key|apiKey|oauth_token_secret|oauth_consumer_secret|oauth_verifier)=[^&\s"']+/gi,
      "$1=***",
    )
    .replace(/(oauth_(?:token|signature|verifier|consumer_secret))="[^"]*"/gi, '$1="***"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer ***");
}

export function scrub(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof input === "string") return scrubValue(input);
  if (Array.isArray(input)) return input.map((v) => scrub(v, depth + 1));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "***" : scrub(v, depth + 1);
    }
    return out;
  }
  return input;
}
