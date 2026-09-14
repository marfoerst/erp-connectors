/**
 * Pure helpers for the Scopevisio nodes.
 *
 * No n8n imports and no I/O, so every rule here is unit-tested directly. Each
 * one encodes something the OpenScope API does that is easy to get wrong:
 *
 *   - `POST /{plural}` endpoints are searches, and the filter must be sent as a
 *     raw JSON object. A JSON-encoded string is accepted with HTTP 200 and the
 *     filter is silently ignored — you get the whole collection back.
 *   - Search responses carry no total. Paging stops when a page comes back
 *     short, and pages are zero-based with a maximum size of 1000.
 *   - Unknown names in `fields` are rejected by some endpoints (contacts: 404)
 *     and silently dropped by others (products).
 */

export const MAX_PAGE_SIZE = 1000;

/** Hard stop for paging, so a misbehaving endpoint cannot loop forever. */
export const MAX_PAGES = 10_000;

export const SEARCH_OPERATORS = [
	'equal',
	'notequal',
	'startswith',
	'endswith',
	'contains',
	'icontains',
	'less',
	'greater',
	'lessorequal',
	'greaterorequal',
	'is null',
	'is not null',
] as const;

export type SearchOperator = (typeof SEARCH_OPERATORS)[number];

export interface SearchCondition {
	field: string;
	operator: SearchOperator;
	value?: string;
}

export interface SearchBody {
	search?: Array<{ field: string; operator: SearchOperator; value?: string }>;
	fields?: string[];
	order?: string[];
	page?: number;
	pageSize?: number;
	count?: boolean;
}

const VALUELESS_OPERATORS: ReadonlySet<string> = new Set(['is null', 'is not null']);

/** Split a comma-separated field list, trimming and de-duplicating. */
export function parseFieldList(input: string | string[] | undefined | null): string[] {
	const parts = Array.isArray(input) ? input : String(input ?? '').split(',');
	const seen = new Set<string>();
	for (const part of parts) {
		const name = String(part).trim();
		if (name) seen.add(name);
	}
	return [...seen];
}

/**
 * Build the body for a `POST /{plural}` search.
 *
 * Returned as an object on purpose. The caller must send it as JSON — never
 * `JSON.stringify` it into a string body, which OpenScope silently ignores.
 */
export function buildSearchBody(options: {
	conditions?: SearchCondition[];
	fields?: string | string[];
	orderField?: string;
	orderDirection?: 'asc' | 'desc';
}): SearchBody {
	const body: SearchBody = {};

	const search = (options.conditions ?? [])
		.filter((c) => c && String(c.field ?? '').trim())
		.map((c) => {
			if (!(SEARCH_OPERATORS as readonly string[]).includes(c.operator)) {
				throw new Error(`Unknown search operator "${c.operator}".`);
			}
			const criterion: { field: string; operator: SearchOperator; value?: string } = {
				field: c.field.trim(),
				operator: c.operator,
			};
			if (!VALUELESS_OPERATORS.has(c.operator)) criterion.value = String(c.value ?? '');
			return criterion;
		});
	if (search.length) body.search = search;

	const fields = parseFieldList(options.fields);
	if (fields.length) body.fields = fields;

	const orderField = String(options.orderField ?? '').trim();
	if (orderField) body.order = [`${orderField} = ${options.orderDirection === 'desc' ? 'desc' : 'asc'}`];

	return body;
}

/** Normalise the shapes OpenScope uses for lists: `{ records }`, a bare array, or nothing. */
export function extractRecords<T = Record<string, unknown>>(response: unknown): T[] {
	if (Array.isArray(response)) return response as T[];
	if (response && typeof response === 'object') {
		const records = (response as { records?: unknown }).records;
		if (Array.isArray(records)) return records as T[];
	}
	return [];
}

/**
 * Page through a search until a short page, or until `limit` is reached.
 *
 * `fetchPage` receives a zero-based page index and the page size to request.
 */
export async function collectPages<T>(
	fetchPage: (page: number, pageSize: number) => Promise<T[]>,
	options: { returnAll: boolean; limit?: number; pageSize?: number },
): Promise<T[]> {
	const limit = Math.max(1, Math.floor(options.limit ?? 50));
	const requested = options.pageSize ?? (options.returnAll ? MAX_PAGE_SIZE : limit);
	const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));

	const results: T[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const batch = await fetchPage(page, pageSize);
		results.push(...batch);
		if (!options.returnAll && results.length >= limit) break;
		if (batch.length < pageSize) break;
	}
	return options.returnAll ? results : results.slice(0, limit);
}

/**
 * Scopevisio date parameters are `dd.MM.yyyy`.
 *
 * An ISO string's date part is used as written rather than parsed into a Date,
 * because parsing shifts the day across midnight in any timezone east of UTC.
 */
export function formatScopevisioDate(input: string | Date): string {
	if (input instanceof Date) {
		if (Number.isNaN(input.getTime())) throw new Error('Invalid date.');
		const dd = String(input.getDate()).padStart(2, '0');
		const mm = String(input.getMonth() + 1).padStart(2, '0');
		return `${dd}.${mm}.${input.getFullYear()}`;
	}
	const value = String(input ?? '').trim();
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
	if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return value;
	throw new Error(`"${value}" is not a date. Use YYYY-MM-DD or DD.MM.YYYY.`);
}

/**
 * Merge the two revenue-account sources.
 *
 * `/revenueaccounts/products` returns only accounts configured for a specific
 * product and excludes products using the standard accounts;
 * `/revenueaccounts/standard` returns the rest. Querying products alone missed
 * most of a real tenant's accounts. Product-specific accounts come first so
 * they win, and exact duplicates are dropped.
 */
