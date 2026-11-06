import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import createOAuthIntegrationRoutes from '../api_routes/oauthIntegration.js';

function hashTokenHex(token) {
	return crypto.createHash('sha256').update(token).digest('hex');
}

function b64url(buf) {
	return Buffer.from(buf)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

async function postForm(baseUrl, path, fields) {
	const body = new URLSearchParams(fields).toString();
	const res = await fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	return { status: res.status, body: json };
}

describe('OAuth public client token exchange', () => {
	let server;
	let baseUrl;
	let codes;
	let grants;
	const publicClient = {
		id: 10,
		client_id: 'public-app-uuid',
		owner_user_id: 1,
		name: 'Desktop',
		redirect_uris: ['http://127.0.0.1:17423/oauth/callback'],
		meta: { client_type: 'public', token_endpoint_auth_method: 'none' }
	};
	const confidentialClient = {
		id: 11,
		client_id: 'confidential-app-uuid',
		owner_user_id: 1,
		name: 'Web',
		redirect_uris: ['https://example.com/callback'],
		meta: { client_type: 'confidential' }
	};

	beforeEach(async () => {
		codes = new Map();
		grants = [];
		const queries = {
			selectOauthClientByPublicClientId: {
				get: async (id) => {
					if (id === publicClient.client_id) return publicClient;
					if (id === confidentialClient.client_id) return confidentialClient;
					return undefined;
				}
			},
			consumeOAuthAuthorizationCode: {
				get: async (codeHash) => {
					const row = codes.get(codeHash);
					if (!row || row.consumed) return undefined;
					row.consumed = true;
					return {
						oauth_client_id: row.oauth_client_id,
						redirect_uri: row.redirect_uri,
						code_challenge: row.code_challenge,
						user_id: row.user_id
					};
				}
			},
			revokeOAuthGrantsForUserClient: {
				run: async () => {
					grants = [];
				}
			},
			insertOAuthGrant: {
				run: async ({ userId, oauthClientInternalId, refreshTokenHash, scopes }) => {
					grants.push({
						id: grants.length + 1,
						user_id: userId,
						oauth_client_id: oauthClientInternalId,
						refresh_token_hash: refreshTokenHash,
						scopes,
						public_client_id:
							oauthClientInternalId === publicClient.id
								? publicClient.client_id
								: confidentialClient.client_id
					});
				}
			},
			selectOAuthGrantByRefreshTokenHash: {
				get: async (hash) => grants.find((g) => g.refresh_token_hash === hash)
			},
			updateOAuthGrantRefreshToken: {
				run: async (id, newHash) => {
					const g = grants.find((x) => x.id === id);
					if (g) g.refresh_token_hash = newHash;
				}
			}
		};

		const app = express();
		app.use(express.json());
		app.use(express.urlencoded({ extended: false }));
		app.use((req, _res, next) => {
			req.auth = null;
			next();
		});
		app.use(createOAuthIntegrationRoutes({ queries }));

		server = http.createServer(app);
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address();
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		if (server) {
			await new Promise((resolve) => server.close(resolve));
			server = null;
		}
	});

	it('allows public clients to exchange code with PKCE and no API key', async () => {
		const verifier = b64url(crypto.randomBytes(32));
		const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
		const code = 'test-auth-code';
		codes.set(hashTokenHex(code), {
			oauth_client_id: publicClient.id,
			redirect_uri: 'http://127.0.0.1:17423/oauth/callback',
			code_challenge: challenge,
			user_id: 42,
			consumed: false
		});

		const res = await postForm(baseUrl, '/oauth/token', {
			grant_type: 'authorization_code',
			client_id: publicClient.client_id,
			code,
			redirect_uri: 'http://127.0.0.1:17423/oauth/callback',
			code_verifier: verifier
		});

		expect(res.status).toBe(200);
		expect(res.body.access_token).toBeTruthy();
		expect(res.body.refresh_token).toMatch(/^prt_/);
		expect(res.body.token_type).toBe('Bearer');
	});

	it('still requires psn_ for confidential clients', async () => {
		const res = await postForm(baseUrl, '/oauth/token', {
			grant_type: 'authorization_code',
			client_id: confidentialClient.client_id,
			code: 'x',
			redirect_uri: 'https://example.com/callback',
			code_verifier: 'a'.repeat(43)
		});
		expect(res.status).toBe(401);
		expect(res.body.error).toBe('invalid_client');
	});
});
