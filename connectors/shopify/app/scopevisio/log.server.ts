import prisma from "../db.server";

/**
 * Append-only sync journal. This is what makes PRD C-009 possible: a bookkeeper
 * can answer "what happened to order #1234" without leaving Shopify. Rows are
 * never updated or deleted by the connector.
 */

export interface LogInput {
  level?: "info" | "warn" | "error";
  event: string;
  message: string;
  orderGid?: string | null;
  data?: unknown;
}

export async function logEvent(shop: string, input: LogInput) {
  return prisma.syncEvent.create({
    data: {
      shop,
      level: input.level ?? "info",
      event: input.event,
      message: input.message,
      orderGid: input.orderGid ?? null,
      data: input.data === undefined ? null : safeStringify(input.data),
    },
  });
}

export async function recentEvents(shop: string, limit = 100) {
  return prisma.syncEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function eventsForOrder(shop: string, orderGid: string) {
  return prisma.syncEvent.findMany({
    where: { shop, orderGid },
    orderBy: { createdAt: "asc" },
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, makeReplacer(), 2);
  } catch {
    // Last resort: never let a logging failure take a sync down, and never
    // fall back to something that could print an unredacted value.
    return "[unserialisable]";
  }
}

/** Keys whose value is a credential outright. */
const SECRET_KEYS = /password|token|secret|authorization|credential|apikey|api_key/i;

/**
 * Credentials also appear *inside* string values — a URL carrying
 * `?access_token=…`, or an `Authorization: Bearer …` echoed back in an error
 * body. Key-based redaction alone misses those, so values are scrubbed too.
 */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // Query-string secrets: keep the parameter name, drop the value.
  [/([?&](?:access_token|refresh_token|token|password|secret|api_?key)=)[^&\s"'&]+/gi,
   "$1[redacted]"],
  // Bearer / Basic credentials anywhere in a string.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
];

export function scrubValue(input: string): string {
  let out = input;
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * A fresh replacer per call: it carries a seen-set so a circular reference
 * becomes "[circular]" rather than throwing away the whole entry.
 */
function makeReplacer() {
  const seen = new WeakSet<object>();
  return function replacer(this: unknown, key: string, value: unknown) {
    if (SECRET_KEYS.test(key)) return "[redacted]";
    if (typeof value === "string") return scrubValue(value);
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  };
}
