/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- Confirmation requires a reviewed proposal, not an AI tool call. */
import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type JsonObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import {
	counterpartyFields,
	documentFields,
	draftFields,
	driverFields,
	vehicleFields,
} from './descriptions';
import { apiErrorDetails, apiRequest, apiRequestAll, clean } from './transport';

import {
	workflowFields,
	workflow,
	tracking,
	objectParameter,
	downloadAttachment,
} from './operations';

const MASTER_PATHS: Record<string, string> = {
	counterparty: '/counterparties',
	vehicle: '/vehicles',
	driver: '/drivers',
};

export class DeCAred implements INodeType {
	// Confirmation needs a reviewed proposal; do not expose the whole node as an AI tool.

	description: INodeTypeDescription = {
		displayName: 'DeCAred',
		name: 'deCAred',
		icon: { light: 'file:../../icons/decared.svg', dark: 'file:../../icons/decared.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Create DeCA drafts, keep master data in sync and fetch issued transport documents and their PDFs',
		defaults: { name: 'DeCAred' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'deCAredApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Counterparty', value: 'counterparty' },
					{ name: 'Document', value: 'document' },
					{ name: 'Draft', value: 'draft' },
					{ name: 'Driver', value: 'driver' },
					{ name: 'Tracking', value: 'tracking' },
					{ name: 'Vehicle', value: 'vehicle' },
					{ name: 'Workflow', value: 'workflow' },
				],
				default: 'document',
			},
			...documentFields,
			...draftFields,
			...counterpartyFields,
			...vehicleFields,
			...driverFields,
			...workflowFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'attachment') {
					results.push(await downloadAttachment.call(this, i));
					continue;
				}

				if (resource === 'document' && operation === 'downloadPdf') {
					results.push(await downloadPdf.call(this, i));
					continue;
				}

				let data: IDataObject | IDataObject[];
				if (resource === 'workflow') {
					data = await workflow.call(this, operation, i);
				} else if (resource === 'tracking') {
					data = await tracking.call(this, operation, i);
				} else if (resource === 'document') {
					data = await documents.call(this, operation, i);
				} else if (resource === 'draft') {
					data = await drafts.call(this, operation, i);
				} else {
					data = await masters.call(this, resource, operation, i);
				}
				results.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(data), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				const details = apiErrorDetails(error);
				// Same order sent again with different data: show the record it already created, for review.
				const existing =
					details?.code === 'external_reference_conflict'
						? await existingForReference.call(this, i)
						: null;
				if (this.continueOnFail()) {
					results.push({
						json: {
							error: (error as Error).message,
							error_code: details?.code ?? null,
							http_code: details?.httpCode ?? null,
							request_id: details?.requestId ?? null,
							retry_after: details?.retryAfter ?? null,
							...(existing ? { existing } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				if (!details) {
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				}
				const apiError = error as NodeApiError;
				const found = existing
					? `Existing ${existing.status === 'draft' ? 'draft' : 'document'}: ${existing.reference}${existing.edit_url ? ` (${existing.edit_url})` : ''}`
					: undefined;
				const wrapped = new NodeApiError(this.getNode(), {} as JsonObject, {
					itemIndex: i,
					message: apiError.message,
					description: [found, apiError.description].filter(Boolean).join(' · ') || undefined,
					httpCode: details.httpCode,
				});
				wrapped.context.decared = details as unknown as IDataObject;
				throw wrapped;
			}
		}

		return [results];
	}
}

async function documents(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'get') {
		const id = this.getNodeParameter('documentId', i) as number;
		return (await apiRequest.call(this, 'GET', `/documents/${id}`)).data;
	}
	const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const limit = returnAll ? 0 : (this.getNodeParameter('limit', i, 50) as number);
	return apiRequestAll.call(this, '/documents', filters, limit);
}

