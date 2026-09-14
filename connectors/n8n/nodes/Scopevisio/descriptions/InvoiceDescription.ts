import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_FIELDS } from './defaults';
import { getManyFields } from './shared';

export const outgoingInvoiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['outgoingInvoice'] } },
		options: [
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				description: 'Download the rendered PDF of an invoice',
				action: 'Download an outgoing invoice PDF',
			},
			{ name: 'Get', value: 'get', description: 'Get an outgoing invoice', action: 'Get an outgoing invoice' },
			{ name: 'Get Many', value: 'getMany', description: 'Search outgoing invoices', action: 'Get many outgoing invoices' },
			{
				name: 'Post to Ledger',
				value: 'post',
				description: 'Commit an invoice to the ledger. Cannot be undone.',
				action: 'Post an outgoing invoice to the ledger',
			},
		],
		default: 'getMany',
	},
];

export const outgoingInvoiceFields: INodeProperties[] = [
	{
		displayName: 'Document Number',
		name: 'documentNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'RE-2026-26',
		displayOptions: { show: { resource: ['outgoingInvoice'], operation: ['get', 'downloadPdf', 'post'] } },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: { resource: ['outgoingInvoice'], operation: ['downloadPdf'] } },
	},
	{
		displayName:
			'Posting commits the invoice to the ledger. Under GoBD a posted document cannot be withdrawn, only corrected with a credit note.',
		name: 'postingNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['outgoingInvoice'], operation: ['post'] } },
	},
	{
		displayName: 'Confirm Irreversible Posting',
		name: 'confirmPosting',
		type: 'boolean',
		default: false,
		description: 'Whether you understand that posting cannot be undone. The operation refuses to run until this is on.',
		displayOptions: { show: { resource: ['outgoingInvoice'], operation: ['post'] } },
	},
	...getManyFields('outgoingInvoice', DEFAULT_FIELDS.outgoingInvoice),
];

export const incomingInvoiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['incomingInvoice'] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get an incoming invoice', action: 'Get an incoming invoice' },
			{ name: 'Get Many', value: 'getMany', description: 'Search incoming invoices', action: 'Get many incoming invoices' },
		],
		default: 'getMany',
	},
];

export const incomingInvoiceFields: INodeProperties[] = [
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['incomingInvoice'], operation: ['get'] } },
	},
	...getManyFields('incomingInvoice', DEFAULT_FIELDS.incomingInvoice),
];
