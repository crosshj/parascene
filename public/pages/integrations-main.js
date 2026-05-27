function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

async function invalidateOwnPublicProfileCache(profileUser) {
	const userId = Number(profileUser?.id);
	if (!Number.isFinite(userId) || userId <= 0) return;
	try {
		const qs = getImportQuery(getAssetVersionParam());
		const { invalidateAppCaches } = await import(`/shared/api.js${qs}`);
		invalidateAppCaches({ urls: [`/api/users/${userId}/profile`] });
	} catch {
		// ignore
	}
}

function escapeHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function parseUriLines(text) {
	const raw = typeof text === 'string' ? text : '';
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function validateRedirectUris(uris) {
	for (const u of uris) {
		try {
			const parsed = new URL(u);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				return `Invalid URL (use http or https): ${u}`;
			}
		} catch {
			return `Invalid URL: ${u}`;
		}
	}
	return null;
}

function setStatus(el, message, variant) {
	if (!el) return;
	el.textContent = message || '';
	if (variant) {
		el.setAttribute('data-variant', variant);
	} else {
		el.removeAttribute('data-variant');
	}
}

async function fetchJson(url, options = {}) {
	const r = await fetch(url, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
		...options
	});
	let data = {};
	try {
		data = await r.json();
	} catch {
		data = {};
	}
	return { ok: r.ok, status: r.status, data };
}

function renderAppCard(app) {
	const id = app.client_id;
	const uris = Array.isArray(app.redirect_uris) ? app.redirect_uris : [];
	const uriItems = uris.map((u) => `<li>${escapeHtml(u)}</li>`).join('');
	return `
<div class="integrations-card" data-client-id="${escapeHtml(id)}">
	<h4 class="integrations-card-title">${escapeHtml(app.name || 'App')}</h4>
	<div class="integrations-client-row">
		<span class="integrations-client-label">Public app ID</span>
		<code>${escapeHtml(id)}</code>
		<button type="button" class="btn-secondary" data-action="copy" title="Copy app ID">Copy</button>
	</div>
	<p class="integrations-uri-caption">Redirect URLs</p>
	<ul class="integrations-uri-list">${uriItems || '<li>(none)</li>'}</ul>
	<div class="integrations-actions">
		<button type="button" class="btn-secondary" data-action="edit">Edit</button>
		<button type="button" class="btn-secondary is-logout" data-action="delete">Delete</button>
	</div>
</div>`;
}

function renderGrantCard(g) {
	const name = escapeHtml(g.app_name || g.public_client_id || 'App');
	const id = Number(g.id);
	const when =
		g.created_at && typeof g.created_at === 'string'
			? escapeHtml(new Date(g.created_at).toLocaleString())
			: '';
	return `
<div class="integrations-grant-card" data-grant-id="${Number.isFinite(id) ? id : ''}">
	<div class="integrations-grant-meta">
		<span class="integrations-grant-name">${name}</span>
		${when ? `<span class="integrations-grant-date">${when}</span>` : ''}
	</div>
	<button type="button" class="btn-secondary is-logout" data-action="revoke-grant">Revoke</button>
</div>`;
}

function renderParasceneApiBlock(user, revealedKey) {
	const hasKey = user?.hasApiKey === true;
	const apiKeyMasked = '•'.repeat(24);
	const revealBlock = revealedKey
		? `<div class="integrations-api-reveal" role="status" aria-label="New API key shown once; copy before closing.">
		<div class="integrations-api-reveal-row">
			<code class="integrations-api-reveal-code">${escapeHtml(revealedKey)}</code>
			<button type="button" class="btn-secondary" data-int-api-copy>Copy</button>
		</div>
	</div>`
		: '';
	const keyActions = hasKey
		? `<div class="integrations-credential-row">
		<span class="integrations-api-masked" aria-label="Credential on file">${apiKeyMasked}</span>
		<button type="button" class="btn-secondary is-logout" data-int-api-remove>Remove</button>
	</div>`
		: `<div class="integrations-credential-actions">
		<button type="button" class="btn-secondary" data-int-api-generate>Generate</button>
	</div>`;
	return revealBlock + keyActions;
}

