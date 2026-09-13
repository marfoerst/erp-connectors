import type { ScopevisioClient } from "./client";
import type { Journal } from "./ports";

/**
 * What every core operation needs: a way to talk to Scopevisio, and a place to
 * record what it did.
 *
 * Passed explicitly rather than resolved from a tenant id, because core has no
 * database and no opinion about how a connector identifies its tenants.
 */
export interface ScopevisioContext {
  client: ScopevisioClient;
  journal: Journal;
}
