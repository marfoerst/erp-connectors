import type { ScopevisioClient} from "./client";
import { ScopevisioError } from "./client";
import type { ScopevisioContext } from "./context";
import type {
  AddressLike,
  ContactNewResponse,
  KontaktForm,
  OrderLike,
  PersonalAccountForm,
  PersonalAccountResponse,
} from "./types";

/**
 * Customer upsert — one-way, Shopify → Scopevisio, create-if-missing.
 *
 * Identity is the Shopify customer GID stored in the contact's `legacyNumber`
 * ("ID Vorsystem"), because `GET /contact/LEGACYNUMBER/{id}` is an exact O(1)
 * lookup that returns 404 when the value is not unique — so ambiguity surfaces
 * instead of silently resolving. Email is only a merge heuristic for contacts
 * that predate the integration.
 *
 * A wrong match is far worse than a duplicate: it posts one customer's invoice
 * onto another's Debitorenkonto, which GoBD makes unfixable. So anything
 * ambiguous creates a new contact and is flagged for a human.
 */

export interface UpsertResult {
  contactId: number;
  personalAccount?: string;
  created: boolean;
  /** Set when a possible duplicate was seen and deliberately not merged. */
  reviewNote?: string;
}

export interface CustomerSettings {
  customerGroup: string;
  guestCustomerGroup: string;
  numberRangeNumber: number | null;
  guestUseCpd: boolean;
}

const REVIEW_TAG = "shopify-review";

export async function upsertCustomer(
  ctx: ScopevisioContext,
  order: OrderLike,
  settings: CustomerSettings,
): Promise<UpsertResult> {
  const client = ctx.client;
  const isGuest = !order.customer?.id;

  /**
   * Identity key stored in the contact's `legacyNumber`.
   *
   * For an account holder that is the Shopify customer GID. A guest has no
   * customer record, but there is exactly one guest "customer" per order — so
   * the ORDER GID serves as the stable key. Without this, every retry of a
   * guest order created another contact (observed live: two identical guest
   * contacts from two runs).
   */
  const gid = order.customer?.id ?? `guest:${order.id}`;

  // 1. Exact lookup by the identity key. Applies to guests too, so replaying
  //    the same order reuses the same contact.
  const existing = await findByLegacyNumber(client, gid);
  if (existing) {
    const personalAccount = await ensureDebitor(
      ctx, client, existing, order, settings, isGuest,
    );
    return { contactId: existing, personalAccount, created: false };
  }

  // 2. Email heuristic — only to avoid duplicating a pre-existing contact.
  const email = order.customer?.email ?? order.email ?? null;
  let reviewNote: string | undefined;

  if (email) {
    const candidates = await findByEmail(client, email);

    if (candidates.length === 1 && !isGuest) {
      const candidate = candidates[0];
      if (matchesName(candidate, order)) {
        // Confident enough to adopt: stamp our GID on it so we never search again.
        await stampLegacyNumber(client, candidate.id, gid);
        const personalAccount = await ensureDebitor(ctx, client, candidate.id, order, settings, isGuest);
        await ctx.journal.event({
          event: "contact.linked",
          externalId: order.id,
          message: `Linked to existing Scopevisio contact ${candidate.id} by e-mail.`,
        });
        return { contactId: candidate.id, personalAccount, created: false, reviewNote };
      }
      reviewNote =
        `A Scopevisio contact (${candidate.id}) already uses ${email} but the name differs. ` +
        `A new contact was created instead of reusing it — merge them in Scopevisio if they are the same person.`;
    } else if (candidates.length > 1) {
      reviewNote =
        `${candidates.length} Scopevisio contacts already use ${email}. ` +
        `A new contact was created rather than guessing which one is right.`;
    }
  }

  // 3. Create.
  const contactId = await createContact(client, order, gid, isGuest, Boolean(reviewNote));
  const personalAccount = await ensureDebitor(ctx, client, contactId, order, settings, isGuest);

  await ctx.journal.event({
    level: reviewNote ? "warn" : "info",
    event: "contact.created",
    externalId: order.id,
    message: reviewNote
      ? `Created Scopevisio contact ${contactId}; possible duplicate flagged for review.`
      : `Created Scopevisio contact ${contactId}.`,
    data: { contactId, personalAccount, isGuest, reviewNote },
  });

  return { contactId, personalAccount, created: true, reviewNote };
}

async function findByLegacyNumber(
  client: ScopevisioClient,
  gid: string,
): Promise<number | null> {
  try {
    const res = await client.get<{ id?: number; masterId?: number }>(
      `/contact/LEGACYNUMBER/${encodeURIComponent(gid)}`,
      { fields: "id,lastname" },
    );
    return res?.id ?? res?.masterId ?? null;
  } catch (err) {
    // 404 means either "not found" or "not unique". Both mean: do not adopt.
    if (err instanceof ScopevisioError && err.status === 404) return null;
    throw err;
  }
}

