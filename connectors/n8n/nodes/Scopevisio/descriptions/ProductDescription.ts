import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_FIELDS } from './defaults';
import { getFieldsOption, getManyFields } from './shared';

export const productOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['product'] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create a product', action: 'Create a product' },
			{ name: 'Get', value: 'get', description: 'Get a product', action: 'Get a product' },
			{ name: 'Get Many', value: 'getMany', description: 'Search products', action: 'Get many products' },
		],
		default: 'getMany',
	},
];

export const productFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['product'], operation: ['create'] } },
	},
	{
		displayName: 'Unit',
		name: 'unit',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Stück',
		displayOptions: { show: { resource: ['product'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['product'], operation: ['create'] } },
		options: [
			{ displayName: 'Description', name: 'description', type: 'string', default: '' },
			{ displayName: 'Gross Price', name: 'singleAmountGross', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
			{ displayName: 'Net Price', name: 'singleAmount', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
			{ displayName: 'Product Group', name: 'productGroupName', type: 'string', default: '' },
			{ displayName: 'Product Number', name: 'number', type: 'string', default: '' },
			{ displayName: 'Revenue Account', name: 'revenueAccount0', type: 'string', default: '' },
			{ displayName: 'Tax Rate', name: 'taxRate', type: 'number', default: 19, description: 'In percent' },
		],
	},
	{
		displayName: 'Product ID',
		name: 'productId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['product'], operation: ['get'] } },
	},
	getFieldsOption('product', DEFAULT_FIELDS.product),
	...getManyFields('product', DEFAULT_FIELDS.product),
];
