import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Scopevisio OpenScope credentials.
 *
 * OpenScope issues short-lived access tokens from `POST /rest/token`. Rather
 * than asking users to paste an access token that expires within hours, the
 * credential stores a long-lived secret (a refresh token, or a username and
 * password) and exchanges it for an access token on demand.
 *
 * The access token lives in a hidden `expirable` field. n8n calls
 * `preAuthentication` whenever that field is empty or a request comes back 401,
 * and persists whatever this method returns — so a refresh token that
 * Scopevisio rotates is written back rather than lost.
 */
export class ScopevisioApi implements ICredentialType {
	name = 'scopevisioApi';

	displayName = 'Scopevisio API';

	icon: Icon = {
		light: 'file:../nodes/Scopevisio/scopevisio.svg',
		dark: 'file:../nodes/Scopevisio/scopevisio.dark.svg',
	};

	documentationUrl =
		'https://github.com/marfoerst/erp-connectors/tree/main/connectors/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Authentication Method',
			name: 'authMethod',
			type: 'options',
			options: [
				{
					name: 'Refresh Token',
					value: 'refreshToken',
					description:
						'Recommended. No password is stored, and it works for users with two-factor authentication.',
				},
				{
					name: 'Username and Password',
					value: 'password',
					description: 'Does not work for users with two-factor authentication enabled',
				},
			],
			default: 'refreshToken',
		},
		{
			displayName: 'Customer Number',
			name: 'customer',
			type: 'string',
			default: '',
			required: true,
			placeholder: '1234567',
			description: 'Your seven-digit Scopevisio customer number',
		},
		{
			displayName: 'Organisation',
			name: 'organisation',
			type: 'string',
			default: '',
			description:
				'Only needed when the user belongs to more than one organisation. Leave empty to use the default one.',
		},
		{
			displayName: 'Refresh Token',
			name: 'refreshToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['refreshToken'] } },
			description:
				'Create one in Scopevisio under Account → Schnittstelle (OpenScope) → API Token',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'name@example.com',
			displayOptions: { show: { authMethod: ['password'] } },
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authMethod: ['password'] } },
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://appload.scopevisio.com',
			description: 'Only change this if Scopevisio has given you a different API host',
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const baseUrl = String(credentials.baseUrl || 'https://appload.scopevisio.com').replace(
			/\/+$/,
			'',
		);

		const params = new URLSearchParams();
		params.set('customer', String(credentials.customer ?? '').trim());
		const organisation = String(credentials.organisation ?? '').trim();
		if (organisation) params.set('organisation', organisation);

		if (credentials.authMethod === 'password') {
			params.set('grant_type', 'password');
			params.set('username', String(credentials.username ?? ''));
			params.set('password', String(credentials.password ?? ''));
		} else {
			params.set('grant_type', 'refresh_token');
			params.set('refresh_token', String(credentials.refreshToken ?? ''));
		}

		const response = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${baseUrl}/rest/token`,
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json',
			},
			body: params.toString(),
		})) as IDataObject | string;

		const token = (typeof response === 'string' ? JSON.parse(response) : response) as IDataObject;

		const output: IDataObject = { accessToken: token.access_token };
		// Persist a rotated refresh token so the credential keeps working even if
		// Scopevisio starts invalidating the previous one on rotation.
		if (credentials.authMethod !== 'password' && typeof token.refresh_token === 'string') {
			output.refreshToken = token.refresh_token;
		}
		return output;
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/rest',
			url: '/myaccount',
		},
	};
}
