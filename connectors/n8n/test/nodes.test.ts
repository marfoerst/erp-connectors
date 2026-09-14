import { NodeApiError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { scopevisioApiRequest } from '../nodes/Scopevisio/GenericFunctions';
import { EVENTS, MAX_PER_POLL, ScopevisioTrigger } from '../nodes/ScopevisioTrigger/ScopevisioTrigger.node';

const NODE: INode = {
	id: 'n1',
	name: 'Scopevisio',
	type: 'n8n-nodes-scopevisio.scopevisio',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** A fake n8n context whose HTTP helper is a function of the request. */
function context(options: {
	respond: (request: { method: string; url: string; body?: Record<string, unknown> }) => unknown;
	parameters?: Record<string, unknown>;
	mode?: 'manual' | 'trigger';
	staticData?: Record<string, unknown>;
}) {
	const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
	const staticData = options.staticData ?? {};
	const ctx = {
		requests,
		staticData,
		getNode: () => NODE,
		getCredentials: async () => ({ baseUrl: 'https://appload.example/' }),
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in (options.parameters ?? {}) ? options.parameters![name] : fallback,
		getMode: () => options.mode ?? 'trigger',
		getWorkflowStaticData: () => staticData,
		helpers: {
			returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
			httpRequestWithAuthentication: async function (
				_credentialType: string,
				request: { method: string; url: string; body?: Record<string, unknown> },
			) {
				requests.push(request);
				return options.respond(request);
			},
		},
	};
	return ctx;
}

/** What n8n-core throws: a NodeApiError wrapping an axios-style error. */
function coreError(status: number, data: unknown) {
	const axiosLike = Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data },
	});
	return new NodeApiError(NODE, axiosLike as never);
}

describe('scopevisioApiRequest', () => {
	it('builds the REST URL from the credential, trimming a trailing slash', async () => {
		const ctx = context({ respond: () => ({ ok: true }) });
		await scopevisioApiRequest.call(ctx as never, 'GET', '/myaccount', { resource: 'the account' });
		expect(ctx.requests[0].url).toBe('https://appload.example/rest/myaccount');
	});

	it('sends a search body as an object, never as a string', async () => {
		const ctx = context({ respond: () => ({ records: [] }) });
		await scopevisioApiRequest.call(ctx as never, 'POST', '/contacts', {
			body: { search: [{ field: 'email', operator: 'equal', value: 'a@b.de' }] },
			resource: 'contacts',
		});
		expect(typeof ctx.requests[0].body).toBe('object');
	});

	it('keeps the Scopevisio explanation when n8n-core has already wrapped the error', async () => {
		const ctx = context({
			respond: () => {
				throw coreError(400, { message: 'The field "definitelyNotAField" was not found.' });
			},
		});
		const failure = await scopevisioApiRequest
			.call(ctx as never, 'POST', '/contacts', { resource: 'contacts' })
			.catch((e: unknown) => e as NodeApiError);
		expect(failure).toBeInstanceOf(NodeApiError);
		expect(failure.message).toBe('Scopevisio rejected the request for contacts');
		expect(failure.description).toContain('definitelyNotAField');
	});

	it('explains a revoked credential rather than a generic authorisation failure', async () => {
		const ctx = context({
			respond: () => {
				throw coreError(401, 'unauthorized');
			},
		});
		const failure = await scopevisioApiRequest
			.call(ctx as never, 'GET', '/myaccount', { resource: 'the account' })
			.catch((e: unknown) => e as NodeApiError);
		expect(failure.message).toBe('Scopevisio rejected the credentials');
		expect(failure.description).toContain('refresh token');
	});

	it('resolves to undefined on 404 when not-found is allowed', async () => {
		const ctx = context({
			respond: () => {
				throw coreError(404, { message: 'no file' });
			},
		});
		await expect(
			scopevisioApiRequest.call(ctx as never, 'GET', '/outgoinginvoice/X/file', {
				resource: 'a PDF',
				allowNotFound: true,
			}),
		).resolves.toBeUndefined();
	});

	it('still throws on 404 when not-found is not allowed', async () => {
		const ctx = context({
			respond: () => {
				throw coreError(404, { message: 'HTTP 404 Not Found' });
			},
		});
		const failure = await scopevisioApiRequest
			.call(ctx as never, 'GET', '/contact/ID/1', { resource: 'contact 1' })
			.catch((e: unknown) => e as NodeApiError);
		expect(failure.message).toBe('Scopevisio could not find contact 1');
	});
});

