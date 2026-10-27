import type { INodeProperties } from 'n8n-workflow';

const show = (resource: string, operation?: string[]) => ({
	show: operation ? { resource: [resource], operation } : { resource: [resource] },
});

const pagination = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		displayOptions: show(resource, ['getAll']),
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
	},
];

const updatedSince: INodeProperties = {
	displayName: 'Updated Since',
	name: 'updated_since',
	type: 'dateTime',
	default: '',
	description: 'Only records changed at or after this moment',
};

const country: INodeProperties = {
	displayName: 'Country',
	name: 'country',
	type: 'string',
	default: 'ES',
	description: 'ISO 3166-1 alpha-2 code, for example ES or PT',
};

const email: INodeProperties = {
	displayName: 'Email',
	name: 'email',
	type: 'string',
	placeholder: 'name@email.com',
	default: '',
};

/* ------------------------------------------------------------------ Document */

export const documentFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show('document'),
		options: [
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				action: 'Download the PDF of a document',
				description: 'Download the signed PDF of a version as binary data',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a document',
				description: 'Get an issued document with all its versions',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many documents',
				description: 'List or search issued documents, newest change first',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Document ID',
		name: 'documentId',
		type: 'number',
		required: true,
		displayOptions: show('document', ['get', 'downloadPdf']),
		default: 0,
		description: 'Numeric ID of the document, as returned by the trigger or by Get Many',
	},
	{
		displayName: 'Version',
		name: 'version',
		type: 'number',
		displayOptions: show('document', ['downloadPdf']),
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Version number to download. Leave 0 for the current version.',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		displayOptions: show('document', ['downloadPdf']),
		default: 'data',
		hint: 'The name of the output binary field to put the PDF in',
	},
	...pagination('document'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		displayOptions: show('document', ['getAll']),
		default: {},
		options: [
			{
				displayName: 'External Reference',
				name: 'external_reference',
				type: 'string',
				default: '',
				description: 'Order reference from your own system, as sent when creating the draft',
			},
			{
				displayName: 'Reference',
				name: 'reference',
				type: 'string',
				default: '',
				placeholder: 'DECA-2026-001095',
				description: 'Exact DeCAred reference',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Annulled', value: 'annulled' },
					{ name: 'Closed', value: 'closed' },
					{ name: 'Open', value: 'open' },
				],
				default: 'open',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Carriage Letter (Carta De Porte)', value: 'carriage_letter' },
					{ name: 'DeCA', value: 'deca' },
					{ name: 'Route Sheet (Hoja De Ruta)', value: 'route_sheet' },
				],
				default: 'deca',
			},
			updatedSince,
		],
	},
];

/* --------------------------------------------------------------------- Draft */

