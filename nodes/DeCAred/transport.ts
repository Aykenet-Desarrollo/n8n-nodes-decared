import { createHmac, timingSafeEqual } from 'crypto';
import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type IWebhookFunctions,
	type JsonObject,
} from 'n8n-workflow';

type Context = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

export const DEFAULT_BASE_URL = 'https://decared.com/api/v1';

export async function baseUrl(this: Context): Promise<string> {
	const credentials = await this.getCredentials('deCAredApi');
	return String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

/** What DeCAred says when it refuses a request: Spanish «message», stable «code» and «request_id» for support. */
export interface ApiErrorDetails {
	httpCode: string;
	code: string | null;
	requestId: string | null;
}

/**
 * One authenticated call to the DeCAred API; the API answers JSON except for PDFs. A refusal becomes a NodeApiError
 * whose message is DeCAred's own text and whose context carries «code» (for example external_reference_conflict
 * or insufficient_scope) and «request_id».
 */
export async function apiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: { qs?: IDataObject; body?: IDataObject; binary?: boolean } = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	const request: IHttpRequestOptions = {
		method,
		url: `${await baseUrl.call(this)}${path}`,
		qs: options.qs,
		body: options.body,
		json: !options.binary,
		headers: { Accept: options.binary ? 'application/pdf' : 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.binary) {
		request.encoding = 'arraybuffer';
	}
	const response = await this.helpers.httpRequestWithAuthentication.call(
		this,
		'deCAredApi',
		request,
	);
	const status = Number(response.statusCode);
	if (status < 400) {
		return options.binary ? response : response.body;
	}

	let body: IDataObject = {};
	try {
		body =
			options.binary || typeof response.body === 'string'
				? JSON.parse(Buffer.from(response.body as ArrayBuffer).toString('utf8'))
				: ((response.body as IDataObject) ?? {});
	} catch {
		body = {};
	}
	const details: ApiErrorDetails = {
		httpCode: String(status),
		code: (body.code as string) ?? null,
		requestId:
			(body.request_id as string) ?? (response.headers?.['x-request-id'] as string) ?? null,
	};
	const fieldErrors = Object.values((body.errors as Record<string, string[]>) ?? {}).flat();
	const error = new NodeApiError(this.getNode(), body as JsonObject, {
		message: String(body.message ?? `DeCAred answered ${status}`),
		description:
			[
				...fieldErrors.slice(1),
				details.code,
				details.requestId && `request_id ${details.requestId}`,
			]
				.filter(Boolean)
				.join(' · ') || undefined,
		httpCode: details.httpCode,
	});
	error.context.decared = details as unknown as IDataObject;
	throw error;
}

/** DeCAred details of an error thrown by apiRequest, or null for any other error. */
export function apiErrorDetails(error: unknown): ApiErrorDetails | null {
	const context = (error as { context?: IDataObject } | null)?.context;
	return (context?.decared as unknown as ApiErrorDetails) ?? null;
}

/** Follows the «meta.last_page» pagination of the list endpoints up to «limit» items (0 = all). */
export async function apiRequestAll(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	limit: number,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let page = 1;
	for (;;) {
		const perPage = limit ? Math.min(100, limit - items.length) : 100;
		const response = await apiRequest.call(this, 'GET', path, {
			qs: { ...qs, page, per_page: perPage },
		});
		items.push(...((response.data as IDataObject[]) ?? []));
		const meta = (response.meta as IDataObject) ?? {};
		if ((limit && items.length >= limit) || page >= Number(meta.last_page ?? 1)) {
			return limit ? items.slice(0, limit) : items;
		}
		page++;
	}
}

/** Drops empty optional values so the API applies its own defaults. */
export function clean(object: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(object).filter(
			([, value]) => value !== undefined && value !== null && value !== '',
		),
	);
}

/**
 * DeCAred-Signature: «t=<unix>,v1=<hex>», HMAC-SHA256 of "<t>.<raw body>" with the subscription secret.
 * Signatures older than five minutes are rejected.
 */
export function validSignature(
	header: string | undefined,
	rawBody: string,
	secret: string,
): boolean {
	const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
	if (!match || !secret || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) {
		return false;
	}
	const expected = createHmac('sha256', secret).update(`${match[1]}.${rawBody}`).digest('hex');
	return timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]));
}
