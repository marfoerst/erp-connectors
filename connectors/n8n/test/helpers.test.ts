import { describe, expect, it } from 'vitest';

import {
	assertPostingConfirmed,
	buildSearchBody,
	collectPages,
	DATASOURCES,
	datasourceLabel,
	describeScopevisioError,
	extractRecords,
	fieldsNotApplied,
	formatScopevisioDate,
	MAX_PAGE_SIZE,
	mergeRevenueAccounts,
	newRecordsSince,
	parseFieldList,
} from '../nodes/Scopevisio/helpers';

describe('parseFieldList', () => {
	it('splits, trims and de-duplicates a comma-separated list', () => {
		expect(parseFieldList(' id, lastname ,id,,email ')).toEqual(['id', 'lastname', 'email']);
	});
	it('accepts an array', () => {
		expect(parseFieldList(['id', ' id ', 'name'])).toEqual(['id', 'name']);
	});
	it('is empty for nothing', () => {
		expect(parseFieldList(undefined)).toEqual([]);
		expect(parseFieldList('')).toEqual([]);
	});
});

describe('buildSearchBody', () => {
	it('returns an OBJECT, never a JSON string — a string body is silently ignored by OpenScope', () => {
		const body = buildSearchBody({ conditions: [{ field: 'email', operator: 'equal', value: 'a@b.de' }] });
		expect(typeof body).toBe('object');
		expect(body.search).toEqual([{ field: 'email', operator: 'equal', value: 'a@b.de' }]);
	});
	it('omits the value for is null / is not null', () => {
		const body = buildSearchBody({ conditions: [{ field: 'email', operator: 'is null', value: 'ignored' }] });
		expect(body.search).toEqual([{ field: 'email', operator: 'is null' }]);
	});
	it('keeps an empty-string value for ordinary operators', () => {
		const body = buildSearchBody({ conditions: [{ field: 'city1', operator: 'equal' }] });
		expect(body.search?.[0].value).toBe('');
	});
	it('drops conditions without a field name', () => {
		const body = buildSearchBody({ conditions: [{ field: '  ', operator: 'equal', value: 'x' }] });
		expect(body.search).toBeUndefined();
	});
	it('rejects an operator OpenScope does not know', () => {
		expect(() =>
			buildSearchBody({ conditions: [{ field: 'id', operator: 'like' as never, value: '1' }] }),
		).toThrow('Unknown search operator');
	});
	it('builds the order clause in OpenScope syntax', () => {
		expect(buildSearchBody({ orderField: 'id', orderDirection: 'desc' }).order).toEqual(['id = desc']);
		expect(buildSearchBody({ orderField: 'lastname' }).order).toEqual(['lastname = asc']);
	});
	it('passes fields through the list parser', () => {
		expect(buildSearchBody({ fields: 'id, name' }).fields).toEqual(['id', 'name']);
	});
	it('is an empty object when nothing is given', () => {
		expect(buildSearchBody({})).toEqual({});
	});
});

describe('extractRecords', () => {
	it('reads { records }', () => {
		expect(extractRecords({ records: [{ id: 1 }] })).toEqual([{ id: 1 }]);
	});
	it('accepts a bare array', () => {
		expect(extractRecords([{ id: 2 }])).toEqual([{ id: 2 }]);
	});
	it('is empty for anything else rather than throwing', () => {
		expect(extractRecords(undefined)).toEqual([]);
		expect(extractRecords({ count: 3 })).toEqual([]);
		expect(extractRecords('text')).toEqual([]);
	});
});

describe('collectPages', () => {
	const makeSource = (total: number) => {
		const calls: Array<[number, number]> = [];
		const fetchPage = async (page: number, pageSize: number) => {
			calls.push([page, pageSize]);
			const start = page * pageSize;
			return Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => start + i);
		};
		return { calls, fetchPage };
	};

	it('stops at the first short page when returning all', async () => {
		const { calls, fetchPage } = makeSource(2500);
		const all = await collectPages(fetchPage, { returnAll: true });
		expect(all).toHaveLength(2500);
		expect(calls).toEqual([
			[0, MAX_PAGE_SIZE],
			[1, MAX_PAGE_SIZE],
			[2, MAX_PAGE_SIZE],
		]);
	});
	it('makes one extra request when the total is an exact multiple of the page size', async () => {
		const { calls, fetchPage } = makeSource(2000);
		const all = await collectPages(fetchPage, { returnAll: true });
		expect(all).toHaveLength(2000);
		expect(calls).toHaveLength(3);
	});
	it('requests only what the limit needs and trims to it', async () => {
		const { calls, fetchPage } = makeSource(500);
		const some = await collectPages(fetchPage, { returnAll: false, limit: 7 });
		expect(some).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(calls).toEqual([[0, 7]]);
	});
	it('caps the page size at 1000 even for a large limit', async () => {
		const { calls, fetchPage } = makeSource(3000);
		const some = await collectPages(fetchPage, { returnAll: false, limit: 1500 });
		expect(some).toHaveLength(1500);
		expect(calls[0][1]).toBe(1000);
	});
	it('handles an empty collection', async () => {
		const { fetchPage } = makeSource(0);
		expect(await collectPages(fetchPage, { returnAll: true })).toEqual([]);
	});
	it('treats a limit below one as one', async () => {
		const { fetchPage } = makeSource(10);
		expect(await collectPages(fetchPage, { returnAll: false, limit: 0 })).toEqual([0]);
	});
});