export const draftFields: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: show('draft'),
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a de ca draft',
				description:
					'Create a draft for the office to review and issue. Issue requires a separate approved workflow operation.',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a draft',
				description: 'Get a draft created through the API',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many drafts',
				description: 'List drafts not issued yet, for example the one of an order reference',
			},
			{ name: 'Update', value: 'update', action: 'Update a draft' },
		],
		default: 'create',
	},
	...pagination('draft'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		displayOptions: show('draft', ['getAll']),
		default: {},
		options: [
			{
				displayName: 'External Reference',
				name: 'external_reference',
				type: 'string',
				default: '',
				description: 'Order reference from your own system',
			},
			updatedSince,
		],
	},
	{
		displayName: 'Draft ID',
		name: 'draftId',
		type: 'number',
		required: true,
		displayOptions: show('draft', ['get', 'update']),
		default: 0,
	},
	{
		displayName: 'Service Date',
		name: 'serviceDate',
		type: 'dateTime',
		required: true,
		displayOptions: show('draft', ['create']),
		default: '',
		description: 'Day of the transport service: today or later',
	},
	{
		displayName: 'Shipments',
		name: 'shipments',
		type: 'fixedCollection',
		required: true,
		typeOptions: { multipleValues: true },
		displayOptions: show('draft', ['create']),
		placeholder: 'Add Shipment',
		default: {},
		options: [
			{
				displayName: 'Shipment',
				name: 'shipment',
				values: [
					{
						displayName: 'ADR',
						name: 'adr',
						type: 'string',
						default: '',
						description: 'Dangerous goods details, if any',
					},
					{
						displayName: 'Destination',
						name: 'destination',
						type: 'string',
						required: true,
						default: '',
						description: 'Full unloading address',
					},
					{
						displayName: 'Destination Name',
						name: 'destination_name',
						type: 'string',
						default: '',
						description: 'Name of the unloading place',
					},
					{
						displayName: 'Goods',
						name: 'goods',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Gross Weight (Kg)',
						name: 'weight',
						type: 'number',
						default: 0,
						description: 'Leave 0 to use Other Measure instead',
					},
					{
						displayName: 'Observations',
						name: 'observations',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Origin',
						name: 'origin',
						type: 'string',
						required: true,
						default: '',
						description: 'Full loading address',
					},
					{
						displayName: 'Origin Name',
						name: 'origin_name',
						type: 'string',
						default: '',
						description: 'Name of the loading place',
					},
					{
						displayName: 'Other Measure',
						name: 'alternative',
						type: 'string',
						default: '',
						description: 'Quantity when there is no weight, for example 30 m³	or 2000 litres',
					},
					{
						displayName: 'Packages',
						name: 'packages',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Packaging',
						name: 'packaging',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Recipient',
						name: 'recipient',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: show('draft', ['create']),
		default: {},
		options: [
			{
				displayName: 'Carrier NIF',
				name: 'carrier_nif',
				type: 'string',
				default: '',
				description:
					'Tax ID of the carrier when it is not your company. It must exist in the address book.',
			},
			{
				displayName: 'Document Date',
				name: 'document_date',
				type: 'dateTime',
				default: '',
				description: 'Defaults to today',
			},
			{
				displayName: 'Driver NIF',
				name: 'driver_nif',
				type: 'string',
				default: '',
				description: 'Tax ID of a driver of your company',
			},
			{
				displayName: 'External Reference',
				name: 'external_reference',
				type: 'string',
				default: '',
				description:
					'Order reference in your system. Sending the same order again returns the existing draft. Sending it with different data fails with external_reference_conflict and shows the existing record for review: nothing is overwritten.',
			},
			{
				displayName: 'Observations',
				name: 'observations',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
			},
			{
				displayName: 'Shipper NIF',
				name: 'shipper_nif',
				type: 'string',
				default: '',
				description:
					'Tax ID of the shipper. It must exist in the address book with the shipper role.',
			},
			{
				displayName: 'Vehicle Plate',
				name: 'vehicle_plate',
				type: 'string',
				default: '',
				description: 'Plate of a vehicle of your company',
			},
		],
	},
];

/* ------------------------------------------------------------- Master data */

const masterOperation = (resource: string, noun: string): INodeProperties => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: show(resource),
	options: [
		{
			name: 'Create or Update',
			value: 'upsert',
			action: `Create or update a ${noun}`,
			description: 'Create a new record, or update the current one if it already exists (upsert)',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: `Get many ${noun}s`,
			description: `List the ${noun}s of the address book, newest change first`,
		},
	],
	default: 'upsert',
});

const masterFilters = (resource: string): INodeProperties => ({
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	displayOptions: show(resource, ['getAll']),
	default: {},
	options: [updatedSince],
});

export const counterpartyFields: INodeProperties[] = [
	masterOperation('counterparty', 'counterparty'),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		displayOptions: show('counterparty', ['upsert']),
		default: '',
		description: 'Company name',
	},
	{
		displayName: 'NIF',
		name: 'nif',
		type: 'string',
		required: true,
		displayOptions: show('counterparty', ['upsert']),
		default: '',
		description: 'Tax ID (NIF or EU VAT number). It identifies the counterparty.',
	},
	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		required: true,
		displayOptions: show('counterparty', ['upsert']),
		default: '',
		description: 'Full registered address',
	},
	{
		displayName: 'Roles',
		name: 'roles',
		type: 'options',
		required: true,
		displayOptions: show('counterparty', ['upsert']),
		options: [
			{ name: 'Carrier', value: 'transportista' },
			{ name: 'Carrier and Recipient', value: 'destinatario,transportista' },
			{ name: 'Recipient', value: 'destinatario' },
			{ name: 'Shipper', value: 'cargador' },
			{ name: 'Shipper and Carrier', value: 'cargador,transportista' },
			{ name: 'Shipper and Recipient', value: 'cargador,destinatario' },
			{ name: 'Shipper, Carrier and Recipient', value: 'cargador,destinatario,transportista' },
		],
		default: 'cargador',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: show('counterparty', ['upsert']),
		default: {},
		options: [country, email],
	},
	...pagination('counterparty'),
	masterFilters('counterparty'),
];

export const vehicleFields: INodeProperties[] = [
	masterOperation('vehicle', 'vehicle'),
	{
		displayName: 'Plate',
		name: 'plate',
		type: 'string',
		required: true,
		displayOptions: show('vehicle', ['upsert']),
		default: '',
		description: 'Plate of the vehicle or tractor unit. It identifies the vehicle.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: show('vehicle', ['upsert']),
		default: {},
		options: [
			{ displayName: 'Description', name: 'description', type: 'string', default: '' },
			{ displayName: 'Trailer Plate', name: 'trailer', type: 'string', default: '' },
		],
	},
	...pagination('vehicle'),
	masterFilters('vehicle'),
];

export const driverFields: INodeProperties[] = [
	masterOperation('driver', 'driver'),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		displayOptions: show('driver', ['upsert']),
		default: '',
		description: 'Full name',
	},
	{
		displayName: 'NIF',
		name: 'nif',
		type: 'string',
		required: true,
		displayOptions: show('driver', ['upsert']),
		default: '',
		description: 'NIF, NIE or identity document. It identifies the driver.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: show('driver', ['upsert']),
		default: {},
		options: [country, email, { displayName: 'Phone', name: 'phone', type: 'string', default: '' }],
	},
	...pagination('driver'),
	masterFilters('driver'),
];
