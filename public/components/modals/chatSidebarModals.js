/**
 * Chat page sidebar: three modals (new DM, servers browse/join, channels browse/create).
 * Light DOM + global .modal-overlay / .modal classes. Mount once via initChatSidebarModals.
 */

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

function bodyModalLock(on) {
	try {
		document.body.classList.toggle('modal-open', Boolean(on));
	} catch {
		// ignore
	}
}

function getExistingDmOtherUserIds(threads) {
	const ids = new Set();
	for (const t of threads || []) {
		if (!t || t.type !== 'dm') continue;
		const a = Number(t.other_user_id);
		if (Number.isFinite(a) && a > 0) ids.add(a);
		const b = Number(t.other_user?.id);
		if (Number.isFinite(b) && b > 0) ids.add(b);
	}
	return ids;
}

/** Lowercase channel_slug values the viewer already has in their inbox. */
function getJoinedChannelSlugs(threads) {
	const set = new Set();
	for (const t of threads || []) {
		if (!t || t.type !== 'channel') continue;
		const raw = typeof t.channel_slug === 'string' ? t.channel_slug.trim() : '';
		if (raw) set.add(raw.toLowerCase());
	}
	return set;
}

/**
 * @param {object} options
 * @param {() => object[]} options.getThreads
 * @param {() => number | null} options.getViewerId
 * @param {(pathname: string) => void} options.navigateToChatPath
 * @param {() => void} options.refreshSidebar
 */