async function downloadPdf(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
	const id = this.getNodeParameter('documentId', i) as number;
	let version = this.getNodeParameter('version', i, 0) as number;
	const property = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
	const document = (await apiRequest.call(this, 'GET', `/documents/${id}`)).data as IDataObject;
	if (!version) {
		version = Number((document.current_version as IDataObject | null)?.number ?? 0);
	}
	if (!version) {
		throw new NodeOperationError(this.getNode(), 'This document has no issued version yet', {
			itemIndex: i,
		});
	}
	const numbers = ((document.versions as IDataObject[] | undefined) ?? []).map((v) =>
		Number(v.number),
	);
	if (numbers.length && !numbers.includes(version)) {
		throw new NodeOperationError(
			this.getNode(),
			`Version ${version} does not exist. ${document.reference} has versions ${numbers.join(', ')}.`,
			{ itemIndex: i },
		);
	}
	const response = await apiRequest.call(this, 'GET', `/documents/${id}/versions/${version}/pdf`, {
		binary: true,
	});
	const disposition = String(response.headers?.['content-disposition'] ?? '');
	const fileName =
		/filename="([^"]+)"/.exec(disposition)?.[1] ?? `${document.reference}-v${version}.pdf`;
	const binary = await this.helpers.prepareBinaryData(
		Buffer.from(response.body as ArrayBuffer),
		fileName,
		'application/pdf',
	);
	return {
		json: { ...document, pdf_version: version, pdf_sha256: response.headers?.['x-content-sha256'] },
		binary: { [property]: binary },
		pairedItem: { item: i },
	};
}

async function drafts(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'get') {
		const id = this.getNodeParameter('draftId', i) as number;
		return (await apiRequest.call(this, 'GET', `/drafts/${id}`)).data;
	}
	if (operation === 'update') {
		const id = this.getNodeParameter('draftId', i) as number;
		return (
			await apiRequest.call(this, 'PATCH', '/drafts/' + id, {
				body: {
					revision: this.getNodeParameter('revision', i) as number,
					data: objectParameter(this, 'changes', i),
				},
			})
		).data;
	}
	if (operation === 'getAll') {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i, 50) as number);
		return apiRequestAll.call(this, '/drafts', filters, limit);
	}
	const serviceDate = String(this.getNodeParameter('serviceDate', i)).slice(0, 10);
	const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const shipments = (
		(this.getNodeParameter('shipments', i, {}) as { shipment?: IDataObject[] }).shipment ?? []
	).map((shipment) => {
		const weight = shipment.weight;
		return clean({
			...shipment,
			weight: weight === undefined || weight === '' || weight === 0 ? undefined : Number(weight),
		});
	});
	if (!shipments.length) {
		throw new NodeOperationError(this.getNode(), 'Add at least one shipment', { itemIndex: i });
	}
	const body = clean({
		...extra,
		document_date: extra.document_date ? String(extra.document_date).slice(0, 10) : undefined,
		service_date: serviceDate,
	});
	body.shipments = shipments;
	return (await apiRequest.call(this, 'POST', '/drafts', { body })).data;
}

async function masters(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const path = MASTER_PATHS[resource];
	if (operation === 'getAll') {
		const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i, 50) as number);
		return apiRequestAll.call(this, path, filters, limit);
	}
	const fields: Record<string, string[]> = {
		counterparty: ['name', 'nif', 'address', 'roles'],
		vehicle: ['plate'],
		driver: ['name', 'nif'],
	};
	const body: IDataObject = {};
	for (const field of fields[resource]) {
		body[field] = this.getNodeParameter(field, i);
	}
	Object.assign(body, this.getNodeParameter('additionalFields', i, {}) as IDataObject);
	return (await apiRequest.call(this, 'POST', path, { body: clean(body) })).data;
}

/**
 * The draft (still pending) or the issued document created earlier with the External Reference of item «i».
 * Each lookup needs its own read permission; without it, or if nothing is found, the conflict is shown alone.
 */
async function existingForReference(
	this: IExecuteFunctions,
	i: number,
): Promise<IDataObject | null> {
	const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const reference = String(extra.external_reference ?? '');
	if (!reference) {
		return null;
	}
	for (const path of ['/drafts', '/documents']) {
		try {
			const response = await apiRequest.call(this, 'GET', path, {
				qs: { external_reference: reference, per_page: 1 },
			});
			const found = (response.data as IDataObject[] | undefined)?.[0];
			if (found) {
				return found;
			}
		} catch {
			// Missing permission for this lookup: try the next one.
		}
	}
	return null;
}