export function mergeRevenueAccounts<T extends Record<string, unknown>>(
	productAccounts: T[],
	standardAccounts: T[],
): T[] {
	const seen = new Set<string>();
	const merged: T[] = [];
	for (const account of [...productAccounts, ...standardAccounts]) {
		const key = [
			account.accountNumber,
			account.vatKey,
			account.taxKey,
			account.countryIso,
			account.taxCaseId,
			account.productId,
		].join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(account);
	}
	return merged;
}

/**
 * Pick records newer than the stored cursor, oldest first, and the next cursor.
 *
 * OpenScope has no webhooks, so triggers poll by ascending numeric id. Records
 * with a non-numeric id are ignored rather than allowed to corrupt the cursor.
 */
export function newRecordsSince<T extends { id?: unknown }>(
	records: T[],
	lastId: number,
): { fresh: T[]; nextCursor: number } {
	const fresh = records
		.filter((r) => Number.isFinite(Number(r.id)) && Number(r.id) > lastId)
		.sort((a, b) => Number(a.id) - Number(b.id));
	const nextCursor = fresh.reduce((max, r) => Math.max(max, Number(r.id)), lastId);
	return { fresh, nextCursor };
}

export interface ScopevisioErrorDetail {
	message: string;
	description?: string;
}

/** Turn an OpenScope error response into something a workflow author can act on. */
export function describeScopevisioError(
	status: number | undefined,
	body: unknown,
	resource: string,
): ScopevisioErrorDetail {
	const apiMessage = extractApiMessage(body);

	switch (status) {
		case 400:
			return {
				message: `Scopevisio rejected the request for ${resource}`,
				description: apiMessage ?? 'Check the field names and values you passed.',
			};
		case 401:
			return {
				message: 'Scopevisio rejected the credentials',
				description:
					'The refresh token may have been revoked, or the password changed. Users with two-factor authentication must use a refresh token.',
			};
		case 403:
			return {
				message: `The Scopevisio user may not access ${resource}`,
				description:
					(apiMessage ? `${apiMessage}. ` : '') +
					'Give the user the required Scopevisio profile (permission) for this operation.',
			};
		case 404:
			return {
				message: `Scopevisio could not find ${resource}`,
				description: apiMessage ?? 'Check the ID or number you passed.',
			};
		case 429:
			return {
				message: 'Scopevisio is rate limiting requests',
				description: 'Wait and retry, or reduce how often the workflow runs.',
			};
		default:
			if (status !== undefined && status >= 500) {
				return {
					message: 'Scopevisio had a server error',
					description: apiMessage ?? 'This is usually temporary. Retry later.',
				};
			}
			return {
				message: `The Scopevisio request for ${resource} failed`,
				description: apiMessage,
			};
	}
}

function extractApiMessage(body: unknown): string | undefined {
	let parsed = body;
	if (typeof body === 'string') {
		try {
			parsed = JSON.parse(body);
		} catch {
			return body.trim() ? body.trim().slice(0, 500) : undefined;
		}
	}
	if (parsed && typeof parsed === 'object') {
		const message = (parsed as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message.trim();
	}
	return undefined;
}

/**
 * Posting commits a document to the ledger and cannot be undone — under GoBD a
 * posted document can only be corrected with a credit note. The operation
 * therefore refuses to run unless the workflow author confirmed it explicitly.
 */
export function assertPostingConfirmed(confirmed: unknown): void {
	if (confirmed !== true) {
		throw new Error(
			'Posting is irreversible. Turn on "Confirm Irreversible Posting" to post this invoice.',
		);
	}
}

/** Every `/datasource/*` report OpenScope exposes, verified against the published spec. */
export const DATASOURCES = [
	'auditLog',
	'blog',
	'budgetGroup',
	'contact',
	'contactProperties',
	'conversion',
	'creditNote',
	'dispatch',
	'event',
	'expense',
	'humanResource',
	'humanResourceAvailability',
	'incomingInvoice',
	'journal',
	'offer',
	'opportunity',
	'order',
	'outgoingInvoice',
	'personalAccount/creditor',
	'personalAccount/debtor',
	'personalJournal',
	'plan',
	'positions/creditNote',
	'positions/dispatch',
	'positions/incomingInvoice',
	'positions/offer',
	'positions/opportunity',
	'positions/order',
	'positions/outgoingInvoice',
	'proReport',
	'product',
	'productUsage/creditNote',
	'productUsage/dispatch',
	'productUsage/offer',
	'productUsage/opportunity',
	'productUsage/order',
	'productUsage/outgoingInvoice',
	'project',
	'projectResource',
	'projectRevenue',
	'salesProject',
	'statisticsJournal',
	'susa/creditors',
	'susa/debtors',
	'susa/impersonalAccounts',
	'task',
	'teamwork',
	'timeEntry',
	'timeEntryRun',
	'timeEntryRunEntry',
	'travelEntry',
	'travelEntryPositions',
] as const;

/** A readable label for a datasource path, e.g. `personalAccount/debtor` → `Personal Account: Debtor`. */
export function datasourceLabel(path: string): string {
	const words = (part: string) =>
		part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
	return path.split('/').map(words).join(': ');
}

/**
 * Fields an update asked for that Scopevisio did not apply.
 *
 * `POST /contact/{id}` is a partial merge that answers HTTP 200 with
 * `errors: {}` even when it ignores a field — a first name on a company
 * contact, for example. Comparing a read-back against the request is the only
 * way to know. Values are compared as trimmed strings, with null and undefined
 * treated as empty.
 */
export function fieldsNotApplied(
	requested: Record<string, unknown>,
	actual: Record<string, unknown>,
): string[] {
	const normalise = (value: unknown) =>
		value === null || value === undefined ? '' : String(value).trim();
	return Object.keys(requested).filter((key) => normalise(requested[key]) !== normalise(actual[key]));
}