function renderVynlyBlock(user) {
	const hasVynly = user?.hasVynlyToken === true;
	const tokenMasked = '•'.repeat(24);
	return hasVynly
		? `<div class="integrations-credential-row">
		<span class="integrations-api-masked" aria-label="Credential on file">${tokenMasked}</span>
		<button type="button" class="btn-secondary is-logout" data-int-vynly-remove>Remove</button>
	</div>`
		: `<div class="integrations-credential-row integrations-credential-row--input">
		<input type="password" class="integrations-api-input" data-int-vynly-input autocomplete="new-password" placeholder="vln_…" spellcheck="false" />
		<button type="button" class="btn-secondary" data-int-vynly-save>Save</button>
	</div>`;
}

function renderGooglePhotosBlock(status) {
	const configured = status?.configured === true;
	const connected = status?.connected === true;
	const albumTitle =
		typeof status?.albumTitle === 'string' && status.albumTitle.trim()
			? status.albumTitle.trim()
			: 'Parascene';

	if (!configured) {
		return `<p class="integrations-intro">Google Photos is not configured on this environment.</p>`;
	}

	if (!connected) {
		return `<div class="integrations-credential-actions">
		<button type="button" class="btn-secondary" data-int-google-photos-connect>Connect</button>
	</div>`;
	}

	return `<div class="integrations-credential-row">
		<span class="integrations-api-masked" aria-label="Default album">${escapeHtml(albumTitle)}</span>
		<button type="button" class="btn-secondary is-logout" data-int-google-photos-disconnect>Disconnect</button>
	</div>`;
}

