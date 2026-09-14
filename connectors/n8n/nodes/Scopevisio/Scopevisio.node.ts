import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { accountFields, accountOperations } from './descriptions/AccountDescription';
import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { debitorFields, debitorOperations } from './descriptions/DebitorDescription';
import { DEFAULT_FIELDS } from './descriptions/defaults';
import {
	incomingInvoiceFields,
	incomingInvoiceOperations,
	outgoingInvoiceFields,
	outgoingInvoiceOperations,
} from './descriptions/InvoiceDescription';
import { productFields, productOperations } from './descriptions/ProductDescription';
import { reportFields, reportOperations } from './descriptions/ReportDescription';
import { taxFields, taxOperations } from './descriptions/TaxDescription';
import { scopevisioApiRequest, scopevisioSearch } from './GenericFunctions';
import {
	assertPostingConfirmed,
	buildSearchBody,
	extractRecords,
	fieldsNotApplied,
	formatScopevisioDate,
	mergeRevenueAccounts,
	parseFieldList,
	type SearchCondition,
} from './helpers';

/**
 * Why programmatic rather than declarative: several operations need more than
 * one request or logic between requests — paging a search until a short page,
 * merging two revenue-account endpoints, reading a contact back to catch fields
 * Scopevisio silently ignored, and returning a PDF as binary data.
 */

const SEARCH_ENDPOINT: Record<string, string> = {
	contact: '/contacts',
	product: '/products',
	outgoingInvoice: '/outgoinginvoices',
	incomingInvoice: '/incominginvoices',
};

const RESOURCE_LABEL: Record<string, string> = {
	contact: 'contacts',
	product: 'products',
	outgoingInvoice: 'outgoing invoices',
	incomingInvoice: 'incoming invoices',
};

function withoutEmpty(values: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === '' || value === undefined || value === null) continue;
		result[key] = value;
	}
	return result;
}

