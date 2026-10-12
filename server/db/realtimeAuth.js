import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }

// WWW cookie-auth bridge. Derive the same password so WWW and beta sessions
// address the same Supabase identity and private room/user broadcast policies.
export function createRealtimeAuthStore({ client: admin, supabaseUrl }, users, { anonFactory = createClient } = {}) {
	return {
		async session(userId) {
			const secret = process.env.SESSION_SECRET?.trim();
			const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
			if (!secret || !anonKey) fail(503, 'Realtime authentication is not configured');
			const user = await users.byId(userId);
			if (!user || user.meta?.suspended) fail(403, 'Account unavailable');
			const email = user.email?.trim().toLowerCase();
			if (!email?.includes('@')) fail(400, 'User email missing');
			const password = crypto.createHmac('sha256', secret).update(`prsn:${Number(userId)}`).digest('base64url').slice(0, 48);
			const anon = anonFactory(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
			let signed = await anon.auth.signInWithPassword({ email, password });
			if (!signed.data?.session) {
				const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { prsn_user_id: Number(userId) } });
				if (created.error) {
					if (created.error.code !== 'user_already_exists' && !/already.*registered/i.test(created.error.message || '')) throw created.error;
					let existing = null;
					for (let page = 1; page <= 10 && !existing; page++) {
						const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
						if (error) throw error;
						existing = data.users.find((row) => row.email?.toLowerCase() === email);
						if (data.users.length < 200) break;
					}
					if (!existing) fail(503, 'Unable to resolve realtime identity');
					const updated = await admin.auth.admin.updateUserById(existing.id, { password, user_metadata: { ...existing.user_metadata, prsn_user_id: Number(userId) } });
					if (updated.error) throw updated.error;
				}
				signed = await anon.auth.signInWithPassword({ email, password });
			}
			if (signed.error || !signed.data?.session) fail(503, 'Unable to establish realtime session');
			const session = signed.data.session;
			return { url: supabaseUrl, anonKey, viewer_id: Number(userId), access_token: session.access_token, refresh_token: session.refresh_token };
		},
	};
}