async function main() {
	const apiMount = document.querySelector('[data-integrations-credential-api]');
	const vynlyMount = document.querySelector('[data-integrations-credential-vynly]');
	const googlePhotosMount = document.querySelector('[data-integrations-credential-google-photos]');
	const listEl = document.querySelector('[data-integrations-list]');
	const emptyEl = document.querySelector('[data-integrations-empty]');
	const grantsListEl = document.querySelector('[data-integrations-grants-list]');
	const grantsEmptyEl = document.querySelector('[data-integrations-grants-empty]');
	const statusEl = document.querySelector('[data-integrations-status]');
	const dialogEl = document.querySelector('[data-integrations-dialog]');
	const dialogTitle = dialogEl?.querySelector('[data-dialog-title]');
	const dialogName = dialogEl?.querySelector('[data-dialog-name]');
	const dialogUris = dialogEl?.querySelector('[data-dialog-uris]');
	const dialogClientWrap = dialogEl?.querySelector('[data-dialog-client-id-wrap]');
	const dialogClientId = dialogEl?.querySelector('[data-dialog-client-id]');
	const btnSave = dialogEl?.querySelector('[data-dialog-save]');
	const btnCancel = dialogEl?.querySelector('[data-dialog-cancel]');

	let profileUser = null;
	let revealedApiKey = null;
	let apps = [];
	let grants = [];
	let googlePhotosStatus = null;
	/** @type {string | null} null = create mode */
	let editingPublicClientId = null;

	function renderCredentials() {
		if (apiMount) {
			apiMount.innerHTML = profileUser ? renderParasceneApiBlock(profileUser, revealedApiKey) : '';
		}
		if (vynlyMount) {
			vynlyMount.innerHTML = profileUser ? renderVynlyBlock(profileUser) : '';
		}
		if (googlePhotosMount) {
			googlePhotosMount.innerHTML = renderGooglePhotosBlock(googlePhotosStatus);
		}
	}

	function openDialogCreate() {
		editingPublicClientId = null;
		if (dialogTitle) dialogTitle.textContent = 'Register an app';
		if (dialogClientWrap) dialogClientWrap.hidden = true;
		if (dialogName) dialogName.value = '';
		if (dialogUris) dialogUris.value = '';
		dialogEl?.showModal?.();
		dialogName?.focus?.();
	}

	function openDialogEdit(app) {
		const id = app.client_id;
		const uris = Array.isArray(app.redirect_uris) ? app.redirect_uris : [];
		editingPublicClientId = id;
		if (dialogTitle) dialogTitle.textContent = 'Edit app';
		if (dialogClientWrap && dialogClientId) {
			dialogClientWrap.hidden = false;
			dialogClientId.textContent = id;
		}
		if (dialogName) dialogName.value = typeof app.name === 'string' ? app.name : '';
		if (dialogUris) dialogUris.value = uris.join('\n');
		dialogEl?.showModal?.();
		dialogName?.focus?.();
	}

	function closeDialog() {
		dialogEl?.close?.();
		editingPublicClientId = null;
	}

	document.querySelector('[data-open-register-dialog]')?.addEventListener('click', () => {
		setStatus(statusEl, '');
		openDialogCreate();
	});

	btnCancel?.addEventListener('click', () => {
		setStatus(statusEl, '');
		closeDialog();
	});

	dialogEl?.addEventListener('cancel', (e) => {
		e.preventDefault();
		closeDialog();
	});

	btnSave?.addEventListener('click', async () => {
		const name = typeof dialogName?.value === 'string' ? dialogName.value.trim() : '';
		const uris = parseUriLines(dialogUris?.value);
		const bad = validateRedirectUris(uris);
		if (!name) {
			setStatus(statusEl, 'Enter a display name.', 'error');
			return;
		}
		if (uris.length < 1) {
			setStatus(statusEl, 'Add at least one redirect URL (one per line).', 'error');
			return;
		}
		if (bad) {
			setStatus(statusEl, bad, 'error');
			return;
		}
		setStatus(statusEl, '');

		if (editingPublicClientId) {
			const res = await fetchJson(`/api/integration/apps/${encodeURIComponent(editingPublicClientId)}`, {
				method: 'PATCH',
				body: JSON.stringify({ name, redirect_uris: uris })
			});
			if (!res.ok) {
				setStatus(statusEl, res.data?.message || res.data?.error || 'Could not save.', 'error');
				return;
			}
			closeDialog();
			await load();
			setStatus(statusEl, 'Saved.', 'ok');
			return;
		}

		if (btnSave) btnSave.disabled = true;
		const res = await fetchJson('/api/integration/apps', {
			method: 'POST',
			body: JSON.stringify({ name, redirect_uris: uris })
		});
		if (btnSave) btnSave.disabled = false;
		if (!res.ok) {
			setStatus(statusEl, res.data?.message || res.data?.error || 'Could not create app.', 'error');
			return;
		}
		closeDialog();
		await load();
		setStatus(statusEl, 'App created. Copy the public app ID from the card if you need it elsewhere.', 'ok');
	});

	apiMount?.addEventListener('click', async (e) => {
		const gen = e.target.closest?.('[data-int-api-generate]');
		const rem = e.target.closest?.('[data-int-api-remove]');
		const copy = e.target.closest?.('[data-int-api-copy]');
		if (gen) {
			e.preventDefault();
			try {
				const res = await fetchJson('/api/profile/api-key', { method: 'POST' });
				if (res.ok && typeof res.data?.apiKey === 'string') {
					revealedApiKey = res.data.apiKey;
					if (profileUser) {
						profileUser.hasApiKey = true;
						profileUser.apiKeyPrefix = `${res.data.apiKey.slice(0, 10)}…`;
					}
					renderCredentials();
					await invalidateOwnPublicProfileCache(profileUser);
				}
			} catch {
				// ignore
			}
			return;
		}
		if (rem) {
			e.preventDefault();
			if (!window.confirm('Remove this API key? Apps using it will stop working.')) return;
			try {
				const res = await fetchJson('/api/profile/api-key', { method: 'DELETE' });
				if (res?.ok) {
					revealedApiKey = null;
					if (profileUser) {
						profileUser.hasApiKey = false;
						profileUser.apiKeyPrefix = null;
					}
					await refreshProfileOnly();
					renderCredentials();
					await invalidateOwnPublicProfileCache(profileUser);
				}
			} catch {
				// ignore
			}
			return;
		}
		if (copy && revealedApiKey) {
			e.preventDefault();
			try {
				await navigator.clipboard.writeText(revealedApiKey);
				setStatus(statusEl, 'API key copied.', 'ok');
			} catch {
				setStatus(statusEl, 'Could not copy.', 'error');
			}
		}
	});

	vynlyMount?.addEventListener('click', async (e) => {
		const saveBtn = e.target.closest?.('[data-int-vynly-save]');
		const remBtn = e.target.closest?.('[data-int-vynly-remove]');
		if (!saveBtn && !remBtn) return;
		e.preventDefault();
		const input = vynlyMount.querySelector('[data-int-vynly-input]');
		if (saveBtn) {
			const token = typeof input?.value === 'string' ? input.value.trim() : '';
			if (!token) {
				window.alert('Paste your credential (starts with vln_), then tap Save.');
				return;
			}
			try {
				const res = await fetchJson('/api/profile/vynly-token', {
					method: 'PUT',
					body: JSON.stringify({ token })
				});
				if (res?.ok && res.data) {
					if (profileUser) {
						profileUser.hasVynlyToken = res.data.hasVynlyToken === true;
						profileUser.vynlyTokenPrefix = res.data.vynlyTokenPrefix ?? null;
					}
					if (input) input.value = '';
					renderCredentials();
					await invalidateOwnPublicProfileCache(profileUser);
					setStatus(statusEl, 'Saved.', 'ok');
				} else {
					const msg = typeof res?.data?.message === 'string' ? res.data.message : 'Could not save token.';
					window.alert(msg);
				}
			} catch {
				window.alert('Could not save token.');
			}
			return;
		}
		if (remBtn) {
			if (!window.confirm('Remove vynly.co credential? Sharing to Vynly turns off until you save again.')) return;
			try {
				const res = await fetchJson('/api/profile/vynly-token', {
					method: 'PUT',
					body: JSON.stringify({ token: '' })
				});
				if (res?.ok) {
					if (profileUser) {
						profileUser.hasVynlyToken = false;
						profileUser.vynlyTokenPrefix = null;
					}
					if (input) input.value = '';
					renderCredentials();
					await invalidateOwnPublicProfileCache(profileUser);
				}
			} catch {
				// ignore
			}
		}
	});

	googlePhotosMount?.addEventListener('click', async (e) => {
		const connectBtn = e.target.closest?.('[data-int-google-photos-connect]');
		const disconnectBtn = e.target.closest?.('[data-int-google-photos-disconnect]');
		if (!connectBtn && !disconnectBtn) return;
		e.preventDefault();

		if (connectBtn) {
			window.location.href = `/api/google-photos/connect?returnUrl=${encodeURIComponent('/integrations')}`;
			return;
		}

		if (disconnectBtn) {
			if (!window.confirm('Disconnect Google Photos? Sharing to Google Photos will turn off until you connect again.')) {
				return;
			}
			const res = await fetchJson('/api/google-photos/disconnect', { method: 'POST' });
			if (!res.ok) {
				setStatus(statusEl, res.data?.message || res.data?.error || 'Could not disconnect.', 'error');
				return;
			}
			await load();
			setStatus(statusEl, 'Disconnected Google Photos.', 'ok');
		}
	});

	async function refreshProfileOnly() {
		const res = await fetchJson('/api/profile');
		if (res.ok && res.data) {
			profileUser = res.data;
		}
	}

	async function load() {
		setStatus(statusEl, '');
		const [profileRes, appsRes, grantsRes, googleRes] = await Promise.all([
			fetchJson('/api/profile'),
			fetchJson('/api/integration/apps'),
			fetchJson('/api/profile/integration-grants'),
			fetchJson('/api/google-photos/status')
		]);

		googlePhotosStatus = googleRes.ok && googleRes.data ? googleRes.data : { configured: false, connected: false };

		if (!profileRes.ok) {
			setStatus(statusEl, profileRes.data?.message || profileRes.data?.error || 'Could not load your profile.', 'error');
			profileUser = null;
		} else {
			profileUser = profileRes.data;
			renderCredentials();
		}

		if (!appsRes.ok) {
			if (!statusEl?.textContent) {
				setStatus(statusEl, appsRes.data?.message || appsRes.data?.error || 'Could not load your apps.', 'error');
			}
			apps = [];
		} else {
			apps = Array.isArray(appsRes.data?.apps) ? appsRes.data.apps : [];
		}

		if (grantsRes.ok && Array.isArray(grantsRes.data?.grants)) {
			grants = grantsRes.data.grants;
		} else {
			grants = [];
		}

		renderApps();
		renderGrants();

		const hash = String(window.location.hash || '');
		if (hash.includes('google-photos=ok')) {
			setStatus(statusEl, 'Connected Google Photos.', 'ok');
		} else if (hash.includes('google-photos=deny')) {
			setStatus(statusEl, 'Google Photos connection cancelled.', 'error');
		} else if (hash.includes('google-photos=fail')) {
			setStatus(statusEl, 'Google Photos connection failed.', 'error');
		}
	}

	function renderApps() {
		if (!listEl || !emptyEl) return;
		if (apps.length === 0) {
			listEl.innerHTML = '';
			emptyEl.hidden = false;
			return;
		}
		emptyEl.hidden = true;
		listEl.innerHTML = apps.map((app) => renderAppCard(app)).join('');
	}

	function renderGrants() {
		if (!grantsListEl || !grantsEmptyEl) return;
		if (grants.length === 0) {
			grantsListEl.innerHTML = '';
			grantsEmptyEl.hidden = false;
			return;
		}
		grantsEmptyEl.hidden = true;
		grantsListEl.innerHTML = grants.map((g) => renderGrantCard(g)).join('');
	}

	grantsListEl?.addEventListener('click', async (e) => {
		const btn = e.target.closest?.('[data-action="revoke-grant"]');
		if (!btn) return;
		const card = btn.closest?.('.integrations-grant-card');
		const raw = card?.getAttribute('data-grant-id');
		const grantId = Number.parseInt(String(raw), 10);
		if (!Number.isFinite(grantId) || grantId <= 0) return;
		if (!window.confirm('Revoke access for this site or app? You’ll need to sign in again there next time.')) return;
		setStatus(statusEl, '');
		const res = await fetchJson(`/api/profile/integration-grants/${grantId}`, { method: 'DELETE' });
		if (!res.ok) {
			setStatus(statusEl, res.data?.message || res.data?.error || 'Could not revoke.', 'error');
			return;
		}
		grants = grants.filter((g) => Number(g.id) !== grantId);
		renderGrants();
		setStatus(statusEl, 'Access revoked.', 'ok');
	});

	listEl?.addEventListener('click', async (e) => {
		const btn = e.target.closest?.('[data-action]');
		if (!btn) return;
		const card = btn.closest?.('.integrations-card');
		const clientId = card?.getAttribute('data-client-id');
		const action = btn.getAttribute('data-action');
		if (!clientId || !action) return;

		if (action === 'copy') {
			try {
				await navigator.clipboard.writeText(clientId);
				setStatus(statusEl, 'Copied public app ID.', 'ok');
			} catch {
				setStatus(statusEl, 'Could not copy.', 'error');
			}
			return;
		}

		if (action === 'edit') {
			const app = apps.find((a) => a.client_id === clientId);
			if (app) {
				setStatus(statusEl, '');
				openDialogEdit(app);
			}
			return;
		}

		if (action === 'delete') {
			if (!window.confirm('Delete this app? People will no longer be able to sign in with it.')) return;
			setStatus(statusEl, '');
			const res = await fetchJson(`/api/integration/apps/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
			if (!res.ok) {
				setStatus(statusEl, res.data?.message || res.data?.error || 'Delete failed.', 'error');
				return;
			}
			closeDialog();
			await load();
			setStatus(statusEl, 'App removed.', 'ok');
		}
	});

	await load();
}

main().catch(() => {});
