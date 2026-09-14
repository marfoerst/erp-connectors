import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { scopevisioSearch } from '../Scopevisio/GenericFunctions';
import { buildSearchBody, newRecordsSince, parseFieldList } from '../Scopevisio/helpers';

/**
 * Scopevisio has no webhooks, so this trigger polls.
 *
 * It keeps the highest record id it has emitted in the node's static data and
 * asks only for records above it, oldest first. The first poll after
 * activation records the current highest id and emits nothing — otherwise
 * activating a trigger would replay every record in the tenant.
 *
 * If a poll fails, nothing is written, so the next poll covers the same range
 * and no record is skipped.
 */

interface EventConfig {
	endpoint: string;
	label: string;
	defaultFields: string;
}

export const EVENTS: Record<string, EventConfig> = {
	newContact: {
		endpoint: '/contacts',
		label: 'contacts',
		defaultFields: 'id,lastname,firstname,email,phone,street1,postcode1,city1,country1,vatId,tags,legacyNumber',
	},
	newIncomingInvoice: { endpoint: '/incominginvoices', label: 'incoming invoices', defaultFields: '' },
	newOutgoingInvoice: {
		endpoint: '/outgoinginvoices',
		label: 'outgoing invoices',
		defaultFields: 'id,documentNumber,documentDate,customerName,gross',
	},
	newProduct: {
		endpoint: '/products',
		label: 'products',
		defaultFields: 'id,number,name,unit,singleAmount,singleAmountGross,productGroupName',
	},
};

/** Most records emitted by one poll. Anything beyond is picked up by the next poll. */
export const MAX_PER_POLL = 1000;

export class ScopevisioTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scopevisio Trigger',
		name: 'scopevisioTrigger',
		icon: { light: 'file:scopevisio.svg', dark: 'file:scopevisio.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when new records appear in Scopevisio',
		defaults: { name: 'Scopevisio Trigger' },
		credentials: [{ name: 'scopevisioApi', required: true }],
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'event',
				type: 'options',
				options: [
					{ name: 'New Contact', value: 'newContact' },
					{ name: 'New Incoming Invoice', value: 'newIncomingInvoice' },
					{ name: 'New Outgoing Invoice', value: 'newOutgoingInvoice' },
					{ name: 'New Product', value: 'newProduct' },
				],
				default: 'newOutgoingInvoice',
				required: true,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Fields',
						name: 'fields',
						type: 'string',
						default: '',
						description:
							'Comma-separated fields to return. Leave empty for the default set for the chosen event.',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const config = EVENTS[event];
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const requested = parseFieldList((options.fields as string | undefined) || config.defaultFields);
		// The id is the cursor, so it must always come back.
		const fields = requested.length && !requested.includes('id') ? ['id', ...requested] : requested;

		const staticData = this.getWorkflowStaticData('node') as { lastId?: number };

		const latest = async () =>
			scopevisioSearch.call(this, config.endpoint, buildSearchBody({ fields, orderField: 'id', orderDirection: 'desc' }), {
				returnAll: false,
				limit: 1,
				resource: config.label,
			});

		// Testing the node in the editor: show the newest record as sample data.
		if (this.getMode() === 'manual') {
			const sample = await latest();
			return sample.length ? [this.helpers.returnJsonArray(sample)] : null;
		}

		// First poll after activation: remember where we are, emit nothing.
		if (staticData.lastId === undefined) {
			const sample = await latest();
			staticData.lastId = Number(sample[0]?.id ?? 0) || 0;
			return null;
		}

		const lastId = staticData.lastId;
		const records = await scopevisioSearch.call(
			this,
			config.endpoint,
			buildSearchBody({
				conditions: [{ field: 'id', operator: 'greater', value: String(lastId) }],
				fields,
				orderField: 'id',
				orderDirection: 'asc',
			}),
			{ returnAll: false, limit: MAX_PER_POLL, resource: config.label },
		);

		const { fresh, nextCursor } = newRecordsSince(records, lastId);
		if (fresh.length === 0) return null;

		staticData.lastId = nextCursor;
		return [this.helpers.returnJsonArray(fresh)];
	}
}
