/**
 * Chat page sidebar: three modals (new DM, servers browse/join, channels browse/create).
 * Light DOM + global .modal-overlay / .modal classes. Mount once via initChatSidebarModals.
 */

import { fetchJsonWithStatusDeduped } from '../../api.js';
import { getAvatarColor } from '../../avatar.js';
import { renderCommentAvatarHtml } from '../../commentItem.js';

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
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

function bytesToB64(bytes) {
	if (!(bytes instanceof Uint8Array)) return '';
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

/**
 * Same channel tag rules as `normalizeTag` on the API.
 * Strip leading `#`, lowercase, require `[a-z0-9][a-z0-9_-]{1,31}`.
 * @param {string} input
 * @returns {string | null}
 */
function normalizeChannelTagLikeApi(input) {
	const source = typeof input === 'string' ? input : '';
	if (!source) return null;
	const raw = source.replace(/^#+/, '');
	if (!raw) return null;
	if (raw !== raw.trim()) return null;
	if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(raw)) return null;
	return raw;
}

async function deriveAesKeyFromSecret(secret) {
	const enc = new TextEncoder();
	const hash = await crypto.subtle.digest('SHA-256', enc.encode(String(secret || '')));
	return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptPrivateText(plain, secret) {
	const key = await deriveAesKeyFromSecret(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const enc = new TextEncoder().encode(String(plain || ''));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
	return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
}

/**
 * @param {object} options
 * @param {() => object[]} options.getThreads
 * @param {() => number | null} options.getViewerId
 * @param {() => boolean} [options.getViewerCanCreatePrivateChannel]
 * @param {(pathname: string) => void} options.navigateToChatPath
 * @param {() => void} options.refreshSidebar
 */
export function initChatSidebarModals(options) {
	const getThreads = typeof options.getThreads === 'function' ? options.getThreads : () => [];
	const getViewerId = typeof options.getViewerId === 'function' ? options.getViewerId : () => null;
	const getViewerCanCreatePrivateChannel =
		typeof options.getViewerCanCreatePrivateChannel === 'function'
			? options.getViewerCanCreatePrivateChannel
			: () => false;
	const navigateToChatPath =
		typeof options.navigateToChatPath === 'function' ? options.navigateToChatPath : () => { };
	const refreshSidebar =
		typeof options.refreshSidebar === 'function' ? options.refreshSidebar : () => { };

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
	<div class="modal modal-medium chat-page-chat-modal-panel chat-page-chat-modal-panel--servers">
		<div class="modal-header">
			<h3 id="chat-modal-servers-title">Servers</h3>
			<button type="button" class="modal-close chat-page-chat-modal-close" data-chat-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
		</div>
		<div class="modal-body">
			<p class="chat-page-chat-modal-lead">Join a server or register your own image generation server.</p>
			<div class="chat-page-chat-modal-list chat-page-chat-modal-list--scroll chat-page-chat-modal-servers-list" data-chat-servers-list aria-busy="true"></div>
			<button type="button" class="btn-outlined chat-page-chat-modal-fullwidth chat-page-chat-modal-servers-register" data-chat-servers-add-custom>Register a custom server</button>
		</div>
	</div>
</div>
<div id="chat-modal-channels" class="modal-overlay chat-page-chat-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="chat-modal-channels-title">
	<div class="modal modal-medium chat-page-chat-modal-panel chat-page-chat-modal-panel--channels">
		<div class="modal-header">
			<h3 id="chat-modal-channels-title">Channels</h3>
			<button type="button" class="modal-close chat-page-chat-modal-close" data-chat-modal-close aria-label="Close"><span class="modal-close-icon" aria-hidden="true">×</span></button>
		</div>
		<div class="modal-body">
			<div class="chat-page-chat-modal-channel-group chat-page-chat-modal-field">
				<h4 class="chat-page-chat-modal-subhead">Open channel</h4>
				<p class="chat-page-chat-modal-hint chat-page-chat-modal-hint--tight">Public + unique.</p>
				<div class="chat-page-chat-modal-tag-row">
					<input type="text" id="chat-modal-channel-tag" class="chat-page-chat-modal-input chat-page-chat-modal-input--tag" placeholder="e.g. pixelart" maxlength="32" autocomplete="off" data-chat-channel-tag-input />
					<button type="button" class="btn-primary chat-page-chat-modal-open-btn" data-chat-channel-open>Open</button>
				</div>
				<p class="chat-page-chat-modal-hint chat-page-chat-modal-hint--tight chat-page-chat-modal-hint--validation" data-chat-channel-tag-hint>Use 2–32 chars: lowercase letters, numbers, <code>_</code>, <code>-</code>.</p>
			</div>
			<div class="chat-page-chat-modal-channel-group" data-chat-private-channel-section>
				<h4 class="chat-page-chat-modal-subhead">Private channel</h4>
				<p class="chat-page-chat-modal-hint chat-page-chat-modal-hint--tight">Hidden + encrypted.</p>
				<div class="chat-page-chat-modal-tag-row">
					<input type="text" class="chat-page-chat-modal-input chat-page-chat-modal-input--tag" placeholder="e.g. game_night" maxlength="32" autocomplete="off" data-chat-private-channel-name />
					<button type="button" class="btn-primary chat-page-chat-modal-open-btn" data-chat-private-channel-create>Create</button>
				</div>
				<p class="chat-page-chat-modal-hint chat-page-chat-modal-hint--tight chat-page-chat-modal-hint--validation" data-chat-private-channel-name-hint>Use 2–32 chars: lowercase letters, numbers, <code>_</code>, <code>-</code>.</p>
				<div class="chat-page-chat-modal-tag-row chat-page-chat-modal-tag-row--private-invite" data-chat-private-invite-wrap hidden>
					<input type="text" class="chat-page-chat-modal-input chat-page-chat-modal-input--tag" readonly data-chat-private-invite-output />
					<button type="button" class="btn-outlined chat-page-chat-modal-copy-btn" data-chat-private-invite-copy>Copy</button>
				</div>
				<p class="chat-page-chat-modal-hint chat-page-chat-modal-hint--tight" data-chat-private-channel-status hidden></p>
			</div>
			<div class="chat-page-chat-modal-channels-browse">
				<h4 class="chat-page-chat-modal-subhead">Existing channels</h4>
				<div class="chat-page-chat-modal-list chat-page-chat-modal-list--scroll" data-chat-channels-list aria-busy="true"></div>
			</div>
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
		const chHint = document.querySelector('[data-chat-channel-tag-hint]');
		const hideChannelTagHint = () => {
			if (chHint instanceof HTMLElement) chHint.classList.remove('is-visible');
		};
		const showChannelTagHint = () => {
			if (chHint instanceof HTMLElement) chHint.classList.add('is-visible');
		};
		const setOpenChannelInvalidUi = (isInvalid) => {
			const bad = Boolean(isInvalid);
			if (chInput instanceof HTMLInputElement) chInput.classList.toggle('is-invalid', bad);
			if (chOpen instanceof HTMLButtonElement) chOpen.disabled = bad;
		};
		const syncOpenChannelValidationUi = () => {
			const v = String(chInput instanceof HTMLInputElement ? chInput.value || '' : '');
			if (!v) {
				hideChannelTagHint();
				setOpenChannelInvalidUi(false);
				return;
			}
			const normalized = normalizeChannelTagLikeApi(v);
			const isInvalid = !normalized;
			if (isInvalid) showChannelTagHint();
			else hideChannelTagHint();
			setOpenChannelInvalidUi(isInvalid);
		};
		if (chOpen instanceof HTMLButtonElement && chInput instanceof HTMLInputElement) {
			chOpen.addEventListener('click', () => void openChannelByTag(chInput.value));
			chInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					void openChannelByTag(chInput.value);
				}
			});
			chInput.addEventListener('input', syncOpenChannelValidationUi);
		}

		const privateCreateBtn = document.querySelector('[data-chat-private-channel-create]');
		const privateNameInput = document.querySelector('[data-chat-private-channel-name]');
		const privateInviteWrap = document.querySelector('[data-chat-private-invite-wrap]');
		const privateInviteOutput = document.querySelector('[data-chat-private-invite-output]');
		const privateInviteCopyBtn = document.querySelector('[data-chat-private-invite-copy]');
		const privateStatus = document.querySelector('[data-chat-private-channel-status]');
		const privateNameHint = document.querySelector('[data-chat-private-channel-name-hint]');
		const hidePrivateNameHint = () => {
			if (privateNameHint instanceof HTMLElement) privateNameHint.classList.remove('is-visible');
		};
		const showPrivateNameHint = () => {
			if (privateNameHint instanceof HTMLElement) privateNameHint.classList.add('is-visible');
		};
		const setPrivateChannelInvalidUi = (isInvalid) => {
			const bad = Boolean(isInvalid);
			if (privateNameInput instanceof HTMLInputElement) privateNameInput.classList.toggle('is-invalid', bad);
			if (privateCreateBtn instanceof HTMLButtonElement) privateCreateBtn.disabled = bad;
		};
		const syncPrivateChannelValidationUi = () => {
			const v = String(privateNameInput instanceof HTMLInputElement ? privateNameInput.value || '' : '');
			if (!v) {
				hidePrivateNameHint();
				setPrivateChannelInvalidUi(false);
				return;
			}
			const normalized = normalizeChannelTagLikeApi(v);
			const isInvalid = !normalized;
			if (isInvalid) showPrivateNameHint();
			else hidePrivateNameHint();
			setPrivateChannelInvalidUi(isInvalid);
		};
		const resetPrivateUi = () => {
			if (privateInviteWrap instanceof HTMLElement) privateInviteWrap.hidden = true;
			if (privateInviteOutput instanceof HTMLInputElement) privateInviteOutput.value = '';
			hidePrivateNameHint();
			setPrivateChannelInvalidUi(false);
			if (privateStatus instanceof HTMLElement) {
				privateStatus.hidden = true;
				privateStatus.textContent = '';
			}
		};
		const setPrivateStatus = (msg) => {
			if (!(privateStatus instanceof HTMLElement)) return;
			privateStatus.hidden = false;
			privateStatus.textContent = String(msg || '');
		};
		const runPrivateCreate = async () => {
			if (!(privateNameInput instanceof HTMLInputElement)) return;
			const name = normalizeChannelTagLikeApi(privateNameInput.value || '');
			if (!name) {
				showPrivateNameHint();
				return;
			}
			hidePrivateNameHint();
			if (!(privateCreateBtn instanceof HTMLButtonElement)) return;
			privateCreateBtn.disabled = true;
			try {
				const secret = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
				const encName = await encryptPrivateText(name, secret);
				const encProbe = await encryptPrivateText('PARASCENE_CHANNEL_OK_V1', secret);
				const createRes = await fetch('/api/chat/channels', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						visibility: 'private',
						enc_name: encName,
						enc_probe: encProbe,
						secret_k: secret
					})
				});
				const createData = await createRes.json().catch(() => ({}));
				if (!createRes.ok) {
					setPrivateStatus(createData?.message || createData?.error || 'Could not create private channel.');
					return;
				}
				const threadId = Number(createData?.thread?.id);
				if (!Number.isFinite(threadId) || threadId <= 0) {
					setPrivateStatus('Private channel was created but could not be opened.');
					return;
				}
				const invRes = await fetch('/api/chat/invites', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ thread_id: threadId })
				});
				const invData = await invRes.json().catch(() => ({}));
				if (!invRes.ok) {
					setPrivateStatus(invData?.message || invData?.error || 'Channel created; invite link failed.');
				} else {
					const inviteUrl = typeof invData?.invite_url === 'string' ? invData.invite_url : '';
					if (inviteUrl && privateInviteOutput instanceof HTMLInputElement) {
						privateInviteOutput.value = inviteUrl;
						if (privateInviteWrap instanceof HTMLElement) privateInviteWrap.hidden = false;
						setPrivateStatus('Private channel created. Share this invite link.');
					}
				}
				closeAll();
				navigateToChatPath(`/chat/t/${encodeURIComponent(String(threadId))}`);
				refreshSidebar();
			} catch {
				setPrivateStatus('Could not create private channel.');
			} finally {
				privateCreateBtn.disabled = false;
			}
		};
		if (privateCreateBtn instanceof HTMLButtonElement) {
			privateCreateBtn.addEventListener('click', () => void runPrivateCreate());
		}
		if (privateNameInput instanceof HTMLInputElement) {
			privateNameInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					void runPrivateCreate();
				}
			});
			privateNameInput.addEventListener('input', () => {
				syncPrivateChannelValidationUi();
				if (privateStatus instanceof HTMLElement && !privateStatus.hidden) {
					privateStatus.hidden = true;
				}
			});
		}
		if (privateInviteCopyBtn instanceof HTMLButtonElement && privateInviteOutput instanceof HTMLInputElement) {
			privateInviteCopyBtn.addEventListener('click', async () => {
				const value = String(privateInviteOutput.value || '').trim();
				if (!value) return;
				try {
					if (navigator.clipboard?.writeText) {
						await navigator.clipboard.writeText(value);
						setPrivateStatus('Invite link copied.');
					}
				} catch {
					setPrivateStatus('Copy failed. Select and copy manually.');
				}
			});
		}
		resetPrivateUi();

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
				'<p class="route-empty chat-page-chat-modal-servers-empty">No servers to join right now. You can register your own below.</p>';
			return;
		}
		listEl.innerHTML = joinable
			.map((s) => {
				const id = Number(s.id);
				const name = escapeHtml(s.name || 'Server');
				const rawDesc =
					typeof s.description === 'string' && s.description.trim()
						? s.description.trim()
						: '';
				const desc = rawDesc ? escapeHtml(rawDesc) : '';
				let ownerBlock = '';
				if (s.owner && id !== 1 && typeof getAvatarColor === 'function') {
					const o = s.owner;
					const displayName = escapeHtml(o.display_name || `User ${o.id}`);
					const handleRaw = o.user_name || o.email_prefix || null;
					const handle = handleRaw ? escapeHtml(handleRaw) : '';
					const avatarUrl =
						typeof o.avatar_url === 'string' && o.avatar_url.trim() ? o.avatar_url.trim() : '';
					const initial = String(o.display_name || `U${o.id}`)
						.trim()
						.charAt(0)
						.toUpperCase() || '?';
					const bg = getAvatarColor(o.user_name || o.email_prefix || String(o.id || ''));
					const avatarInner = avatarUrl
						? `<img src="${escapeHtml(avatarUrl)}" class="chat-page-chat-modal-server-owner-img" alt="" />`
						: escapeHtml(initial);
					const handleHtml = handle
						? `<span class="chat-page-chat-modal-server-owner-handle">@${handle}</span>`
						: '';
					ownerBlock = `<div class="chat-page-chat-modal-server-owner">
						<div class="chat-page-chat-modal-server-owner-avatar" style="background:${escapeHtml(bg)}">${avatarInner}</div>
						<div class="chat-page-chat-modal-server-owner-meta">
							<span class="chat-page-chat-modal-server-owner-name">${displayName}</span>
							${handleHtml}
						</div>
					</div>`;
				}
				const descBlock = desc
					? `<p class="chat-page-chat-modal-server-desc">${desc}</p>`
					: '';
				const serverAvatarUrl =
					typeof s.avatar_url === 'string' && s.avatar_url.trim() ? s.avatar_url.trim() : '';
				const serverAvatarBlock = serverAvatarUrl
					? `<div class="chat-page-chat-modal-server-owner">
						<div class="chat-page-chat-modal-server-owner-avatar">
							<img src="${escapeHtml(serverAvatarUrl)}" class="chat-page-chat-modal-server-owner-img" alt="" />
						</div>
						<div class="chat-page-chat-modal-server-owner-meta">
							<span class="chat-page-chat-modal-server-owner-handle">Server avatar</span>
						</div>
					</div>`
					: '';
				return `<div class="chat-page-chat-modal-server-card" data-chat-server-join-id="${id}">
					<div class="chat-page-chat-modal-server-row">
						<div class="chat-page-chat-modal-server-col">
							<div class="chat-page-chat-modal-server-title">${name}</div>
							${serverAvatarBlock}
							${ownerBlock}
							${descBlock}
						</div>
						<button type="button" class="btn-outlined chat-page-chat-modal-join-btn" data-chat-server-join="${id}">Join</button>
					</div>
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
		const listEl = document.querySelector('[data-chat-channels-list]');
		if (!listEl) return;
		listEl.setAttribute('aria-busy', 'true');
		listEl.innerHTML = '<p class="route-empty">Loading…</p>';
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
			listEl.innerHTML = '<p class="route-empty">No channels found.</p>';
			return;
		}
		if (browseSlugs.length === 0) {
			listEl.innerHTML = '<p class="route-empty">No joinable channels.</p>';
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
		const chHint = document.querySelector('[data-chat-channel-tag-hint]');
		const chInput = document.querySelector('[data-chat-channel-tag-input]');
		const chOpen = document.querySelector('[data-chat-channel-open]');
		const hideHint = () => {
			if (chHint instanceof HTMLElement) chHint.classList.remove('is-visible');
		};
		const showHint = () => {
			if (chHint instanceof HTMLElement) chHint.classList.add('is-visible');
		};
		const tag = normalizeChannelTagLikeApi(raw || '');
		if (!tag) {
			showHint();
			if (chInput instanceof HTMLInputElement) chInput.classList.add('is-invalid');
			if (chOpen instanceof HTMLButtonElement) chOpen.disabled = true;
			return;
		}
		hideHint();
		if (chInput instanceof HTMLInputElement) chInput.classList.remove('is-invalid');
		if (chOpen instanceof HTMLButtonElement) chOpen.disabled = false;
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
		const chOpen = document.querySelector('[data-chat-channel-open]');
		const chHint = document.querySelector('[data-chat-channel-tag-hint]');
		if (chInput instanceof HTMLInputElement) chInput.value = '';
		if (chInput instanceof HTMLInputElement) chInput.classList.remove('is-invalid');
		if (chOpen instanceof HTMLButtonElement) chOpen.disabled = false;
		if (chHint instanceof HTMLElement) chHint.classList.remove('is-visible');
		const pInput = document.querySelector('[data-chat-private-channel-name]');
		const pStatus = document.querySelector('[data-chat-private-channel-status]');
		const pWrap = document.querySelector('[data-chat-private-invite-wrap]');
		const pOut = document.querySelector('[data-chat-private-invite-output]');
		const pSection = document.querySelector('[data-chat-private-channel-section]');
		if (pInput instanceof HTMLInputElement) pInput.value = '';
		if (pStatus instanceof HTMLElement) {
			pStatus.hidden = true;
			pStatus.textContent = '';
		}
		if (pWrap instanceof HTMLElement) pWrap.hidden = true;
		if (pOut instanceof HTMLInputElement) pOut.value = '';
		if (pSection instanceof HTMLElement) {
			pSection.hidden = !Boolean(getViewerCanCreatePrivateChannel());
		}
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
