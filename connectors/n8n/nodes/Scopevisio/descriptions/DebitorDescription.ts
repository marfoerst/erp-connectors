import type { INodeProperties } from 'n8n-workflow';

export const debitorOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['debitor'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a debitor account for a contact, unless it already has one',
				action: 'Create a debitor account',
			},
		],
		default: 'create',
	},
];

export const debitorFields: INodeProperties[] = [
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'number',
		required: true,
		default: 0,
		description: 'The contact that becomes a debitor. Safe to repeat: an existing debitor is left as it is.',
		displayOptions: { show: { resource: ['debitor'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['debitor'], operation: ['create'] } },
		options: [
			{ displayName: 'Collective Account Number', name: 'sumAccountNumber', type: 'string', default: '' },
			{ displayName: 'Currency', name: 'currency', type: 'string', default: '', placeholder: 'EUR' },
			{
				displayName: 'Customer Group',
				name: 'group',
				type: 'string',
				default: '',
				description: 'Created automatically if it does not exist yet',
			},
			{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'de' },
			{ displayName: 'Number Range Number', name: 'numberRangeNumber', type: 'number', default: 0 },
			{
				displayName: 'One-Off Customer (CPD)',
				name: 'contoProDiverse',
				type: 'boolean',
				default: false,
				description: 'Whether to book to a Conto pro Diverse account, the usual choice for one-off buyers',
			},
			{ displayName: 'Payment Term ID', name: 'paymentTermId', type: 'number', default: 0 },
			{ displayName: 'Payment Type', name: 'paymentType', type: 'string', default: '' },
			{ displayName: 'Personal Account Number', name: 'personalAccountNumber', type: 'string', default: '' },
			{ displayName: 'VAT ID', name: 'vatId', type: 'string', default: '' },
		],
	},
];
