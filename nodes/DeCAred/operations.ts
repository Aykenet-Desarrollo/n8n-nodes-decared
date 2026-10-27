import { createHash } from 'crypto';
import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	type INodeExecutionData,
} from 'n8n-workflow';
import { apiRequest, apiRequestAll } from './transport';

const show = (resource: string, operation?: string[]) => ({
	show: { resource: [resource], ...(operation ? { operation } : {}) },
});
const field = (
	displayName: string,
	name: string,
	resource: string,
	operation?: string[],
): INodeProperties => ({
	displayName,
	name,
	type: 'string',
	default: '',
	required: true,
	displayOptions: show(resource, operation),
});

export const workflowFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show('attachment'),
		default: 'download',
		options: [{ name: 'Download', value: 'download', action: 'Download an attachment' }],
	},
	field('Document ID', 'attachmentDocumentId', 'attachment'),
	field('Attachment ID', 'attachmentId', 'attachment'),
	{ ...field('Output Binary Field', 'attachmentBinaryField', 'attachment'), default: 'data' },
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show('workflow'),
		default: 'prepare',
		options: [
			{ name: 'Confirm', value: 'confirm', action: 'Confirm an approved operation' },
			{ name: 'Get', value: 'get', action: 'Get an operation status' },
			{ name: 'Prepare', value: 'prepare', action: 'Prepare an operation for approval' },
		],
	},
	field('Document ID', 'workflowDocumentId', 'workflow', ['prepare']),
	field('Operation ID', 'operationId', 'workflow', ['get', 'confirm']),
	{
		displayName: 'Proposal (JSON)',
		name: 'proposal',
		type: 'json',
		default: '{"action":"message","revision":0,"body":"","visibility":"internal"}',
		required: true,
		displayOptions: show('workflow', ['prepare']),
		description:
			'Exact API 1.3 proposal: action, revision and action-specific fields. Does not execute the action. Attachments require the HTTP Request node with multipart data.',
	},
	{
		...field('Confirmation Token', 'confirmationToken', 'workflow', ['confirm']),
		typeOptions: { password: true },
	},
	{
		displayName: 'Approved',
		name: 'approved',
		type: 'boolean',
		default: false,
		displayOptions: show('workflow', ['confirm']),
		description:
			'Whether a person approved this exact proposal. Never set this automatically from the prepare response. Proposals expire after 15 minutes.',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show('tracking'),
		default: 'get',
		options: [
			{ name: 'Get', value: 'get', action: 'Get document tracking summary' },
			{ name: 'Get Many', value: 'getAll', action: 'Get tracking records' },
		],
	},
	field('Document ID', 'trackingDocumentId', 'tracking'),
	{
		displayName: 'Collection',
		name: 'trackingCollection',
		type: 'options',
		default: 'issues',
		displayOptions: show('tracking', ['getAll']),
		options: [
			'attachments',
			'deliveries',
			'interactions',
			'issue_events',
			'issues',
			'messages',
		].map((value) => ({ name: value, value })),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show('tracking', ['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: { show: { resource: ['tracking'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Revision',
		name: 'revision',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0 },
		required: true,
		displayOptions: show('draft', ['update']),
	},
	{
		displayName: 'Changes (JSON)',
		name: 'changes',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: show('draft', ['update']),
		description: 'Native draft fields to merge. A shipments array replaces the entire list.',
	},
];

export async function downloadAttachment(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData> {
	const document = encodeURIComponent(String(this.getNodeParameter('attachmentDocumentId', i)));
	const attachment = encodeURIComponent(String(this.getNodeParameter('attachmentId', i)));
	const response = await apiRequest.call(
		this,
		'GET',
		`/documents/${document}/attachments/${attachment}`,
		{ binary: true },
	);
	const buffer = Buffer.from(response.body as ArrayBuffer);
	const expected = String(response.headers?.['x-content-sha256'] ?? '').toLowerCase();
	const actual = createHash('sha256').update(buffer).digest('hex');
	if (!expected || expected !== actual) {
		throw new NodeOperationError(this.getNode(), 'Attachment SHA-256 verification failed', {
			itemIndex: i,
		});
	}
	const disposition = String(response.headers?.['content-disposition'] ?? '');
	const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `attachment-${attachment}`;
	const binary = await this.helpers.prepareBinaryData(
		buffer,
		filename,
		String(response.headers?.['content-type'] ?? 'application/octet-stream'),
	);
	const property = this.getNodeParameter('attachmentBinaryField', i, 'data') as string;
	return {
		json: { document_id: document, attachment_id: attachment, sha256: actual },
		binary: { [property]: binary },
		pairedItem: { item: i },
	};
}

export function objectParameter(context: IExecuteFunctions, name: string, i: number): IDataObject {
	const raw = context.getNodeParameter(name, i);
	let value: unknown;
	try {
		value = typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch {
		throw new NodeOperationError(context.getNode(), `${name} must be valid JSON`, { itemIndex: i });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NodeOperationError(context.getNode(), `${name} must be a JSON object`, {
			itemIndex: i,
		});
	}
	return value as IDataObject;
}

export async function workflow(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (operation === 'prepare') {
		const id = encodeURIComponent(String(this.getNodeParameter('workflowDocumentId', i)));
		return (
			await apiRequest.call(this, 'POST', `/documents/${id}/actions`, {
				body: objectParameter(this, 'proposal', i),
			})
		).data;
	}
	const id = encodeURIComponent(String(this.getNodeParameter('operationId', i)));
	if (operation === 'get') {
		return (await apiRequest.call(this, 'GET', `/operations/${id}`)).data;
	}
	if (operation !== 'confirm' || this.getNodeParameter('approved', i, false) !== true) {
		throw new NodeOperationError(
			this.getNode(),
			'Review the exact proposal and explicitly approve it before confirming',
			{ itemIndex: i },
		);
	}
	return (
		await apiRequest.call(this, 'POST', `/operations/${id}/confirm`, {
			body: {
				confirmed: true,
				confirmation_token: this.getNodeParameter('confirmationToken', i) as string,
			},
		})
	).data;
}

export async function tracking(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const id = encodeURIComponent(String(this.getNodeParameter('trackingDocumentId', i)));
	const path = `/documents/${id}/tracking`;
	if (operation === 'get') return (await apiRequest.call(this, 'GET', path)).data;
	const collection = this.getNodeParameter('trackingCollection', i) as string;
	const limit = this.getNodeParameter('returnAll', i, false)
		? 0
		: (this.getNodeParameter('limit', i, 50) as number);
	return apiRequestAll.call(this, `${path}/${collection}`, {}, limit);
}