export class Scopevisio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scopevisio',
		name: 'scopevisio',
		icon: { light: 'file:scopevisio.svg', dark: 'file:scopevisio.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with contacts, debitors, products, invoices, tax master data and reports in Scopevisio',
		defaults: { name: 'Scopevisio' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scopevisioApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Debitor', value: 'debitor' },
					{ name: 'Incoming Invoice', value: 'incomingInvoice' },
					{ name: 'Outgoing Invoice', value: 'outgoingInvoice' },
					{ name: 'Product', value: 'product' },
					{ name: 'Report', value: 'report' },
					{ name: 'Tax', value: 'tax' },
				],
				default: 'contact',
			},
			...accountOperations,
			...accountFields,
			...contactOperations,
			...contactFields,
			...debitorOperations,
			...debitorFields,
			...incomingInvoiceOperations,
			...incomingInvoiceFields,
			...outgoingInvoiceOperations,
			...outgoingInvoiceFields,
			...productOperations,
			...productFields,
			...reportOperations,
			...reportFields,
			...taxOperations,
			...taxFields,
		],
	};

	methods = {
		loadOptions: {
			async getTaxCases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await scopevisioApiRequest.call(this, 'GET', '/vatscopes', {
					qs: { active: true },
					resource: 'tax cases',
				});
				return extractRecords<IDataObject>(response)
					.filter((record) => record.caseId !== undefined && record.caseId !== null)
					.map((record) => ({
						name: `${String(record.caseName ?? record.caseId)} (${String(record.caseId)})`,
						value: Number(record.caseId),
						description: String(record.caseDescription ?? ''),
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const push = (data: IDataObject | IDataObject[]) => {
					for (const json of Array.isArray(data) ? data : [data]) {
						returnData.push({ json, pairedItem: { item: i } });
					}
				};

				// ---- searches, shared by every resource that has one ---------------
				if (operation === 'getMany' && SEARCH_ENDPOINT[resource]) {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as {
						conditions?: SearchCondition[];
					};
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const body = buildSearchBody({
						conditions: filters.conditions,
						fields: (options.fields as string | undefined) ?? DEFAULT_FIELDS[resource],
						orderField: (options.sortField as string | undefined) ?? 'id',
						orderDirection: (options.sortDirection as 'asc' | 'desc' | undefined) ?? 'asc',
					});
					push(
						await scopevisioSearch.call(this, SEARCH_ENDPOINT[resource], body, {
							returnAll,
							limit,
							resource: RESOURCE_LABEL[resource],
							itemIndex: i,
						}),
					);
					continue;
				}

				// ---- account --------------------------------------------------------
				if (resource === 'account' && operation === 'get') {
					push(
						(await scopevisioApiRequest.call(this, 'GET', '/myaccount', {
							resource: 'the account',
							itemIndex: i,
						})) as IDataObject,
					);
					continue;
				}

				// ---- contact --------------------------------------------------------
				if (resource === 'contact') {
					if (operation === 'create') {
						const additional = withoutEmpty(this.getNodeParameter('additionalFields', i, {}) as IDataObject);
						const body: IDataObject = {
							...additional,
							lastname: this.getNodeParameter('lastname', i) as string,
							person: (this.getNodeParameter('contactType', i) as string) === 'person',
						};
						const response = (await scopevisioApiRequest.call(this, 'POST', '/contact/new', {
							body,
							resource: 'the new contact',
							itemIndex: i,
						})) as IDataObject;
						push({ id: response.contactId, ...response });
						continue;
					}

					if (operation === 'get') {
						const identifyBy = this.getNodeParameter('identifyBy', i) as string;
						const identifier = String(this.getNodeParameter('identifier', i)).trim();
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const fields = parseFieldList((options.fields as string | undefined) ?? DEFAULT_FIELDS.contact);
						push(
							(await scopevisioApiRequest.call(
								this,
								'GET',
								`/contact/${identifyBy}/${encodeURIComponent(identifier)}`,
								{
									qs: fields.length ? { fields: fields.join(',') } : undefined,
									resource: `contact ${identifier}`,
									itemIndex: i,
								},
							)) as IDataObject,
						);
						continue;
					}

					if (operation === 'count') {
						const filters = this.getNodeParameter('filters', i, {}) as { conditions?: SearchCondition[] };
						const response = (await scopevisioApiRequest.call(this, 'POST', '/contacts', {
							body: { ...buildSearchBody({ conditions: filters.conditions }), count: true } as IDataObject,
							resource: 'contacts',
							itemIndex: i,
						})) as IDataObject;
						push({ count: response.count });
						continue;
					}

					if (operation === 'update') {
						const contactId = String(this.getNodeParameter('contactId', i)).trim();
						const updateFields = withoutEmpty(this.getNodeParameter('updateFields', i, {}) as IDataObject);
						const { verify = true } = this.getNodeParameter('options', i, {}) as { verify?: boolean };
						if (Object.keys(updateFields).length === 0) {
							throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
								itemIndex: i,
							});
						}

						await scopevisioApiRequest.call(this, 'POST', `/contact/${encodeURIComponent(contactId)}`, {
							body: updateFields,
							resource: `contact ${contactId}`,
							itemIndex: i,
						});

						const readBack = (await scopevisioApiRequest.call(
							this,
							'GET',
							`/contact/${encodeURIComponent(contactId)}`,
							{
								qs: { fields: ['id', ...Object.keys(updateFields)].join(',') },
								resource: `contact ${contactId}`,
								itemIndex: i,
							},
						)) as IDataObject;

						const skipped = fieldsNotApplied(updateFields, readBack);
						if (verify && skipped.length) {
							throw new NodeOperationError(
								this.getNode(),
								`Scopevisio did not apply: ${skipped.join(', ')}`,
								{
									itemIndex: i,
									description:
										'Scopevisio accepted the update but left these fields unchanged. It ignores fields that do not apply, for example a first name on a company. Turn off "Verify Update" to accept this.',
								},
							);
						}
						push({ ...readBack, notApplied: skipped });
						continue;
					}
				}

				// ---- debitor --------------------------------------------------------
				if (resource === 'debitor' && operation === 'create') {
					const additional = withoutEmpty(this.getNodeParameter('additionalFields', i, {}) as IDataObject);
					for (const numeric of ['numberRangeNumber', 'paymentTermId']) {
						if (additional[numeric] === 0) delete additional[numeric];
					}
					const response = (await scopevisioApiRequest.call(this, 'POST', '/createdebitor', {
						body: { ...additional, contactId: this.getNodeParameter('contactId', i) as number },
						resource: 'the debitor account',
						itemIndex: i,
					})) as IDataObject;
					push(response ?? { success: true });
					continue;
				}

				// ---- product --------------------------------------------------------
				if (resource === 'product') {
					if (operation === 'create') {
						const additional = withoutEmpty(this.getNodeParameter('additionalFields', i, {}) as IDataObject);
						const response = (await scopevisioApiRequest.call(this, 'POST', '/product/new', {
							body: {
								...additional,
								name: this.getNodeParameter('name', i) as string,
								unit: this.getNodeParameter('unit', i) as string,
							},
							resource: 'the new product',
							itemIndex: i,
						})) as IDataObject;
						push(response);
						continue;
					}
					if (operation === 'get') {
						const productId = String(this.getNodeParameter('productId', i)).trim();
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const fields = parseFieldList((options.fields as string | undefined) ?? DEFAULT_FIELDS.product);
						push(
							(await scopevisioApiRequest.call(this, 'GET', `/product/${encodeURIComponent(productId)}`, {
								qs: fields.length ? { fields: fields.join(',') } : undefined,
								resource: `product ${productId}`,
								itemIndex: i,
							})) as IDataObject,
						);
						continue;
					}
				}

				// ---- outgoing invoice -----------------------------------------------
				if (resource === 'outgoingInvoice') {
					const documentNumber = String(this.getNodeParameter('documentNumber', i)).trim();
					const path = `/outgoinginvoice/${encodeURIComponent(documentNumber)}`;

					if (operation === 'get') {
						push(
							(await scopevisioApiRequest.call(this, 'GET', path, {
								resource: `invoice ${documentNumber}`,
								itemIndex: i,
							})) as IDataObject,
						);
						continue;
					}

					if (operation === 'downloadPdf') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const response = (await scopevisioApiRequest.call(this, 'GET', `${path}/file`, {
							binary: true,
							allowNotFound: true,
							resource: `the PDF of invoice ${documentNumber}`,
							itemIndex: i,
						})) as { body: ArrayBuffer | Buffer; headers?: IDataObject } | undefined;
						if (!response) {
							throw new NodeOperationError(this.getNode(), `Invoice ${documentNumber} has no PDF`, {
								itemIndex: i,
								description:
									'Scopevisio returns a file only once the invoice document has been rendered. Check the document number, or render the invoice in Scopevisio first.',
							});
						}

						const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
						const contentType = String(response.headers?.['content-type'] ?? 'application/pdf').split(';')[0];
						const fileName = `${documentNumber.replace(/[^\w.-]+/g, '_')}.pdf`;
						const binary = await this.helpers.prepareBinaryData(buffer, fileName, contentType);
						returnData.push({
							json: { documentNumber, fileName, mimeType: contentType, fileSize: buffer.length },
							binary: { [binaryPropertyName]: binary },
							pairedItem: { item: i },
						});
						continue;
					}

					if (operation === 'post') {
						try {
							assertPostingConfirmed(this.getNodeParameter('confirmPosting', i));
						} catch (error) {
							throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
						}
						const response = await scopevisioApiRequest.call(this, 'POST', `${path}/post`, {
							resource: `invoice ${documentNumber}`,
							itemIndex: i,
						});
						push({ documentNumber, posted: true, response: (response ?? null) as IDataObject });
						continue;
					}
				}

				// ---- incoming invoice -----------------------------------------------
				if (resource === 'incomingInvoice' && operation === 'get') {
					const invoiceId = String(this.getNodeParameter('invoiceId', i)).trim();
					push(
						(await scopevisioApiRequest.call(this, 'GET', `/incominginvoice/${encodeURIComponent(invoiceId)}`, {
							resource: `incoming invoice ${invoiceId}`,
							itemIndex: i,
						})) as IDataObject,
					);
					continue;
				}

				// ---- tax ------------------------------------------------------------
				if (resource === 'tax') {
					if (operation === 'getTaxCases') {
						const activeOnly = this.getNodeParameter('activeOnly', i) as boolean;
						const response = await scopevisioApiRequest.call(this, 'GET', '/vatscopes', {
							qs: activeOnly ? { active: true } : undefined,
							resource: 'tax cases',
							itemIndex: i,
						});
						push(extractRecords<IDataObject>(response));
						continue;
					}

					if (operation === 'getVatMatrix') {
						const response = await scopevisioApiRequest.call(this, 'GET', '/vatmatrixentries', {
							resource: 'the VAT matrix',
							itemIndex: i,
						});
						push(extractRecords<IDataObject>(response));
						continue;
					}

					if (operation === 'resolveRevenueAccounts') {
						const country = String(this.getNodeParameter('country', i)).trim().toUpperCase();
						if (!/^[A-Z]{2}$/.test(country)) {
							throw new NodeOperationError(this.getNode(), `"${country}" is not a two-letter country code`, {
								itemIndex: i,
							});
						}
						const qs: IDataObject = {
							country,
							vatScope: Number(this.getNodeParameter('taxCaseId', i)),
							servicesRenderedDate: formatScopevisioDate(
								this.getNodeParameter('servicesRenderedDate', i) as string,
							),
							pageSize: 500,
						};
						if (this.getNodeParameter('activeOnly', i) as boolean) qs.active = true;

						// Both endpoints are needed: /products lists only product-specific
						// accounts and excludes products that use the standard ones.
						const fetchAccounts = async (endpoint: string) =>
							extractRecords<IDataObject>(
								await scopevisioApiRequest.call(this, 'GET', endpoint, {
									qs,
									allowNotFound: true,
									resource: 'revenue accounts',
									itemIndex: i,
								}),
							);
						const [productAccounts, standardAccounts] = await Promise.all([
							fetchAccounts('/revenueaccounts/products'),
							fetchAccounts('/revenueaccounts/standard'),
						]);
						push(mergeRevenueAccounts(productAccounts, standardAccounts));
						continue;
					}
				}

				// ---- report ---------------------------------------------------------
				if (resource === 'report' && operation === 'getRows') {
					const datasource = this.getNodeParameter('datasource', i) as string;
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const response = await scopevisioApiRequest.call(this, 'GET', `/datasource/${datasource}`, {
						qs: {
							startDate: formatScopevisioDate(this.getNodeParameter('startDate', i) as string),
							endDate: formatScopevisioDate(this.getNodeParameter('endDate', i) as string),
						},
						resource: `the ${datasource} report`,
						itemIndex: i,
					});
					const rows = extractRecords<IDataObject>(response);
					push(returnAll ? rows : rows.slice(0, this.getNodeParameter('limit', i) as number));
					continue;
				}

				throw new NodeOperationError(
					this.getNode(),
					`The operation "${operation}" is not supported for "${resource}"`,
					{ itemIndex: i },
				);
			} catch (error) {
				if (this.continueOnFail()) {
					const description = (error as { description?: unknown }).description;
					returnData.push({
						json: {
							error: (error as Error).message,
							...(typeof description === 'string' && description ? { description } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				// Both constructors hand back an error that is already of their type, so
				// wrapping keeps the HTTP code and description the transport attached.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