describe('ScopevisioTrigger.poll', () => {
	const trigger = new ScopevisioTrigger();
	const records = (ids: number[]) => ({ records: ids.map((id) => ({ id, documentNumber: `RE-${id}` })) });

	it('returns the newest record as sample data in manual mode, without touching the cursor', async () => {
		const ctx = context({
			mode: 'manual',
			parameters: { event: 'newOutgoingInvoice', options: {} },
			respond: () => records([42]),
		});
		const result = await trigger.poll.call(ctx as never);
		expect(result?.[0]).toEqual([{ json: { id: 42, documentNumber: 'RE-42' } }]);
		expect(ctx.requests[0].body).toMatchObject({ order: ['id = desc'], pageSize: 1 });
		expect(ctx.staticData.lastId).toBeUndefined();
	});

	it('records a baseline on the first poll and emits nothing, so activation does not replay history', async () => {
		const ctx = context({ parameters: { event: 'newOutgoingInvoice', options: {} }, respond: () => records([900]) });
		expect(await trigger.poll.call(ctx as never)).toBeNull();
		expect(ctx.staticData.lastId).toBe(900);
	});

	it('uses a zero baseline for an empty collection', async () => {
		const ctx = context({ parameters: { event: 'newContact', options: {} }, respond: () => ({ records: [] }) });
		expect(await trigger.poll.call(ctx as never)).toBeNull();
		expect(ctx.staticData.lastId).toBe(0);
	});

	it('asks only for ids above the cursor, emits them oldest first and advances the cursor', async () => {
		const ctx = context({
			parameters: { event: 'newOutgoingInvoice', options: {} },
			staticData: { lastId: 100 },
			respond: () => records([103, 101]),
		});
		const result = await trigger.poll.call(ctx as never);
		expect(ctx.requests[0].body).toMatchObject({
			search: [{ field: 'id', operator: 'greater', value: '100' }],
			order: ['id = asc'],
			pageSize: MAX_PER_POLL,
		});
		expect(result?.[0].map((item) => (item.json as { id: number }).id)).toEqual([101, 103]);
		expect(ctx.staticData.lastId).toBe(103);
	});

	it('returns null and keeps the cursor when nothing is new', async () => {
		const ctx = context({ parameters: { event: 'newProduct', options: {} }, staticData: { lastId: 5 }, respond: () => ({ records: [] }) });
		expect(await trigger.poll.call(ctx as never)).toBeNull();
		expect(ctx.staticData.lastId).toBe(5);
	});

	it('leaves the cursor untouched when the poll fails, so no record is skipped', async () => {
		const ctx = context({
			parameters: { event: 'newContact', options: {} },
			staticData: { lastId: 77 },
			respond: () => {
				throw coreError(503, 'down');
			},
		});
		await expect(trigger.poll.call(ctx as never)).rejects.toBeInstanceOf(NodeApiError);
		expect(ctx.staticData.lastId).toBe(77);
	});

	it('always requests the id, because it is the cursor', async () => {
		const ctx = context({
			parameters: { event: 'newContact', options: { fields: 'lastname,email' } },
			staticData: { lastId: 1 },
			respond: () => ({ records: [] }),
		});
		await trigger.poll.call(ctx as never);
		expect(ctx.requests[0].body?.fields).toEqual(['id', 'lastname', 'email']);
	});

	it('defines an endpoint for every event it offers', () => {
		const offered = (trigger.description.properties[0].options as Array<{ value: string }>).map((o) => o.value);
		expect(offered.sort()).toEqual(Object.keys(EVENTS).sort());
	});
});