interface EmailCandidate {
  id: number;
  lastname?: string;
  firstname?: string;
  email?: string;
}

async function findByEmail(
  client: ScopevisioClient,
  email: string,
): Promise<EmailCandidate[]> {
  const res = await client.search<{ records?: EmailCandidate[] }>("/contacts", {
    search: [{ field: "email", value: email, operator: "equal" }],
    fields: ["id", "lastname", "firstname", "email"],
    // Two is enough to detect ambiguity without paging.
    pageSize: 2,
    formatValues: false,
  });
  return res?.records ?? [];
}

function matchesName(candidate: EmailCandidate, order: OrderLike): boolean {
  const expected = (
    order.customer?.lastName ||
    order.billingAddress?.lastName ||
    order.shippingAddress?.lastName ||
    ""
  )
    .trim()
    .toLowerCase();
  if (!expected) return false;
  return (candidate.lastname ?? "").trim().toLowerCase() === expected;
}

async function stampLegacyNumber(
  client: ScopevisioClient,
  contactId: number,
  gid: string,
) {
  await client.post(`/contact/${contactId}`, { legacyNumber: gid });
}

async function createContact(
  client: ScopevisioClient,
  order: OrderLike,
  gid: string,
  isGuest: boolean,
  needsReview: boolean,
): Promise<number> {
  const addr = order.billingAddress ?? order.shippingAddress ?? null;

  // A company name means a Gesellschaft. `person` is evaluated only at
  // creation and can never be changed, so this decision is permanent.
  const company = addr?.company?.trim() || null;
  const isPerson = !company;

  const lastname =
    company ||
    order.customer?.lastName ||
    addr?.lastName ||
    order.customer?.email ||
    order.email ||
    "Unbekannt";

  const tags = [isGuest ? "shopify-guest" : "shopify", needsReview ? REVIEW_TAG : null]
    .filter(Boolean)
    .join(",");

  const form: KontaktForm = {
    person: isPerson,
    lastname: String(lastname).slice(0, 100),
    firstname: isPerson
      ? (order.customer?.firstName ?? addr?.firstName ?? undefined) || undefined
      : undefined,
    email: order.customer?.email ?? order.email ?? undefined,
    phone: addr?.phone ?? order.customer?.phone ?? undefined,
    ...addressFields(addr),
    legacyNumber: gid,
    tags,
    vatId: order.vatId ?? undefined,
    currency: order.currencyCode,
    description: `Created by the Shopify connector from order ${order.name ?? order.id}.`,
  };

  const res = await client.post<ContactNewResponse>("/contact/new", form);
  const id = res?.id ?? res?.contactId ?? res?.masterId;
  if (!id) {
    throw new ScopevisioError(
      "Scopevisio accepted the contact but returned no id.",
      undefined,
      JSON.stringify(res),
    );
  }
  return id;
}

function addressFields(addr: AddressLike | null) {
  if (!addr) return {};
  return {
    street1: addr.address1 ?? undefined,
    addressExtra1: addr.address2 ?? undefined,
    postcode1: addr.zip ?? undefined,
    city1: addr.city ?? undefined,
    country1: addr.countryCodeV2 ?? undefined,
  };
}

/**
 * `POST /createdebitor` is documented as a no-op when the contact already is a
 * debitor, which is what makes this two-call sequence safe to retry.
 */
async function ensureDebitor(
  ctx: ScopevisioContext,
  client: ScopevisioClient,
  contactId: number,
  order: OrderLike,
  settings: CustomerSettings,
  isGuest: boolean,
): Promise<string | undefined> {
  const form: PersonalAccountForm = {
    contactId,
    group: isGuest ? settings.guestCustomerGroup : settings.customerGroup,
    numberRangeNumber: settings.numberRangeNumber ?? undefined,
    contoProDiverse: isGuest ? settings.guestUseCpd : undefined,
    email: order.customer?.email ?? order.email ?? undefined,
    vatId: order.vatId ?? undefined,
    currency: order.currencyCode,
  };

  try {
    const res = await client.post<PersonalAccountResponse>("/createdebitor", form);
    return res?.personalAccountNumber ?? res?.accountNumber ?? res?.number ?? undefined;
  } catch (err) {
    if (err instanceof ScopevisioError && err.merchantActionable) {
      throw new ScopevisioError(
        `Scopevisio refused to create the debitor account for contact ${contactId}. ` +
          `The connector user needs the "Datenimport (Bearbeiten)" and ` +
          `"Kontakte bearbeiten (Bearbeiten)" profiles. Original message: ${err.message}`,
        err.status,
        err.body,
        true,
      );
    }
    throw err;
  }
}
