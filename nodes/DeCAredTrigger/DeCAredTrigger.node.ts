import {
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { apiRequest, validSignature } from '../DeCAred/transport';

export class DeCAredTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeCAred Trigger',
		name: 'deCAredTrigger',
		icon: { light: 'file:../../icons/decared.svg', dark: 'file:../../icons/decared.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when a DeCAred document is issued, corrected, closed or annulled',
		defaults: { name: 'DeCAred Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'deCAredApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: [
					{
						name: 'Document Annulled',
						value: 'document.annulled',
						description: 'An issued document was annulled',
					},
					{
						name: 'Document Closed',
						value: 'document.closed',
						description: 'The company closed the transport',
					},
					{
						name: 'Document Corrected',
						value: 'document.corrected',
						description: 'A new version of a document was issued',
					},
					{
						name: 'Document Issued',
						value: 'document.issued',
						description: 'A DeCA, route sheet or carriage letter was issued',
					},
					{
						name: 'Receipt Confirmed by Driver',
						value: 'document.receipt_confirmed',
						description: 'The driver confirmed receiving the current version',
					},
					{
						name: 'Service Finished by Driver',
						value: 'document.service_finished',
						description:
							'The driver reported the end of the service. This is not the company closing it.',
					},
				],
				default: ['document.issued'],
			},
			{
				displayName:
					'DeCAred only sends events to public https:// addresses, so this n8n instance must be reachable from the internet over HTTPS. The API key needs the webhooks:manage permission (general read keys include it).',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId === undefined) {
					return false;
				}
				const url = this.getNodeWebhookUrl('default');
				const events = [...(this.getNodeParameter('events') as string[])].sort().join(',');
				const response = await apiRequest.call(this, 'GET', '/webhooks');
				const found = ((response.data as IDataObject[]) ?? []).find(
					(webhook) => webhook.id === staticData.webhookId,
				);
				if (
					found &&
					found.url === url &&
					[...(found.events as string[])].sort().join(',') === events
				) {
					return true;
				}
				// Stale or changed subscription: remove it so n8n creates a fresh one.
				if (found) {
					await apiRequest.call(this, 'DELETE', `/webhooks/${staticData.webhookId}`);
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events') as string[];
				const response = await apiRequest.call(this, 'POST', '/webhooks', {
					body: { url, events },
				});
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = response.data.id;
				staticData.webhookSecret = response.data.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId !== undefined) {
					try {
						await apiRequest.call(this, 'DELETE', `/webhooks/${staticData.webhookId}`);
					} catch (error) {
						// Already removed in DeCAred (for example from the Integraciones page).
						if ((error as { httpCode?: string }).httpCode !== '404') {
							return false;
						}
					}
					delete staticData.webhookId;
					delete staticData.webhookSecret;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;
		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
		const signature = this.getHeaderData()['decared-signature'] as string | undefined;

		if (!secret || !validSignature(signature, rawBody, secret)) {
			this.getResponseObject().status(401).send('Invalid signature');
			return { noWebhookResponse: true };
		}

		const payload = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events') as string[];
		if (!events.includes(payload.event as string)) {
			// «ping» and events this node does not listen to are acknowledged without running the workflow.
			return { webhookResponse: 'OK' };
		}

		return {
			workflowData: [
				this.helpers.returnJsonArray({
					...(payload.data as IDataObject),
					event: payload.event,
					event_id: payload.id,
					event_created_at: payload.created_at,
				}),
			],
		};
	}
}
