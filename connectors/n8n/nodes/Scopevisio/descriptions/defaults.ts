/**
 * Default field lists. A contact read without a field list returns more than
 * 400 fields, so each resource asks for a useful subset unless the user
 * overrides it. Every name here was checked against the live API.
 */
export const DEFAULT_FIELDS: Record<string, string> = {
	contact:
		'id,lastname,firstname,email,phone,street1,postcode1,city1,country1,vatId,tags,legacyNumber',
	product: 'id,number,name,unit,singleAmount,singleAmountGross,productGroupName',
	outgoingInvoice: 'id,documentNumber,documentDate,customerName,gross',
	incomingInvoice: '',
};
