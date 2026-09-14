import type { INodeProperties } from 'n8n-workflow';

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get the customer, organisation and user the credential belongs to',
				action: 'Get the connected account',
			},
		],
		default: 'get',
	},
];

export const accountFields: INodeProperties[] = [];
