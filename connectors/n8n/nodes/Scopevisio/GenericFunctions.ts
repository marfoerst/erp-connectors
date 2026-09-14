import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { collectPages, describeScopevisioError, extractRecords, type SearchBody } from './helpers';

type ScopevisioContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export const CREDENTIAL_NAME = 'scopevisioApi';

async function restBaseUrl(this: ScopevisioContext): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const base = String(credentials.baseUrl || 'https://appload.scopevisio.com').replace(/\/+$/, '');
	return `${base}/rest`;
}

/** Pull an HTTP status and body out of whatever n8n's request helper threw. */
export function statusAndBody(error: unknown): { status?: number; body?: unknown } {
	const e = (error ?? {}) as {
		httpCode?: string | number;
		statusCode?: number;
		status?: number;
		response?: { status?: number; statusCode?: number; data?: unknown; body?: unknown };
		cause?: { response?: { status?: number; data?: unknown } };
		description?: unknown;
		message?: unknown;
	};
	const rawStatus =
		e.response?.status ??
		e.response?.statusCode ??
		e.cause?.response?.status ??
		e.statusCode ??
		e.status ??
		e.httpCode;
	const status = Number(rawStatus);
	const body = e.response?.data ?? e.response?.body ?? e.cause?.response?.data ?? e.description ?? e.message;
	return { status: Number.isFinite(status) && status > 0 ? status : undefined, body };
}

export interface ScopevisioRequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	/** Plain-language name of what is being requested, used in error messages. */
	resource: string;
	itemIndex?: number;
	/** Return the raw bytes and headers instead of parsed JSON (file downloads). */
	binary?: boolean;
	/** Resolve to `undefined` on HTTP 404 instead of throwing. */
	allowNotFound?: boolean;
}

/** One authenticated call to the OpenScope REST API. */
export async function scopevisioApiRequest(
	this: ScopevisioContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: ScopevisioRequestOptions,
): Promise<unknown> {
	const request: IHttpRequestOptions = {
		method,
		url: `${await restBaseUrl.call(this)}${endpoint}`,
		headers: { accept: options.binary ? '*/*' : 'application/json' },
		json: !options.binary,
	};
	// Sent as an object, never as a JSON string: OpenScope silently ignores a
	// search filter that arrives as a string.
	if (options.body !== undefined) request.body = options.body;
	if (options.qs !== undefined) request.qs = options.qs;
	if (options.binary) {
		request.encoding = 'arraybuffer';
		request.returnFullResponse = true;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, request);
	} catch (error) {
		const { status, body } = statusAndBody(error);
		if (options.allowNotFound && status === 404) return undefined;
		const detail = describeScopevisioError(status, body, options.resource);

		// n8n's request helper already throws a NodeApiError, and wrapping one in
		// another hands back the original with the new message and description
		// discarded. So the Scopevisio-specific explanation is written onto the
		// existing error; otherwise users see only "Bad request - please check
		// your parameters".
		if (error instanceof NodeApiError) {
			error.message = detail.message;
			error.description = detail.description ?? error.description;
			if (status && !error.httpCode) error.httpCode = String(status);
		}
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: detail.message,
			description: detail.description,
			httpCode: status ? String(status) : undefined,
			itemIndex: options.itemIndex,
		});
	}
}

/** Page through a `POST /{plural}` search. */
export async function scopevisioSearch(
	this: ScopevisioContext,
	endpoint: string,
	body: SearchBody,
	options: { returnAll: boolean; limit?: number; resource: string; itemIndex?: number },
): Promise<IDataObject[]> {
	return collectPages<IDataObject>(
		async (page, pageSize) => {
			const response = await scopevisioApiRequest.call(this, 'POST', endpoint, {
				body: { ...body, page, pageSize } as IDataObject,
				resource: options.resource,
				itemIndex: options.itemIndex,
			});
			return extractRecords<IDataObject>(response);
		},
		{ returnAll: options.returnAll, limit: options.limit },
	);
}
