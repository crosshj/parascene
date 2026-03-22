/**
 * Browser Supabase client for Realtime (Phase 1). Requires `window.__PRSN_SUPABASE__` from the server
 * and an import map for `@supabase/supabase-js` (see api_routes/utils/head.js).
 */

import { createClient } from '@supabase/supabase-js';

/** Set to false (or remove logs) once Phase 1 / Realtime is validated. */
const PRSN_DEBUG_SUPABASE_SESSION = true;

let _client = null;

export function getSupabaseBrowserConfig() {
	try {
		if (typeof window === 'undefined') return null;
		const c = window.__PRSN_SUPABASE__;
		if (!c || typeof c.url !== 'string' || typeof c.anonKey !== 'string') return null;
		return { url: c.url.trim(), anonKey: c.anonKey.trim() };
	} catch {
		return null;
	}
}

/** Singleton anon client; persists session in localStorage by default. */
export function getSupabaseBrowserClient() {
	const cfg = getSupabaseBrowserConfig();
	if (!cfg) return null;
	if (!_client) {
		_client = createClient(cfg.url, cfg.anonKey, {
			auth: {
				autoRefreshToken: true,
				persistSession: true,
				detectSessionInUrl: false,
				storage: typeof window !== 'undefined' ? window.localStorage : undefined
			}
		});
	}
	return _client;
}

/**
 * Ensure Supabase Auth has a session (for private Realtime). Calls POST /api/auth/supabase-session when needed.
 * @returns {Promise<import('@supabase/supabase-js').Session | null>}
 */
export async function ensureSupabaseSessionForApp() {
	const sb = getSupabaseBrowserClient();
	if (!sb) return null;

	const { data: existing } = await sb.auth.getSession();
	if (existing?.session?.access_token) {
		if (PRSN_DEBUG_SUPABASE_SESSION) {
			console.log('[Parascene] Supabase Auth session ready (restored from storage)');
		}
		return existing.session;
	}

	let res;
	try {
		res = await fetch('/api/auth/supabase-session', {
			method: 'POST',
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
	} catch {
		return null;
	}

	if (res.status === 503) {
		return null;
	}
	if (!res.ok) {
		return null;
	}

	let body;
	try {
		body = await res.json();
	} catch {
		return null;
	}
	if (!body?.access_token || !body?.refresh_token) {
		return null;
	}

	const { data, error } = await sb.auth.setSession({
		access_token: body.access_token,
		refresh_token: body.refresh_token
	});
	if (error || !data?.session) {
		return null;
	}
	if (PRSN_DEBUG_SUPABASE_SESSION) {
		console.log('[Parascene] Supabase Auth session ready (from /api/auth/supabase-session)');
	}
	return data.session;
}

/** Call before full page navigation to logout (cookie cleared server-side separately). */
export async function signOutSupabaseIfConfigured() {
	const sb = getSupabaseBrowserClient();
	if (!sb) return;
	try {
		await sb.auth.signOut();
	} catch {
		// ignore
	}
}
