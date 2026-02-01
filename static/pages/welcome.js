import { fetchJsonWithStatusDeduped } from '../shared/api.js';

function $(sel) {
	return document.querySelector(sel);
}

function showError(message) {
	const box = $('[data-error]');
	if (!box) return;
	const text = String(message || '').trim() || 'Something went wrong.';
	box.textContent = text;
	box.hidden = false;
}

function hideError() {
	const box = $('[data-error]');
	if (!box) return;
	box.textContent = '';
	box.hidden = true;
}

function showSuggestion(suggested) {
	const el = document.querySelector('[data-suggestion]');
	if (!el) return;
	const value = typeof suggested === 'string' ? suggested.trim() : '';
	if (!value) {
		el.textContent = '';
		el.hidden = true;
		return;
	}
	el.innerHTML = `Suggestion: <strong>@${value}</strong>`;
	el.hidden = false;
}

function hideSuggestion() {
	const el = document.querySelector('[data-suggestion]');
	if (!el) return;
	el.textContent = '';
	el.hidden = true;
}

function normalizeUsername(input) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return null;
	const normalized = raw.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
	return normalized;
}

function suggestUsernameFromEmail(email) {
	const rawEmail = typeof email === 'string' ? email.trim() : '';
	if (!rawEmail) return null;

	const localPart = rawEmail.includes('@') ? rawEmail.split('@')[0] : rawEmail;
	if (!localPart) return null;

	let candidate = localPart.toLowerCase();
	candidate = candidate.replace(/[^a-z0-9_]+/g, '_');
	candidate = candidate.replace(/_+/g, '_');

	// Must start with [a-z0-9]
	candidate = candidate.replace(/^[^a-z0-9]+/g, '');
	// Keep within allowed max (24)
	candidate = candidate.slice(0, 24);
	// Ensure min length (3) without changing the "feel" too much
	if (candidate.length > 0 && candidate.length < 3) {
		candidate = (candidate + '_user').slice(0, 24);
	}

	return normalizeUsername(candidate);
}

async function loadProfile() {
	return await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 0 });
}

async function ensureNeedsWelcome() {
	const result = await loadProfile().catch(() => ({ ok: false, status: 0, data: null }));
	if (!result.ok) {
		if (result.status === 401) {
			window.location.href = '/auth.html';
			return null;
		}
		showError('Unable to load your account. Please refresh and try again.');
		return null;
	}

	const welcome = result.data?.welcome || null;
	if (welcome && welcome.required === false) {
		window.location.href = '/';
		return null;
	}

	return result.data;
}

async function submitUserName(userName) {
	return await fetchJsonWithStatusDeduped('/api/profile', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ user_name: userName })
	}, { windowMs: 0 });
}

async function fetchSuggestedUsername(userName) {
	const params = new URLSearchParams({ user_name: userName });
	return await fetchJsonWithStatusDeduped(`/api/username-suggest?${params.toString()}`, { credentials: 'include' }, { windowMs: 0 });
}

async function init() {
	const form = $('[data-form]');
	const input = $('[data-username]');
	const submit = $('[data-submit]');

	if (!form || !(input instanceof HTMLInputElement) || !(submit instanceof HTMLButtonElement)) {
		return;
	}

	hideError();
	hideSuggestion();

	const user = await ensureNeedsWelcome();
	if (!user) return;

	if (!input.value.trim()) {
		const email = user?.email ?? user?.user?.email ?? null;
		const suggested = suggestUsernameFromEmail(email);
		if (suggested) {
			input.value = suggested;
			const check = await fetchSuggestedUsername(suggested).catch(() => ({ ok: false, status: 0, data: null }));
			if (check.ok && check.data?.suggested && typeof check.data.suggested === 'string' && check.data.suggested !== suggested) {
				showSuggestion(check.data.suggested);
			}
		}
	}

	try { input.focus(); } catch { /* ignore */ }

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		hideError();
		hideSuggestion();

		const normalized = normalizeUsername(input.value);
		if (!normalized) {
			showError('Username must be 3–24 chars, lowercase letters/numbers/underscore, starting with a letter/number.');
			return;
		}

		submit.disabled = true;
		try {
			const result = await submitUserName(normalized).catch(() => ({ ok: false, status: 0, data: null }));
			if (!result.ok) {
				if (result.status === 409 && String(result.data?.error || '').toLowerCase().includes('taken')) {
					const check = await fetchSuggestedUsername(normalized).catch(() => ({ ok: false, status: 0, data: null }));
					const next = check.ok ? check.data?.suggested : null;
					if (typeof next === 'string' && next && next !== normalized) {
						showError('Tey again. That name already is taken.');
						showSuggestion(next);
						try { input.focus(); } catch { /* ignore */ }
						return;
					}
				}
				const message =
					result.data?.message ||
					result.data?.error ||
					(result.status === 409 ? 'That username is unavailable.' : 'Failed to save username.');
				showError(message);
				return;
			}

			window.location.href = '/';
		} finally {
			submit.disabled = false;
		}
	});
}

document.addEventListener('DOMContentLoaded', () => {
	void init();
});

