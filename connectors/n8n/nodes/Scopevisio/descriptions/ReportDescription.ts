import type { INodeProperties } from 'n8n-workflow';

import { DATASOURCES, datasourceLabel } from '../helpers';

export const reportOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['report'] } },
		options: [
			{
				name: 'Get Rows',
				value: 'getRows',
				description: 'Get the rows of a Scopevisio report for a date range',
				action: 'Get report rows',
			},
		],
		default: 'getRows',
	},
];

export const reportFields: INodeProperties[] = [
	{
		displayName: 'Report',
		name: 'datasource',
		type: 'options',
		options: [...DATASOURCES]
			.map((path) => ({ name: datasourceLabel(path), value: path }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		default: 'outgoingInvoice',
		displayOptions: { show: { resource: ['report'], operation: ['getRows'] } },
	},
	{
		displayName: 'Start Date',
		name: 'startDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['report'], operation: ['getRows'] } },
	},
	{
		displayName: 'End Date',
		name: 'endDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['report'], operation: ['getRows'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['report'], operation: ['getRows'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['report'], operation: ['getRows'], returnAll: [false] } },
	},
];
