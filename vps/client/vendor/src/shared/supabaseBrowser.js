/**
 * Browser Supabase client for chat bundle (`src/shared/` copy; keep aligned with `public/shared/supabaseBrowser.js`).
 */

import { createClient } from '@supabase/supabase-js';

const PRSN_DEBUG_SUPABASE_SESSION = true;

const BROWSER_CLIENT_KEY = '__PRSN_SUPABASE_BROWSER_CLIENT__';

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

export function getSupabaseBrowserClient() {
	const cfg = getSupabaseBrowserConfig();
	if (!cfg) return null;
	const w = typeof window !== 'undefined' ? window : null;
	if (w && w[BROWSER_CLIENT_KEY]) {
		return w[BROWSER_CLIENT_KEY];
	}
	const client = createClient(cfg.url, cfg.anonKey, {
		auth: {
			autoRefreshToken: true,
			persistSession: true,
			detectSessionInUrl: false,
			storage: w ? w.localStorage : undefined
		}
	});
	if (w) {
		w[BROWSER_CLIENT_KEY] = client;
	}
	return client;
}

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

export async function signOutSupabaseIfConfigured() {
	const sb = getSupabaseBrowserClient();
	if (!sb) return;
	try {
		await sb.auth.signOut();
	} catch {
		// ignore
	}
}
