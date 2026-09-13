/**
 * The two things a connector must supply that core deliberately does not own:
 * somewhere to keep the tenant's Scopevisio connection, and somewhere to write
 * the journal.
 *
 * Core has no database on purpose. Each connector has its own schema — a
 * Shopify shop is keyed by myshopify domain, a Shopware shop by its shop id —
 * and core should not care which.
 */

/** The connection state core needs to authenticate and to refresh tokens. */
export interface ConnectionRecord {
  baseUrl: string;
  customer: string;
  /** May be empty; the token endpoint resolves and returns it. */
  organisation: string;
  username: string;
  /** Encrypted. Dropped once a refresh token exists. */
  passwordEnc: string | null;
  /** Encrypted. */
  refreshTokenEnc: string | null;
  /** Encrypted. */
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
}

/**
 * Load and persist one tenant's connection.
 *
 * `save` receives only the fields that changed, so an implementation can map
 * them straight onto an UPDATE. It is called on every token refresh, so it must
 * be cheap and must not throw for a tenant that has since been deleted —
 * return quietly instead.
 */
export interface ConnectionStore {
  load(): Promise<ConnectionRecord | null>;
  save(patch: Partial<ConnectionRecord>): Promise<void>;
}

export type JournalLevel = "info" | "warn" | "error";

export interface JournalEntry {
  level?: JournalLevel;
  /** Machine-readable event name, e.g. `contact.created`. */
  event: string;
  message: string;
  /** Identifier of the source document in the connector's own system. */
  externalId?: string | null;
  data?: unknown;
}

/**
 * Append-only record of what the connector did.
 *
 * Implementations MUST redact credentials — not only by key name but inside
 * string values, because tokens have turned up embedded in URLs and in error
 * bodies. See the Shopify connector's `log.server.ts` for a tested example.
 */
export interface Journal {
  event(entry: JournalEntry): Promise<void>;
}

/** A no-op journal, for tests and for read-only calls. */
export const silentJournal: Journal = {
  async event() {
    /* intentionally nothing */
  },
};