describe('formatScopevisioDate', () => {
	it('uses the date part of an ISO string as written, without timezone shifting', () => {
		expect(formatScopevisioDate('2026-09-14T00:30:00.000+02:00')).toBe('14.09.2026');
		expect(formatScopevisioDate('2026-01-01')).toBe('01.01.2026');
	});
	it('passes a German date through unchanged', () => {
		expect(formatScopevisioDate('31.12.2026')).toBe('31.12.2026');
	});
	it('formats a Date using its local calendar day', () => {
		expect(formatScopevisioDate(new Date(2026, 1, 3))).toBe('03.02.2026');
	});
	it('rejects something that is not a date', () => {
		expect(() => formatScopevisioDate('next tuesday')).toThrow('is not a date');
		expect(() => formatScopevisioDate(new Date('nope'))).toThrow('Invalid date');
	});
});

describe('mergeRevenueAccounts', () => {
	it('lists product-specific accounts before standard ones', () => {
		const merged = mergeRevenueAccounts([{ accountNumber: '8401' }], [{ accountNumber: '8400' }]);
		expect(merged.map((a) => a.accountNumber)).toEqual(['8401', '8400']);
	});
	it('drops exact duplicates that both endpoints return', () => {
		const a = { accountNumber: '8400', vatKey: '3', countryIso: 'DE', taxCaseId: 1 };
		expect(mergeRevenueAccounts([a], [{ ...a }])).toHaveLength(1);
	});
	it('keeps accounts that differ only by country', () => {
		const a = { accountNumber: '8400', vatKey: '3', countryIso: 'DE' };
		expect(mergeRevenueAccounts([a], [{ ...a, countryIso: 'AT' }])).toHaveLength(2);
	});
});

describe('newRecordsSince', () => {
	it('returns only newer records, oldest first, with the highest id as the cursor', () => {
		const { fresh, nextCursor } = newRecordsSince([{ id: 12 }, { id: 9 }, { id: 11 }], 10);
		expect(fresh.map((r) => r.id)).toEqual([11, 12]);
		expect(nextCursor).toBe(12);
	});
	it('keeps the cursor when nothing is new', () => {
		expect(newRecordsSince([{ id: 3 }], 10)).toEqual({ fresh: [], nextCursor: 10 });
	});
	it('accepts numeric ids that arrive as strings', () => {
		expect(newRecordsSince([{ id: '21' }], 20).nextCursor).toBe(21);
	});
	it('ignores records whose id is not numeric instead of corrupting the cursor', () => {
		const { fresh, nextCursor } = newRecordsSince([{ id: 'abc' }, { id: undefined }, { id: 5 }], 1);
		expect(fresh).toEqual([{ id: 5 }]);
		expect(nextCursor).toBe(5);
	});
});

describe('describeScopevisioError', () => {
	it('explains a missing profile on 403, including the API message', () => {
		const d = describeScopevisioError(403, '{"message":"Missing profile. Require read access for any of: enterprise.MlEngineExport"}', 'invoices');
		expect(d.message).toContain('may not access invoices');
		expect(d.description).toContain('Missing profile');
		expect(d.description).toContain('profile (permission)');
	});
	it('points 401 at the refresh token and two-factor authentication', () => {
		expect(describeScopevisioError(401, undefined, 'x').description).toContain('two-factor');
	});
	it('surfaces the field error OpenScope returns on 404', () => {
		expect(describeScopevisioError(404, { message: "the field 'foo' does not exist" }, 'contacts').description).toBe("the field 'foo' does not exist");
	});
	it('marks 5xx as temporary', () => {
		expect(describeScopevisioError(502, '', 'x').message).toContain('server error');
	});
	it('keeps a plain-text body as the description', () => {
		expect(describeScopevisioError(400, 'data: must be a valid XML document', 'import').description).toBe('data: must be a valid XML document');
	});
	it('does not invent a description when the body is empty', () => {
		expect(describeScopevisioError(418, '', 'x').description).toBeUndefined();
	});
});

describe('assertPostingConfirmed', () => {
	it('refuses unless explicitly confirmed with true', () => {
		expect(() => assertPostingConfirmed(false)).toThrow('irreversible');
		expect(() => assertPostingConfirmed(undefined)).toThrow('irreversible');
		expect(() => assertPostingConfirmed('true')).toThrow('irreversible');
	});
	it('allows an explicit true', () => {
		expect(() => assertPostingConfirmed(true)).not.toThrow();
	});
});

describe('DATASOURCES', () => {
	it('lists all 52 reports from the OpenScope spec, without duplicates', () => {
		expect(DATASOURCES).toHaveLength(52);
		expect(new Set(DATASOURCES).size).toBe(52);
	});
	it('produces readable labels for nested paths', () => {
		expect(datasourceLabel('personalAccount/debtor')).toBe('Personal Account: Debtor');
		expect(datasourceLabel('timeEntryRunEntry')).toBe('Time Entry Run Entry');
	});
});


describe('fieldsNotApplied', () => {
	it('is empty when every requested value came back', () => {
		expect(fieldsNotApplied({ email: 'a@b.de', city1: 'Köln' }, { email: 'a@b.de', city1: 'Köln', id: 1 })).toEqual([]);
	});
	it('reports a field Scopevisio silently ignored — the first-name-on-a-company case', () => {
		expect(fieldsNotApplied({ firstname: 'Paula', email: 'x@y.de' }, { firstname: null, email: 'x@y.de' })).toEqual(['firstname']);
	});
	it('compares numbers and strings by value', () => {
		expect(fieldsNotApplied({ paymentTermId: 3 }, { paymentTermId: '3' })).toEqual([]);
	});
	it('ignores surrounding whitespace', () => {
		expect(fieldsNotApplied({ tags: ' vip ' }, { tags: 'vip' })).toEqual([]);
	});
	it('treats clearing a field to empty as applied when the read-back is null', () => {
		expect(fieldsNotApplied({ phone: '' }, { phone: null })).toEqual([]);
	});
});
