import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

const OPERATORS: INodePropertyOptions[] = [
	{ name: 'Contains', value: 'contains' },
	{ name: 'Contains (Case-Insensitive)', value: 'icontains' },
	{ name: 'Ends With', value: 'endswith' },
	{ name: 'Equal', value: 'equal' },
	{ name: 'Greater Than', value: 'greater' },
	{ name: 'Greater Than or Equal', value: 'greaterorequal' },
	{ name: 'Is Empty', value: 'is null' },
	{ name: 'Is Not Empty', value: 'is not null' },
	{ name: 'Less Than', value: 'less' },
	{ name: 'Less Than or Equal', value: 'lessorequal' },
	{ name: 'Not Equal', value: 'notequal' },
	{ name: 'Starts With', value: 'startswith' },
];

/** The filter conditions shared by every search and count operation. */
export function filtersField(resource: string, operations: string[]): INodeProperties {
	return {
		displayName: 'Filters',
		name: 'filters',
		type: 'fixedCollection',
		placeholder: 'Add Condition',
		typeOptions: { multipleValues: true },
		default: {},
		displayOptions: { show: { resource: [resource], operation: operations } },
		description: 'Conditions are combined with AND',
		options: [
			{
				displayName: 'Condition',
				name: 'conditions',
				values: [
					{
						displayName: 'Field',
						name: 'field',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'lastname',
						description: 'Scopevisio field name to filter on',
					},
					{
						displayName: 'Operator',
						name: 'operator',
						type: 'options',
						options: OPERATORS,
						default: 'equal',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						displayOptions: { hide: { operator: ['is null', 'is not null'] } },
					},
				],
			},
		],
	};
}

/** Return All, Limit, Filters and Options for a Get Many operation. */
export function getManyFields(resource: string, defaultFields: string): INodeProperties[] {
	const show = { resource: [resource], operation: ['getMany'] };
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
		},
		filtersField(resource, ['getMany']),
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show },
			options: [
				{
					displayName: 'Fields',
					name: 'fields',
					type: 'string',
					default: defaultFields,
					description:
						'Comma-separated fields to return. Clear it to return every field, which can be several hundred per record.',
				},
				{
					displayName: 'Sort By',
					name: 'sortField',
					type: 'string',
					default: 'id',
				},
				{
					displayName: 'Sort Direction',
					name: 'sortDirection',
					type: 'options',
					options: [
						{ name: 'Ascending', value: 'asc' },
						{ name: 'Descending', value: 'desc' },
					],
					default: 'asc',
				},
			],
		},
	];
}

/** A single "Fields" option for Get operations. */
export function getFieldsOption(resource: string, defaultFields: string): INodeProperties {
	return {
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [resource], operation: ['get'] } },
		options: [
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'string',
				default: defaultFields,
				description:
					'Comma-separated fields to return. Clear it to return every field, which can be several hundred.',
			},
		],
	};
}
