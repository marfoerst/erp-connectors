import type { INodeProperties } from 'n8n-workflow';

export const taxOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['tax'] } },
		options: [
			{
				name: 'Get Tax Cases',
				value: 'getTaxCases',
				description: 'Get the tax cases (Steuersachverhalte) configured in the tenant',
				action: 'Get tax cases',
			},
			{
				name: 'Get VAT Matrix',
				value: 'getVatMatrix',
				description: 'Get the VAT matrix (Steuermatrix) entries',
				action: 'Get the VAT matrix',
			},
			{
				name: 'Resolve Revenue Accounts',
				value: 'resolveRevenueAccounts',
				description: 'Find the revenue accounts and tax keys a tax case implies for a country and date',
				action: 'Resolve revenue accounts',
			},
		],
		default: 'resolveRevenueAccounts',
	},
];

export const taxFields: INodeProperties[] = [
	{
		displayName: 'Active Only',
		name: 'activeOnly',
		type: 'boolean',
		default: true,
		description: 'Whether to return only entries that are currently active',
		displayOptions: { show: { resource: ['tax'], operation: ['getTaxCases', 'resolveRevenueAccounts'] } },
	},
	{
		displayName: 'Country Code',
		name: 'country',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'DE',
		description: 'Two-letter ISO code of the destination country',
		displayOptions: { show: { resource: ['tax'], operation: ['resolveRevenueAccounts'] } },
	},
	{
		displayName: 'Tax Case Name or ID',
		name: 'taxCaseId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTaxCases' },
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: ['tax'], operation: ['resolveRevenueAccounts'] } },
	},
	{
		displayName: 'Date of Supply',
		name: 'servicesRenderedDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Tax rates and accounts are valid for date ranges, so the date decides which apply',
		displayOptions: { show: { resource: ['tax'], operation: ['resolveRevenueAccounts'] } },
	},
];
