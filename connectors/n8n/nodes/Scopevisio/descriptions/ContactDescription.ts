import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_FIELDS } from './defaults';
import { filtersField, getFieldsOption, getManyFields } from './shared';

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{ name: 'Count', value: 'count', description: 'Count contacts matching filters', action: 'Count contacts' },
			{ name: 'Create', value: 'create', description: 'Create a contact', action: 'Create a contact' },
			{ name: 'Get', value: 'get', description: 'Get a contact by ID or legacy number', action: 'Get a contact' },
			{ name: 'Get Many', value: 'getMany', description: 'Search contacts', action: 'Get many contacts' },
			{ name: 'Update', value: 'update', description: 'Update a contact', action: 'Update a contact' },
		],
		default: 'getMany',
	},
];

const contactDetailFields: INodeProperties[] = [
	{ displayName: 'City', name: 'city1', type: 'string', default: '' },
	{
		displayName: 'Country Code',
		name: 'country1',
		type: 'string',
		default: '',
		placeholder: 'DE',
		description: 'Two-letter ISO country code',
	},
	{ displayName: 'Customer Number', name: 'customerNumber', type: 'string', default: '' },
	{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
	{
		displayName: 'First Name',
		name: 'firstname',
		type: 'string',
		default: '',
		description: 'Only applies to persons. Scopevisio ignores it for companies.',
	},
	{
		displayName: 'Legacy Number',
		name: 'legacyNumber',
		type: 'string',
		default: '',
		description:
			'ID of this contact in another system. Useful as a stable key for lookups and to avoid duplicates.',
	},
	{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	{ displayName: 'Postcode', name: 'postcode1', type: 'string', default: '' },
	{ displayName: 'Salutation', name: 'salutation', type: 'string', default: '' },
	{ displayName: 'Street', name: 'street1', type: 'string', default: '' },
	{
		displayName: 'Tags',
		name: 'tags',
		type: 'string',
		default: '',
		description: 'Comma-separated tags (Schlagwörter)',
	},
	{ displayName: 'Title', name: 'title', type: 'string', default: '' },
	{ displayName: 'VAT ID', name: 'vatId', type: 'string', default: '', placeholder: 'DE123456789' },
];

export const contactFields: INodeProperties[] = [
	// create
	{
		displayName: 'Contact Type',
		name: 'contactType',
		type: 'options',
		options: [
			{ name: 'Company', value: 'company' },
			{ name: 'Person', value: 'person' },
		],
		default: 'company',
		description: 'Cannot be changed after the contact is created',
		displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
	},
	{
		displayName: 'Name',
		name: 'lastname',
		type: 'string',
		required: true,
		default: '',
		description: 'Company name for a company, last name for a person',
		displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
		options: contactDetailFields,
	},

	// get
	{
		displayName: 'Look Up By',
		name: 'identifyBy',
		type: 'options',
		options: [
			{ name: 'ID', value: 'ID' },
			{ name: 'Legacy Number', value: 'LEGACYNUMBER' },
		],
		default: 'ID',
		displayOptions: { show: { resource: ['contact'], operation: ['get'] } },
	},
	{
		displayName: 'Value',
		name: 'identifier',
		type: 'string',
		required: true,
		default: '',
		description: 'The contact ID or legacy number to look up',
		displayOptions: { show: { resource: ['contact'], operation: ['get'] } },
	},
	getFieldsOption('contact', DEFAULT_FIELDS.contact),

	// getMany + count
	...getManyFields('contact', DEFAULT_FIELDS.contact),
	filtersField('contact', ['count']),

	// update
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
		options: [
			...contactDetailFields.slice(0, 7),
			{ displayName: 'Name', name: 'lastname', type: 'string', default: '' },
			...contactDetailFields.slice(7),
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
		options: [
			{
				displayName: 'Verify Update',
				name: 'verify',
				type: 'boolean',
				default: true,
				description:
					'Whether to read the contact back and fail if Scopevisio did not apply a field. Scopevisio reports success even when it ignores a field.',
			},
		],
	},
];