export function initChatSidebarModals(options) {
	const getThreads = typeof options.getThreads === 'function' ? options.getThreads : () => [];
	const getViewerId = typeof options.getViewerId === 'function' ? options.getViewerId : () => null;
	const navigateToChatPath =
		typeof options.navigateToChatPath === 'function' ? options.navigateToChatPath : () => {};
	const refreshSidebar =
		typeof options.refreshSidebar === 'function' ? options.refreshSidebar : () => {};

	let fetchJsonWithStatusDeduped;
	let getAvatarColor;
	let renderCommentAvatarHtml;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	const depsPromise = (async () => {
		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;
		const avatarMod = await import(`../../shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;
		const commentItemMod = await import(`../../shared/commentItem.js${qs}`);
		renderCommentAvatarHtml = commentItemMod.renderCommentAvatarHtml;
	})();

	let dmSuggestTimer = null;
	let resultsElClickHandler = null;
	let dmOpen = false;
	let serversOpen = false;
	let channelsOpen = false;

	function closeAll() {
		for (const id of ['chat-modal-new-dm', 'chat-modal-servers', 'chat-modal-channels']) {
			const el = document.getElementById(id);
			if (el) {
				el.classList.remove('open');
				el.setAttribute('aria-hidden', 'true');
			}
		}
		dmOpen = serversOpen = channelsOpen = false;
		if (!document.querySelector('.chat-page-chat-modal.open')) {
			bodyModalLock(false);
		}
	}

	function openOverlay(id) {
		closeAll();
		const el = document.getElementById(id);
		if (el) {
			el.classList.add('open');
			el.setAttribute('aria-hidden', 'false');
			bodyModalLock(true);
			if (id === 'chat-modal-new-dm') dmOpen = true;
			if (id === 'chat-modal-servers') serversOpen = true;
			if (id === 'chat-modal-channels') channelsOpen = true;
		}
	}

	function onEscape(e) {
		if (e.key !== 'Escape') return;
		if (dmOpen || serversOpen || channelsOpen) {
			e.preventDefault();
			closeAll();
		}
	}

	function ensureDom() {
		if (document.getElementById('chat-modal-new-dm')) return;

		const wrap = document.createElement('div');
		wrap.innerHTML = `
<div id="chat-modal-new-dm" class="modal-overlay chat-page-chat-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="chat-modal-dm-title">
	<div class="modal modal-medium chat-page-chat-modal-panel">
		<div class="modal-header">
			<h3 id="chat-modal-dm-title">New direct message</h3>
			<button type="button" class="modal-close chat-page-chat-modal-close" data-chat-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
		</div>
		<div class="modal-body">
			<label class="chat-page-chat-modal-label" for="chat-modal-dm-search">Search people</label>
			<input type="search" id="chat-modal-dm-search" class="chat-page-chat-modal-input" placeholder="Name or @username" autocomplete="off" data-chat-dm-search />
			<p class="chat-page-chat-modal-hint">Only people you don’t already have a DM with are listed.</p>
			<div class="chat-page-chat-modal-list" data-chat-dm-results aria-live="polite"></div>
			<p class="route-empty chat-page-chat-modal-empty" data-chat-dm-empty hidden>No matching people. Try another search.</p>
		</div>
	</div>
</div>
<div id="chat-modal-servers" class="modal-overlay chat-page-chat-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="chat-modal-servers-title">
	<div class="modal modal-medium chat-page-chat-modal-panel">
		<div class="modal-header">
			<h3 id="chat-modal-servers-title">Servers</h3>
			<button type="button" class="modal-close chat-page-chat-modal-close" data-chat-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
		</div>
		<div class="modal-body">
			<p class="chat-page-chat-modal-lead">Join a server or register your own image generation server.</p>
			<div class="chat-page-chat-modal-list" data-chat-servers-list aria-busy="true"></div>
			<button type="button" class="btn-primary chat-page-chat-modal-fullwidth" data-chat-servers-add-custom>Register a custom server</button>
		</div>
	</div>
</div>
<div id="chat-modal-channels" class="modal-overlay chat-page-chat-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="chat-modal-channels-title">
	<div class="modal modal-medium chat-page-chat-modal-panel">
		<div class="modal-header">
			<h3 id="chat-modal-channels-title">Channels</h3>
			<button type="button" class="modal-close chat-page-chat-modal-close" data-chat-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
		</div>
		<div class="modal-body">
			<p class="chat-page-chat-modal-lead">Open an existing tag channel or create a new one (same rules as Explore tags).</p>
			<label class="chat-page-chat-modal-label" for="chat-modal-channel-tag">Open or create by tag</label>
			<div class="chat-page-chat-modal-inline">
				<input type="text" id="chat-modal-channel-tag" class="chat-page-chat-modal-input" placeholder="e.g. pixelart" maxlength="40" autocomplete="off" data-chat-channel-tag-input />
				<button type="button" class="btn-primary" data-chat-channel-open>Open</button>
			</div>
			<p class="chat-page-chat-modal-hint">Lowercase, 2–32 characters, letters, numbers, <code>_</code> and <code>-</code>.</p>
			<h4 class="chat-page-chat-modal-subhead">Existing channels</h4>
			<div class="chat-page-chat-modal-list chat-page-chat-modal-list--scroll" data-chat-channels-list aria-busy="true"></div>
		</div>
	</div>
</div>`;
		while (wrap.firstChild) {
			document.body.appendChild(wrap.firstChild);
		}

		document.addEventListener('keydown', onEscape);
		document.addEventListener('click', (e) => {
			const t = e.target;
			if (t instanceof Element && t.closest('[data-chat-modal-close]')) {
				closeAll();
				return;
			}
			const overlay = t instanceof Element ? t.closest('.chat-page-chat-modal.open') : null;
			if (overlay && t === overlay) {
				closeAll();
			}
		});

		const dmSearch = document.querySelector('[data-chat-dm-search]');
		if (dmSearch instanceof HTMLInputElement) {
			dmSearch.addEventListener('input', () => {
				if (dmSuggestTimer) clearTimeout(dmSuggestTimer);
				const q = dmSearch.value.trim();
				dmSuggestTimer = window.setTimeout(() => void runDmSuggest(q), 220);
			});
		}

		const chOpen = document.querySelector('[data-chat-channel-open]');
		const chInput = document.querySelector('[data-chat-channel-tag-input]');
		if (chOpen instanceof HTMLButtonElement && chInput instanceof HTMLInputElement) {
			chOpen.addEventListener('click', () => void openChannelByTag(chInput.value));
			chInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					void openChannelByTag(chInput.value);
				}
			});
		}

		const addCustom = document.querySelector('[data-chat-servers-add-custom]');
		if (addCustom instanceof HTMLButtonElement) {
			addCustom.addEventListener('click', () => {
				closeAll();
				const modal = document.querySelector('app-modal-server');
				if (modal && typeof modal.open === 'function') {
					modal.open({ mode: 'add' });
				}
			});
		}
	}

	async function runDmSuggest(q) {
		await depsPromise;
		const resultsEl = document.querySelector('[data-chat-dm-results]');
		const emptyEl = document.querySelector('[data-chat-dm-empty]');
		if (!resultsEl) return;

		const viewer = getViewerId();
		const existing = getExistingDmOtherUserIds(getThreads());

		if (!q) {
			resultsEl.innerHTML = '';
			if (emptyEl instanceof HTMLElement) emptyEl.hidden = true;
			return;
		}

		const result = await fetchJsonWithStatusDeduped(
			`/api/suggest?source=users&q=${encodeURIComponent(q)}&limit=20`,
			{ credentials: 'include' },
			{ windowMs: 0 }
		);
		if (!result.ok) {
			resultsEl.innerHTML = '';
			return;
		}
		const items = Array.isArray(result.data?.items) ? result.data.items : [];
		const rows = [];
		for (const it of items) {
			if (it?.type !== 'user') continue;
			const uid = Number(it.id);
			if (!Number.isFinite(uid) || uid <= 0) continue;
			if (Number.isFinite(viewer) && uid === viewer) continue;
			if (existing.has(uid)) continue;
			const label = typeof it.label === 'string' ? it.label : 'User';
			const sub = typeof it.sublabel === 'string' ? it.sublabel : '';
			const avatarUrl = typeof it.icon_url === 'string' ? it.icon_url.trim() : '';
			const seed = sub.replace(/^@/, '') || String(uid);
			const color = getAvatarColor(seed);
			const avatarHtml = renderCommentAvatarHtml({
				avatarUrl,
				displayName: label,
				color,
				href: '',
				isFounder: false,
				flairSize: 'xs'
			});
			rows.push(
				`<button type="button" class="chat-page-chat-modal-user-row" data-chat-dm-pick="${uid}">
					${avatarHtml}
					<span class="chat-page-chat-modal-user-text">
						<span class="chat-page-chat-modal-user-name">${escapeHtml(label)}</span>
						${sub ? `<span class="chat-page-chat-modal-user-sub">${escapeHtml(sub)}</span>` : ''}
					</span>
				</button>`
			);
		}
		resultsEl.innerHTML = rows.join('');
		if (emptyEl instanceof HTMLElement) {
			emptyEl.hidden = rows.length > 0;
		}
	}

	function bindDmResultsClick() {
		const resultsEl = document.querySelector('[data-chat-dm-results]');
		if (!resultsEl || resultsElClickHandler) return;
		resultsElClickHandler = async (e) => {
			const btn = e.target?.closest?.('[data-chat-dm-pick]');
			if (!(btn instanceof HTMLButtonElement)) return;
			const uid = Number(btn.getAttribute('data-chat-dm-pick'));
			if (!Number.isFinite(uid) || uid <= 0) return;
			await depsPromise;
			const res = await fetch('/api/chat/dm', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ other_user_id: uid })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				window.alert(data?.message || data?.error || 'Could not open DM');
				return;
			}
			closeAll();
			navigateToChatPath(`/chat/dm/${encodeURIComponent(String(uid))}`);
			refreshSidebar();
		};
		resultsEl.addEventListener('click', resultsElClickHandler);
	}

	async function loadServersModal() {
		await depsPromise;
		const listEl = document.querySelector('[data-chat-servers-list]');
		if (!listEl) return;
		listEl.setAttribute('aria-busy', 'true');
		listEl.innerHTML = '<p class="chat-page-chat-modal-loading">Loading…</p>';
		const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 0 });
		listEl.removeAttribute('aria-busy');
		if (!result.ok) {
			listEl.innerHTML = `<p class="route-empty">${escapeHtml(result.data?.message || 'Could not load servers.')}</p>`;
			return;
		}
		const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
		const joinable = servers.filter(
			(s) =>
				s &&
				s.id !== 1 &&
				!s.is_member &&
				s.can_join_leave !== false &&
				!s.suspended
		);
		if (joinable.length === 0) {
			listEl.innerHTML =
				'<p class="route-empty">No servers to join right now. You can register your own below.</p>';
			return;
		}
		listEl.innerHTML = joinable
			.map((s) => {
				const name = escapeHtml(s.name || 'Server');
				const desc =
					typeof s.description === 'string' && s.description.trim()
						? escapeHtml(s.description.trim().slice(0, 160))
						: '';
				return `<div class="chat-page-chat-modal-server card admin-card server-card" data-chat-server-join-id="${Number(s.id)}">
					<div class="admin-title">${name}</div>
					${desc ? `<div class="admin-detail server-card-description">${desc}</div>` : ''}
					<button type="button" class="btn-primary btn-inline chat-page-chat-modal-join-btn" data-chat-server-join="${Number(s.id)}">Join</button>
				</div>`;
			})
			.join('');

		listEl.querySelectorAll('[data-chat-server-join]').forEach((el) => {
			if (!(el instanceof HTMLButtonElement)) return;
			el.addEventListener('click', async (ev) => {
				ev.stopPropagation();
				const id = Number(el.getAttribute('data-chat-server-join'));
				if (!Number.isFinite(id) || id <= 0) return;
				el.disabled = true;
				const res = await fetch(`/api/servers/${id}/join`, { method: 'POST', credentials: 'include' });
				const data = await res.json().catch(() => ({}));
				el.disabled = false;
				if (!res.ok) {
					window.alert(data?.error || 'Could not join server');
					return;
				}
				try {
					document.dispatchEvent(new CustomEvent('servers-updated'));
				} catch {
					// ignore
				}
				closeAll();
				refreshSidebar();
			});
		});
	}

	async function loadChannelsModal() {
		await depsPromise;
		const listEl = document.querySelector('[data-chat-channels-list]');
		if (!listEl) return;
		listEl.setAttribute('aria-busy', 'true');
		listEl.innerHTML = '<p class="chat-page-chat-modal-loading">Loading…</p>';
		const result = await fetchJsonWithStatusDeduped(
			'/api/chat/channel-slugs',
			{ credentials: 'include' },
			{ windowMs: 0 }
		);
		listEl.removeAttribute('aria-busy');
		if (!result.ok) {
			listEl.innerHTML = `<p class="route-empty">${escapeHtml(result.data?.message || 'Could not load channels.')}</p>`;
			return;
		}
		const slugs = Array.isArray(result.data?.slugs) ? result.data.slugs : [];
		const alreadyIn = getJoinedChannelSlugs(getThreads());
		const browseSlugs = slugs.filter((s) => {
			const key = String(s || '').trim().toLowerCase();
			return key && !alreadyIn.has(key);
		});
		if (slugs.length === 0) {
			listEl.innerHTML = '<p class="route-empty">No channels yet. Create one with the field above.</p>';
			return;
		}
		if (browseSlugs.length === 0) {
			listEl.innerHTML =
				'<p class="route-empty">No other channels to browse—you are already in every channel listed here. Open one from the sidebar, or use the field above to open or create a tag.</p>';
			return;
		}
		listEl.innerHTML = browseSlugs
			.map(
				(slug) =>
					`<button type="button" class="chat-page-chat-modal-channel-row" data-chat-channel-slug="${escapeHtml(slug)}">#${escapeHtml(slug)}</button>`
			)
			.join('');
		listEl.querySelectorAll('[data-chat-channel-slug]').forEach((btn) => {
			if (!(btn instanceof HTMLButtonElement)) return;
			btn.addEventListener('click', () => {
				const slug = btn.getAttribute('data-chat-channel-slug');
				if (!slug) return;
				closeAll();
				navigateToChatPath(`/chat/c/${encodeURIComponent(slug)}`);
			});
		});
	}

	async function openChannelByTag(raw) {
		await depsPromise;
		const tag = String(raw || '').trim();
		if (!tag) {
			window.alert('Enter a channel tag.');
			return;
		}
		const res = await fetch('/api/chat/channels', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tag })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			window.alert(data?.message || data?.error || 'Could not open channel');
			return;
		}
		const slug =
			data?.thread?.channel_slug && String(data.thread.channel_slug).trim()
				? String(data.thread.channel_slug).trim()
				: tag.toLowerCase().trim();
		closeAll();
		navigateToChatPath(`/chat/c/${encodeURIComponent(slug)}`);
		refreshSidebar();
	}

	function openDmModal() {
		ensureDom();
		bindDmResultsClick();
		const dmSearch = document.querySelector('[data-chat-dm-search]');
		const resultsEl = document.querySelector('[data-chat-dm-results]');
		const emptyEl = document.querySelector('[data-chat-dm-empty]');
		if (dmSearch instanceof HTMLInputElement) {
			dmSearch.value = '';
		}
		if (resultsEl) resultsEl.innerHTML = '';
		if (emptyEl instanceof HTMLElement) emptyEl.hidden = true;
		openOverlay('chat-modal-new-dm');
		if (dmSearch instanceof HTMLInputElement) {
			requestAnimationFrame(() => dmSearch.focus());
		}
	}

	function openServersModal() {
		ensureDom();
		openOverlay('chat-modal-servers');
		void loadServersModal();
	}

	function openChannelsModal() {
		ensureDom();
		const chInput = document.querySelector('[data-chat-channel-tag-input]');
		if (chInput instanceof HTMLInputElement) chInput.value = '';
		openOverlay('chat-modal-channels');
		void loadChannelsModal();
	}

	return {
		openDmModal,
		openServersModal,
		openChannelsModal,
		closeAll
	};
}
