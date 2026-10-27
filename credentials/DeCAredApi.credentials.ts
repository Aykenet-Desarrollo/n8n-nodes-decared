import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DeCAredApi implements ICredentialType {
	name = 'deCAredApi';

	displayName = 'DeCAred API';

	icon: Icon = { light: 'file:../icons/decared.svg', dark: 'file:../icons/decared.dark.svg' };

	documentationUrl = 'https://decared.com/integraciones/documentacion';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'dcr_…',
			description:
				'Create it in DeCAred → Más → Integraciones. API 1.3 workflow actions, tracking and draft editing require explicit scopes; general read/write do not include them. With specific permissions, the trigger needs webhooks:manage and each operation its own permission, for example documents:read or drafts:write.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://decared.com/api/v1',
			description: 'Leave the default unless DeCAred support gives you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}',
			url: '/me',
			method: 'GET',
		},
	};
}
