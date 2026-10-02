import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeAuthStore } from '../db/realtimeAuth.js';

test('cookie-auth bridge derives the WWW identity password and returns only viewer session credentials', async () => {
	const previousSecret = process.env.SESSION_SECRET;
	const previousAnon = process.env.SUPABASE_ANON_KEY;
	process.env.SESSION_SECRET = 'fixture-secret';
	process.env.SUPABASE_ANON_KEY = 'fixture-anon';
	try {
		let credentials;
		const store = createRealtimeAuthStore({ client: {}, supabaseUrl: 'https://fixture.supabase.co' }, { byId: async () => ({ email: 'Viewer@example.com', meta: {} }) }, {
			anonFactory: () => ({ auth: { async signInWithPassword(value) {
				credentials = value;
				return { data: { session: { access_token: 'fixture-access', refresh_token: 'fixture-refresh' } } };
			} } }),
		});
		const session = await store.session(7);
		assert.equal(credentials.email, 'viewer@example.com');
		assert.equal(credentials.password, crypto.createHmac('sha256', 'fixture-secret').update('prsn:7').digest('base64url').slice(0, 48));
		assert.deepEqual(Object.keys(session).sort(), ['access_token', 'anonKey', 'refresh_token', 'url', 'viewer_id']);
		assert.equal(session.viewer_id, 7);
	} finally {
		if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
		if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previousAnon;
	}
});

test('suspended app users cannot establish a realtime session', async () => {
	const previousSecret = process.env.SESSION_SECRET;
	const previousAnon = process.env.SUPABASE_ANON_KEY;
	process.env.SESSION_SECRET = 'fixture-secret'; process.env.SUPABASE_ANON_KEY = 'fixture-anon';
	try {
		let clientCreated = false;
		const store = createRealtimeAuthStore({ client: {}, supabaseUrl: 'https://fixture.supabase.co' }, { byId: async () => ({ email: 'viewer@example.com', meta: { suspended: true } }) }, { anonFactory: () => { clientCreated = true; } });
		await assert.rejects(store.session(7), (error) => error.status === 403);
		assert.equal(clientCreated, false);
	} finally {
		if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
		if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previousAnon;
	}
});
