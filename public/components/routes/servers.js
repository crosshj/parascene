let formatRelativeTime;
let fetchJsonWithStatusDeduped;
let readCachedChatThreads;
let writeCachedChatThreads;
let clearCachedChatThreads;
let isChatThreadsCacheStale;
let readConnectServersCache;
let writeConnectServersCache;
let clearConnectServersCache;
let isConnectServersCacheStale;
let getAvatarColor;
let renderEmptyState;
let renderEmptyError;
let renderCommentAvatarHtml;
let serverChannelTagFromServerName;
let appendReservedPseudoChannels;
let mergeThreadRowsWithJoinedServers;
let buildChatThreadUrl;
let buildChatThreadRowAvatarHtml;
let getDmOtherUserId;

function getAssetVersionParam() {
	const meta = document.querySelector('meta[name="asset-version"]');
	return meta?.getAttribute('content')?.trim() || '';
}

function getImportQuery(version) {
	return version && typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
}

let _depsPromise;
async function loadDeps() {
	if (_depsPromise) return _depsPromise;
	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	_depsPromise = (async () => {
		const datetimeMod = await import(`../../shared/datetime.js${qs}`);
		formatRelativeTime = datetimeMod.formatRelativeTime;

		const apiMod = await import(`../../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const chatThreadsCacheMod = await import(`../../shared/chatThreadsCache.js${qs}`);
		readCachedChatThreads = chatThreadsCacheMod.readCachedChatThreads;
		writeCachedChatThreads = chatThreadsCacheMod.writeCachedChatThreads;
		clearCachedChatThreads = chatThreadsCacheMod.clearCachedChatThreads;
		isChatThreadsCacheStale = chatThreadsCacheMod.isChatThreadsCacheStale;

		const connectServersCacheMod = await import(`../../shared/connectServersCache.js${qs}`);
		readConnectServersCache = connectServersCacheMod.readConnectServersCache;
		writeConnectServersCache = connectServersCacheMod.writeConnectServersCache;
		clearConnectServersCache = connectServersCacheMod.clearConnectServersCache;
		isConnectServersCacheStale = connectServersCacheMod.isConnectServersCacheStale;

		const avatarMod = await import(`../../shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;

		const emptyStateMod = await import(`../../shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const commentItemMod = await import(`../../shared/commentItem.js${qs}`);
		renderCommentAvatarHtml = commentItemMod.renderCommentAvatarHtml;

		const serverChatTagMod = await import(`../../shared/serverChatTag.js${qs}`);
		serverChannelTagFromServerName = serverChatTagMod.serverChannelTagFromServerName;

		const chatSidebarRosterMod = await import(`../../shared/chatSidebarRoster.js${qs}`);
		appendReservedPseudoChannels = chatSidebarRosterMod.appendReservedPseudoChannels;
		mergeThreadRowsWithJoinedServers = chatSidebarRosterMod.mergeThreadRowsWithJoinedServers;
		buildChatThreadUrl = chatSidebarRosterMod.buildChatThreadUrl;
		buildChatThreadRowAvatarHtml = chatSidebarRosterMod.buildChatThreadRowAvatarHtml;
		getDmOtherUserId = chatSidebarRosterMod.getDmOtherUserId;
	})();
	return _depsPromise;
}

const html = String.raw;

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/** Label for admin thread `<select>` options (GET /admin/chat/threads rows). */
function adminChatThreadSelectLabel(t) {
	const id = t?.id != null ? Number(t.id) : null;
	const idSuffix = Number.isFinite(id) && id > 0 ? ` · id ${id}` : '';
	if (t?.type === 'channel' && t?.channel_slug) {
		return `#${String(t.channel_slug).trim()}${idSuffix}`;
	}
	if (t?.type === 'dm' && t?.dm_pair_key) {
		return `DM ${String(t.dm_pair_key).trim()}${idSuffix}`;
	}
	return `Thread${idSuffix}`;
}

const CONNECT_LEGACY_HASH_PREFIXES = new Set(['latest-comments', 'servers', 'feature-requests', 'comments']);

const DM_OFFLINE_GRACE_MS = 45 * 1000;

function isDmConsideredOnlineWithGrace(otherUserId, onlineIds, lastSeenMap) {
	const oid = Number(otherUserId);
	if (!Number.isFinite(oid) || oid <= 0) return false;
	const now = Date.now();
	if (onlineIds && onlineIds.has(oid)) {
		if (lastSeenMap instanceof Map) lastSeenMap.set(oid, now);
		return true;
	}
	const last = lastSeenMap instanceof Map ? lastSeenMap.get(oid) : null;
	if (last != null && now - last < DM_OFFLINE_GRACE_MS) {
		return true;
	}
	return false;
}

class AppRouteServers extends HTMLElement {
	async connectedCallback() {
		await loadDeps();
		this.innerHTML = html`
	<div class="servers-route">
		<div class="route-header">
			<h3>Connect</h3>
			<p>Your conversations in one place — direct messages, servers you've joined, and hashtag channels. Open one to continue in full chat.</p>
		</div>
		<div class="connect-chat" data-connect-chat>
			<div class="connect-chat-sidebar">
				<div class="connect-chat-unauth" data-connect-chat-unauth hidden></div>
				<div class="connect-chat-lists" data-connect-chat-lists>
					<div class="chat-page-sidebar-scroll connect-chat-sidebar-roster" data-connect-chat-scroll
						aria-busy="true" aria-label="Loading conversations">
						<section class="chat-page-sidebar-section" aria-labelledby="connect-sidebar-dms-heading">
							<div class="chat-page-sidebar-section-head">
								<h2 id="connect-sidebar-dms-heading" class="chat-page-sidebar-heading">Direct messages</h2>
								<button type="button" class="chat-page-sidebar-add" data-chat-sidebar-add="dm"
									aria-label="New direct message">
									<svg class="chat-page-sidebar-add-icon" xmlns="http://www.w3.org/2000/svg" width="18"
										height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
										stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
								</button>
							</div>
							<div class="chat-page-sidebar-list" data-chat-sidebar-users></div>
						</section>
						<section class="chat-page-sidebar-section" aria-labelledby="connect-sidebar-servers-heading">
							<div class="chat-page-sidebar-section-head">
								<h2 id="connect-sidebar-servers-heading" class="chat-page-sidebar-heading">Servers</h2>
								<button type="button" class="chat-page-sidebar-add" data-chat-sidebar-add="servers"
									aria-label="Add or browse servers">
									<svg class="chat-page-sidebar-add-icon" xmlns="http://www.w3.org/2000/svg" width="18"
										height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
										stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
								</button>
							</div>
							<div class="chat-page-sidebar-list" data-chat-sidebar-servers></div>
						</section>
						<section class="chat-page-sidebar-section" aria-labelledby="connect-sidebar-channels-heading">
							<div class="chat-page-sidebar-section-head">
								<h2 id="connect-sidebar-channels-heading" class="chat-page-sidebar-heading">Channels</h2>
								<button type="button" class="chat-page-sidebar-add" data-chat-sidebar-add="channels"
									aria-label="Open or browse channels">
									<svg class="chat-page-sidebar-add-icon" xmlns="http://www.w3.org/2000/svg" width="18"
										height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
										stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
								</button>
							</div>
							<div class="chat-page-sidebar-list" data-chat-sidebar-channels></div>
						</section>
					</div>
				</div>
			</div>
			<div class="connect-chat-admin-tools" data-connect-chat-admin-tools hidden>
				<p class="admin-detail">Admin: delete a hashtag channel thread. DMs and server-linked channels are
					not listed. Removes all messages and membership (database cascade).</p>
				<div class="connect-chat-toolbar-row connect-chat-admin-thread-row">
					<select class="connect-chat-input connect-chat-admin-thread-select" data-connect-chat-admin-thread-select
						aria-label="Chat thread to delete" disabled>
						<option value="">Loading…</option>
					</select>
					<button type="button" class="btn-danger connect-chat-admin-delete"
						data-connect-chat-admin-delete>Delete</button>
				</div>
				<p class="connect-chat-error" data-connect-chat-admin-status role="status" aria-live="polite"
					hidden></p>
			</div>
		</div>
	</div>
    `;

		this._appDocTitleBase = typeof document !== 'undefined' ? document.title : 'parascene';

		this._hydrateConnectCachesFromStorage();
		await this.setupConnectChat();
		this.setupConnectTabHash();
		this._onServersUpdated = () => this.loadServers({ forceNetwork: true });
		document.addEventListener('servers-updated', this._onServersUpdated);
		void this.loadServers();
	}

	/** Apply persisted server roster for merge (must match chat viewer). */
	_hydrateConnectCachesFromStorage() {
		const chat = readCachedChatThreads();
		const sv = readConnectServersCache();
		const vidFromChat = chat?.viewerId != null ? Number(chat.viewerId) : null;
		const vidFromSv = sv?.viewerId != null ? Number(sv.viewerId) : null;
		const vid =
			vidFromChat != null && Number.isFinite(vidFromChat) ? vidFromChat : vidFromSv;
		if (!sv || !Array.isArray(sv.joinedServers)) return;
		if (vid == null || !Number.isFinite(vid) || sv.viewerId !== vid) return;
		this._joinedServersForChat = sv.joinedServers;
		this._serverDerivedChannelSlugs = new Set(
			(sv.derivedSlugs || []).map((s) => String(s).toLowerCase())
		);
	}

	/** Old bookmarks (#latest-comments, #servers, #feature-requests) → #chat. */
	setupConnectTabHash() {
		const normalizeLegacyHash = () => {
			const path = window.location.pathname || '';
			if (path !== '/connect' && !path.startsWith('/connect/')) return;
			const raw = (window.location.hash || '').replace(/^#/, '');
			const first = raw.split('/')[0].trim().toLowerCase();
			if (!first || first === 'chat') return;
			if (CONNECT_LEGACY_HASH_PREFIXES.has(first)) {
				window.history.replaceState(null, '', '/connect#chat');
			}
		};

		const onRouteChange = (e) => {
			if (e.detail?.route === 'connect') normalizeLegacyHash();
		};

		const onHashChange = () => normalizeLegacyHash();

		setTimeout(() => {
			if (document.documentElement?.dataset?.route === 'connect') normalizeLegacyHash();
		}, 0);

		document.addEventListener('route-change', onRouteChange);
		window.addEventListener('hashchange', onHashChange);

		this._connectTabHashCleanup = () => {
			document.removeEventListener('route-change', onRouteChange);
			window.removeEventListener('hashchange', onHashChange);
		};
	}

	disconnectedCallback() {
		document.removeEventListener('servers-updated', this._onServersUpdated);
		if (typeof this._connectTabHashCleanup === 'function') {
			this._connectTabHashCleanup();
		}
		if (typeof this._connectChatCleanup === 'function') {
			this._connectChatCleanup();
		}
		if (this._appDocTitleBase) {
			document.title = this._appDocTitleBase;
		}
	}

	_tearDownConnectChatUserBroadcast() {
		if (typeof this._userBroadcastTeardown === 'function') {
			try {
				this._userBroadcastTeardown();
			} catch {
				// ignore
			}
		}
		this._userBroadcastTeardown = null;
		this._userBroadcastViewerBound = null;
	}

	async _bindConnectChatUserBroadcast() {
		const vid = this._chatViewerId;
		if (!Number.isFinite(vid) || vid <= 0) {
			this._tearDownConnectChatUserBroadcast();
			return;
		}
		if (this._userBroadcastViewerBound === vid && typeof this._userBroadcastTeardown === 'function') {
			return;
		}
		this._tearDownConnectChatUserBroadcast();
		const v = getAssetVersionParam();
		const qs = getImportQuery(v);
		try {
			const mod = await import(`../../shared/realtimeBroadcast.js${qs}`);
			this._userBroadcastTeardown = await mod.subscribeUserBroadcast(vid, () => {
				void this.loadChatThreads({ forceNetwork: true });
			});
			this._userBroadcastViewerBound = vid;
		} catch (err) {
			console.warn('[Connect chat] user realtime:', err);
		}
	}

	async setupConnectChat() {
		const root = this.querySelector('[data-connect-chat]');
		if (!root) return;

		this._chatViewerId = null;
		this._chatViewerIsAdmin = false;
		this._chatThreads = [];
		/** `_joinedServersForChat` / `_serverDerivedChannelSlugs` come from `loadServers()` + `_hydrateConnectCachesFromStorage()`. Do not clear them here or the Servers section mis-classifies every row (same pitfall as chat sidebar). */
		this._userBroadcastTeardown = null;
		this._userBroadcastViewerBound = null;
		this._presenceOnlineIds = new Set();
		this._dmPresenceGraceMap = new Map();

		const v = getAssetVersionParam();
		const qs = getImportQuery(v);
		const { gearIcon } = await import(`../../icons/svg-strings.js${qs}`);
		this._serverGearSvg = gearIcon('chat-page-sidebar-server-settings-icon');

		const modalsMod = await import(`../modals/chatSidebarModals.js${qs}`);
		this._connectSidebarModals = modalsMod.initChatSidebarModals({
			getThreads: () => this._chatThreads || [],
			getViewerId: () => this._chatViewerId,
			navigateToChatPath: (pathname) => {
				const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
				window.location.assign(path);
			},
			refreshSidebar: () => {
				void this.loadServers({ forceNetwork: true });
				void this.loadChatThreads({ forceNetwork: true });
			}
		});

		this._onConnectSidebarClick = (e) => {
			const settingsBtn = e.target?.closest?.('[data-chat-server-settings]');
			if (settingsBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				const sid = Number(settingsBtn.getAttribute('data-chat-server-settings'));
				if (!Number.isFinite(sid) || sid <= 0) return;
				const canManage = settingsBtn.getAttribute('data-chat-server-can-manage') === '1';
				const modal = document.querySelector('app-modal-server');
				if (modal && typeof modal.open === 'function') {
					modal.open({ mode: canManage ? 'edit' : 'view', serverId: sid });
				}
				return;
			}

			const addBtn = e.target?.closest?.('[data-chat-sidebar-add]');
			if (addBtn instanceof HTMLButtonElement) {
				const kind = addBtn.getAttribute('data-chat-sidebar-add');
				if (kind === 'dm') {
					this._connectSidebarModals?.openDmModal?.();
					return;
				}
				if (kind === 'servers') {
					this._connectSidebarModals?.openServersModal?.();
					return;
				}
				if (kind === 'channels') {
					this._connectSidebarModals?.openChannelsModal?.();
					return;
				}
			}

			const delBtn = e.target?.closest?.('[data-connect-admin-delete]');
			if (delBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				const tid = Number(delBtn.getAttribute('data-connect-admin-delete'));
				const rawLabel = delBtn.getAttribute('data-connect-admin-delete-label') || '';
				let label = '';
				try {
					label = decodeURIComponent(rawLabel).trim();
				} catch {
					label = String(rawLabel).trim();
				}
				if (!Number.isFinite(tid) || tid <= 0) return;
				void this.deleteConnectChatThread(tid, label || `thread ${tid}`);
			}
		};
		root.addEventListener('click', this._onConnectSidebarClick);

		this.setupConnectChatAdminTools();

		await this.loadChatThreads();

		this._connectChatCleanup = () => {
			root.removeEventListener('click', this._onConnectSidebarClick);
			this._tearDownConnectChatUserBroadcast();
		};
	}

	setupConnectChatAdminTools() {
		const btn = this.querySelector('[data-connect-chat-admin-delete]');
		if (!(btn instanceof HTMLButtonElement)) return;
		btn.addEventListener('click', () => {
			const sel = this.querySelector('[data-connect-chat-admin-thread-select]');
			const raw = sel instanceof HTMLSelectElement ? String(sel.value || '').trim() : '';
			const tid = Number(raw);
			if (!Number.isFinite(tid) || tid <= 0) {
				const st = this.querySelector('[data-connect-chat-admin-status]');
				if (st instanceof HTMLElement) {
					st.hidden = false;
					st.textContent = 'Select a thread to delete.';
				}
				return;
			}
			let label = `thread ${tid}`;
			if (sel instanceof HTMLSelectElement) {
				const opt = sel.options[sel.selectedIndex];
				if (opt && typeof opt.textContent === 'string' && opt.textContent.trim()) {
					label = opt.textContent.trim();
				}
			}
			void this.deleteConnectChatThread(tid, label);
		});
	}

	async refreshAdminChatThreadSelect() {
		if (!this._chatViewerIsAdmin) return;
		const sel = this.querySelector('[data-connect-chat-admin-thread-select]');
		if (!(sel instanceof HTMLSelectElement)) return;

		const statusEl = this.querySelector('[data-connect-chat-admin-status]');
		sel.innerHTML = '';
		const loadingOpt = document.createElement('option');
		loadingOpt.value = '';
		loadingOpt.textContent = 'Loading…';
		sel.appendChild(loadingOpt);
		sel.disabled = true;

		try {
			const res = await fetch('/admin/chat/threads', { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Failed to load threads');
			}
			const threads = Array.isArray(data.threads) ? data.threads : [];
			sel.innerHTML = '';
			const placeholder = document.createElement('option');
			placeholder.value = '';
			placeholder.textContent = threads.length === 0 ? 'No threads' : '— Select a thread —';
			sel.appendChild(placeholder);
			for (const t of threads) {
				const id = t?.id != null ? Number(t.id) : null;
				if (!Number.isFinite(id) || id <= 0) continue;
				const opt = document.createElement('option');
				opt.value = String(id);
				opt.textContent = adminChatThreadSelectLabel(t);
				sel.appendChild(opt);
			}
			sel.disabled = threads.length === 0;
		} catch (err) {
			console.error('[Connect chat] admin thread list:', err);
			sel.innerHTML = '';
			const failOpt = document.createElement('option');
			failOpt.value = '';
			failOpt.textContent = 'Could not load threads';
			sel.appendChild(failOpt);
			sel.disabled = true;
			if (statusEl instanceof HTMLElement) {
				statusEl.hidden = false;
				statusEl.textContent = err?.message || 'Loading threads failed.';
			}
		}
	}

	updateConnectChatAdminToolsVisibility() {
		const tools = this.querySelector('[data-connect-chat-admin-tools]');
		if (tools instanceof HTMLElement) {
			const vis = this._chatViewerIsAdmin;
			tools.hidden = !vis;
			if (vis) void this.refreshAdminChatThreadSelect();
		}
	}

	/**
	 * Admin-only: full thread delete via DELETE /admin/chat/threads/:id.
	 * @param {number} threadId
	 * @param {string} [titleForConfirm]
	 */
	async deleteConnectChatThread(threadId, titleForConfirm) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;

		const statusEl = this.querySelector('[data-connect-chat-admin-status]');
		if (statusEl instanceof HTMLElement) {
			statusEl.hidden = true;
			statusEl.textContent = '';
		}

		const label = titleForConfirm && String(titleForConfirm).trim() ? String(titleForConfirm).trim() : `thread ${tid}`;
		const ok = window.confirm(
			`Delete ${label}? All messages and members will be removed. This cannot be undone.`
		);
		if (!ok) return;

		try {
			const res = await fetch(`/admin/chat/threads/${encodeURIComponent(String(tid))}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Could not delete thread');
			}
			if (statusEl instanceof HTMLElement) {
				statusEl.hidden = false;
				statusEl.textContent = 'Thread deleted.';
			}
			const sel = this.querySelector('[data-connect-chat-admin-thread-select]');
			if (sel instanceof HTMLSelectElement) {
				sel.value = '';
			}
			await this.loadChatThreads({ forceNetwork: true });
			await this.refreshAdminChatThreadSelect();
			try {
				clearCachedChatThreads();
			} catch {
				// ignore
			}
		} catch (err) {
			console.error('[Connect chat] delete thread:', err);
			if (statusEl instanceof HTMLElement) {
				statusEl.hidden = false;
				statusEl.textContent = err?.message || 'Delete failed.';
			}
		}
	}

	async _fetchPresenceOnlineIds() {
		try {
			const res = await fetch('/api/presence/online', { credentials: 'include' });
			if (!res.ok) return new Set();
			const data = await res.json().catch(() => ({}));
			const users = Array.isArray(data.users) ? data.users : [];
			const set = new Set();
			for (const u of users) {
				const id = Number(u.user_id);
				if (Number.isFinite(id) && id > 0) set.add(id);
			}
			return set;
		} catch {
			return new Set();
		}
	}

	/** Presence is non-blocking: paint roster first, then refresh DM online dots. */
	async _refreshPresenceAndRender() {
		try {
			this._presenceOnlineIds = await this._fetchPresenceOnlineIds();
		} catch {
			this._presenceOnlineIds = new Set();
		}
		this.renderConnectChatThreadList();
	}

	async loadChatThreads(options = {}) {
		const forceNetwork = options.forceNetwork === true;
		const scrollRoot = this.querySelector('[data-connect-chat-scroll]');
		const listsRoot = this.querySelector('[data-connect-chat-lists]');
		const unauthEl = this.querySelector('[data-connect-chat-unauth]');
		if (!scrollRoot) return;

		const cached = readCachedChatThreads();
		const needNetwork =
			forceNetwork || !cached || isChatThreadsCacheStale(cached.cachedAt);

		if (cached) {
			this._chatViewerId = cached.viewerId;
			this._chatThreads = cached.threads;
			this._chatViewerIsAdmin = Boolean(cached.viewerIsAdmin);
			this.updateConnectChatAdminToolsVisibility();
			this.renderConnectChatThreadList();
			void this._refreshPresenceAndRender();
		}

		if (!needNetwork) {
			void this._bindConnectChatUserBroadcast();
			return;
		}

		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/chat/threads',
				{ credentials: 'include' },
				{ windowMs: 2000 }
			);
			if (!result.ok) {
				if (result.status === 401) {
					this._tearDownConnectChatUserBroadcast();
					clearCachedChatThreads();
					try {
						clearConnectServersCache();
					} catch {
						// ignore
					}
					scrollRoot.removeAttribute('aria-busy');
					scrollRoot.removeAttribute('aria-label');
					if (listsRoot instanceof HTMLElement) listsRoot.hidden = true;
					if (unauthEl instanceof HTMLElement) {
						unauthEl.hidden = false;
						unauthEl.innerHTML = renderEmptyState({
							title: 'Sign in to use chat.',
							message: 'You need an account to see conversations and messages.'
						});
					}
					return;
				}
				if (cached) {
					return;
				}
				throw new Error(result.data?.message || 'Failed to load conversations');
			}
			const viewerId = result.data?.viewer_id != null ? Number(result.data.viewer_id) : null;
			const threads = Array.isArray(result.data?.threads) ? result.data.threads : [];
			const viewerIsAdmin = Boolean(result.data?.viewer_is_admin);
			this._chatViewerId = viewerId;
			this._chatThreads = threads;
			this._chatViewerIsAdmin = viewerIsAdmin;
			this.updateConnectChatAdminToolsVisibility();
			if (viewerId != null && Number.isFinite(viewerId)) {
				writeCachedChatThreads(viewerId, threads, { viewerIsAdmin });
			}
			if (listsRoot instanceof HTMLElement) listsRoot.hidden = false;
			if (unauthEl instanceof HTMLElement) {
				unauthEl.hidden = true;
				unauthEl.innerHTML = '';
			}
			this.renderConnectChatThreadList();
			void this._refreshPresenceAndRender();
			void this._bindConnectChatUserBroadcast();
		} catch (err) {
			console.error('[Connect chat] load threads:', err);
			if (cached) {
				return;
			}
			scrollRoot.removeAttribute('aria-busy');
			scrollRoot.removeAttribute('aria-label');
			if (listsRoot instanceof HTMLElement) listsRoot.hidden = true;
			if (unauthEl instanceof HTMLElement) {
				unauthEl.hidden = false;
				unauthEl.innerHTML = renderEmptyError(err?.message || 'Chat unavailable.');
			}
		}
	}

	/** Merge GET /api/chat/threads with joined servers (same as chat sidebar roster). */
	_getMergedChatThreadRows() {
		const threads = Array.isArray(this._chatThreads) ? this._chatThreads : [];
		const joined = Array.isArray(this._joinedServersForChat) ? this._joinedServersForChat : [];
		const merged =
			typeof mergeThreadRowsWithJoinedServers === 'function'
				? mergeThreadRowsWithJoinedServers(threads, joined)
				: [];
		return appendReservedPseudoChannels ? appendReservedPseudoChannels(merged) : merged;
	}

	renderConnectChatThreadList() {
		const listRoot = this.querySelector('[data-connect-chat-scroll]');
		const listsRoot = this.querySelector('[data-connect-chat-lists]');
		const unauthEl = this.querySelector('[data-connect-chat-unauth]');
		const dmEl = this.querySelector('[data-chat-sidebar-users]');
		const svEl = this.querySelector('[data-chat-sidebar-servers]');
		const chEl = this.querySelector('[data-chat-sidebar-channels]');
		if (!listRoot || !dmEl || !svEl || !chEl) return;

		if (listsRoot instanceof HTMLElement) listsRoot.hidden = false;
		if (unauthEl instanceof HTMLElement) {
			unauthEl.hidden = true;
			unauthEl.innerHTML = '';
		}

		listRoot.removeAttribute('aria-busy');
		listRoot.removeAttribute('aria-label');

		const merged = this._getMergedChatThreadRows();
		const joinedArr = Array.isArray(this._joinedServersForChat) ? this._joinedServersForChat : [];
		const joinedSorted = [...joinedArr].sort((a, b) => Number(a.id) - Number(b.id));
		const joinedSlugs = new Set();
		for (const s of joinedSorted) {
			const tag = serverChannelTagFromServerName(typeof s?.name === 'string' ? s.name : '');
			if (tag) joinedSlugs.add(tag.toLowerCase());
		}
		const dms = merged.filter((t) => t && t.type === 'dm');
		const channelRows = merged.filter((t) => t && t.type === 'channel');
		const serverChannels = channelRows.filter((t) => {
			const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
			return Boolean(slug && joinedSlugs.has(slug));
		});
		const otherChannels = channelRows.filter((t) => {
			const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
			return !slug || !joinedSlugs.has(slug);
		});

		const deps = { renderCommentAvatarHtml, getAvatarColor };
		const onlineIds = this._presenceOnlineIds instanceof Set ? this._presenceOnlineIds : new Set();
		const gearSvg = typeof this._serverGearSvg === 'string' ? this._serverGearSvg : '';

		const joinedServerMetaForSlug = (slug) => {
			const key = String(slug || '').trim().toLowerCase();
			if (!key) return null;
			for (const s of joinedSorted) {
				const tag = serverChannelTagFromServerName(typeof s?.name === 'string' ? s.name : '');
				if (tag && tag.toLowerCase() === key) return s;
			}
			return null;
		};

		const rowHtml = (t) => {
			const href = buildChatThreadUrl(t);
			const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
			const avatarHtml = buildChatThreadRowAvatarHtml(t, deps);
			let presenceClass = '';
			if (t.type === 'dm') {
				const oid = typeof getDmOtherUserId === 'function' ? getDmOtherUserId(t) : null;
				const online = isDmConsideredOnlineWithGrace(oid, onlineIds, this._dmPresenceGraceMap);
				presenceClass = online ? 'is-online' : 'is-offline';
			}
			const pc = presenceClass ? ` ${presenceClass}` : '';
			const unc = Number(t.unread_count);
			const showUnread = Number.isFinite(unc) && unc > 0;
			const unreadLabel = unc > 99 ? '99+' : String(unc);
			const unreadHtml = showUnread
				? `<span class="chat-page-sidebar-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>`
				: '';
			return `<a class="chat-page-sidebar-row${pc}" href="${escapeHtml(href)}">
				${avatarHtml}
				<div class="chat-page-sidebar-row-body">
					<div class="chat-page-sidebar-row-title-line">
						<span class="chat-page-sidebar-row-title">${escapeHtml(title)}</span>
						${unreadHtml}
					</div>
				</div>
			</a>`;
		};

		const serverRowHtml = (t) => {
			const href = buildChatThreadUrl(t);
			const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
			const avatarHtml = buildChatThreadRowAvatarHtml(t, deps);
			const unc = Number(t.unread_count);
			const showUnread = Number.isFinite(unc) && unc > 0;
			const unreadLabel = unc > 99 ? '99+' : String(unc);
			const unreadHtml = showUnread
				? `<span class="chat-page-sidebar-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>`
				: '';
			const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
			const meta = joinedServerMetaForSlug(slug);
			const gearHtml =
				meta && Number.isFinite(Number(meta.id)) && Number(meta.id) > 0
					? `<button type="button" class="chat-page-sidebar-server-settings" data-chat-server-settings="${Number(meta.id)}" data-chat-server-can-manage="${meta.can_manage ? '1' : '0'}" aria-label="Server details">${gearSvg}</button>`
					: '';
			return `<div class="chat-page-sidebar-row chat-page-sidebar-row--server">
				<a class="chat-page-sidebar-row-link" href="${escapeHtml(href)}">
					${avatarHtml}
					<div class="chat-page-sidebar-row-body">
						<div class="chat-page-sidebar-row-title-line">
							<span class="chat-page-sidebar-row-title">${escapeHtml(title)}</span>
							${unreadHtml}
						</div>
					</div>
				</a>
				${gearHtml}
			</div>`;
		};

		const channelRowOrAdminWrap = (t) => {
			const slugLower =
				typeof t.channel_slug === 'string' && t.channel_slug.trim()
					? t.channel_slug.trim().toLowerCase()
					: '';
			const threadId = t.id != null ? Number(t.id) : null;
			const slugSetReady = this._serverDerivedChannelSlugs instanceof Set;
			const isServerLinkedChannel =
				t.type === 'channel' &&
				Boolean(slugLower) &&
				slugSetReady &&
				this._serverDerivedChannelSlugs.has(slugLower);
			const showDelete =
				this._chatViewerIsAdmin &&
				Number.isFinite(threadId) &&
				threadId > 0 &&
				t.type !== 'dm' &&
				slugSetReady &&
				!isServerLinkedChannel;
			const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
			const inner = rowHtml(t);
			if (!showDelete) return inner;
			const encLabel = encodeURIComponent(title);
			return `<div class="connect-chat-thread-row-wrap connect-chat-sidebar-admin-row">
				${inner}
				<button type="button" class="btn-danger btn-inline connect-chat-thread-delete" data-connect-admin-delete="${threadId}" data-connect-admin-delete-label="${encLabel}" aria-label="Delete chat thread ${threadId}">Delete</button>
			</div>`;
		};

		dmEl.innerHTML = dms.length
			? dms.map(rowHtml).join('')
			: '<p class="chat-page-sidebar-empty">No direct messages yet.</p>';
		svEl.innerHTML = serverChannels.length
			? serverChannels.map(serverRowHtml).join('')
			: '<p class="chat-page-sidebar-empty">No servers joined yet.</p>';
		chEl.innerHTML = otherChannels.length
			? otherChannels.map(channelRowOrAdminWrap).join('')
			: '<p class="chat-page-sidebar-empty">No channels yet.</p>';

		try {
			document.dispatchEvent(new CustomEvent('chat-unread-refresh'));
		} catch {
			// ignore
		}
	}

	_applyServersNetworkResult(servers) {
		const list = Array.isArray(servers) ? servers : [];
		if (typeof serverChannelTagFromServerName === 'function') {
			this._serverDerivedChannelSlugs = new Set();
			for (const s of list) {
				const tag = serverChannelTagFromServerName(typeof s?.name === 'string' ? s.name : '');
				if (tag) this._serverDerivedChannelSlugs.add(String(tag).toLowerCase());
			}
		} else {
			this._serverDerivedChannelSlugs = null;
		}
		this._joinedServersForChat = list
			.filter((s) => s && s.is_member)
			.map((s) => ({
				id: Number(s.id),
				name: typeof s.name === 'string' ? s.name.trim() : '',
				can_manage: Boolean(s.can_manage)
			}))
			.filter((s) => Number.isFinite(s.id) && s.id > 0);
	}

	_derivedSlugListFromServers(servers) {
		const list = Array.isArray(servers) ? servers : [];
		const out = [];
		if (typeof serverChannelTagFromServerName !== 'function') return out;
		for (const s of list) {
			const tag = serverChannelTagFromServerName(typeof s?.name === 'string' ? s.name : '');
			if (tag) out.push(String(tag).toLowerCase());
		}
		return out;
	}

	/**
	 * Cache-first: paint from localStorage when fresh; refetch when stale, viewer mismatch, or forceNetwork.
	 */
	async loadServers({ forceNetwork = false } = {}) {
		const container = this.querySelector('[data-servers-container]');
		const viewerId =
			this._chatViewerId != null && Number.isFinite(Number(this._chatViewerId))
				? Number(this._chatViewerId)
				: null;

		const cached = readConnectServersCache();
		const cacheMatchesViewer =
			cached &&
			viewerId != null &&
			cached.viewerId === viewerId &&
			Array.isArray(cached.joinedServers) &&
			Array.isArray(cached.derivedSlugs);

		const networkNeeded =
			forceNetwork ||
			!cacheMatchesViewer ||
			(cached && isConnectServersCacheStale(cached.cachedAt));

		if (cacheMatchesViewer) {
			this._joinedServersForChat = cached.joinedServers;
			this._serverDerivedChannelSlugs = new Set(
				(cached.derivedSlugs || []).map((s) => String(s).toLowerCase())
			);
			if (container) {
				container.removeAttribute('aria-busy');
				container.removeAttribute('aria-label');
			}
			this.renderConnectChatThreadList();
		}

		if (!networkNeeded) {
			return;
		}

		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load servers');
			}

			if (container) {
				container.removeAttribute('aria-busy');
				container.removeAttribute('aria-label');
			}
			const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
			const viewerIsAdmin = Boolean(result.data?.viewer_is_admin);
			this._applyServersNetworkResult(servers);

			const vid = this._chatViewerId != null && Number.isFinite(Number(this._chatViewerId))
				? Number(this._chatViewerId)
				: null;
			if (vid != null && Number.isFinite(vid)) {
				writeConnectServersCache(vid, this._joinedServersForChat, this._derivedSlugListFromServers(servers));
			}

			if (container) {
				this.renderServers(servers, container, viewerIsAdmin);
			}
			this.renderConnectChatThreadList();
		} catch (error) {
			if (container) {
				container.removeAttribute('aria-busy');
				container.removeAttribute('aria-label');
				container.innerHTML = renderEmptyError('Error loading servers.');
			}
		}
	}

	renderServers(servers, container, viewerIsAdmin = false) {
		container.innerHTML = '';

		// Rely on server-side (ID ascending) ordering so client matches API.
		const sortedServers = [...servers];

		sortedServers.forEach(server => {
			const card = document.createElement('div');
			card.className = 'card admin-card server-card';
			card.dataset.serverId = server.id;
			card.style.cursor = 'pointer';

			const badges = [];
			// Admin-only: show suspended tag (only admins see suspended servers in the list).
			if (server.suspended) {
				badges.push('<span class="server-badge server-badge-suspended">Suspended</span>');
			}
			// Special "home" server (id = 1) has a dedicated Home tag.
			if (server.id === 1) {
				badges.push('<span class="server-badge server-badge-member">Home</span>');
			} else {
				if (server.is_owner) {
					badges.push('<span class="server-badge server-badge-owner">Owned</span>');
				}
				if (server.is_member && !server.is_owner) {
					badges.push('<span class="server-badge server-badge-member">Joined</span>');
				}
			}

			const name = document.createElement('div');
			name.className = 'admin-title';
			name.innerHTML = `${server.name || 'Unnamed Server'} ${badges.join('')}`;

			const hasDescription = typeof server.description === 'string' && server.description.trim().length > 0;
			const descriptionText = hasDescription ? server.description.trim() : '';

			card.appendChild(name);

			if (hasDescription) {
				const desc = document.createElement('div');
				desc.className = 'admin-detail server-card-description';
				desc.textContent = descriptionText;
				card.appendChild(desc);
			}

			// Add owner information if available.
			// Intentionally non-clickable so it doesn't interfere with card click to open the modal.
			if (server.owner && server.id !== 1) {
				const owner = server.owner;
				const ownerDisplayName = owner.display_name || `User ${owner.id}`;
				const ownerUserName = owner.user_name || owner.email_prefix || null;
				const ownerAvatarUrl = owner.avatar_url || null;
				const ownerInitial = ownerDisplayName.trim().charAt(0).toUpperCase() || '?';
				const ownerColor = getAvatarColor(owner.user_name || owner.email_prefix || String(owner.id || ''));

				const ownerInfo = document.createElement('div');
				ownerInfo.className = 'server-owner';

				const ownerRow = document.createElement('div');
				ownerRow.className = 'server-owner-link';

				const avatar = document.createElement('div');
				avatar.className = 'server-owner-avatar';
				avatar.style.background = ownerColor;
				if (ownerAvatarUrl) {
					const img = document.createElement('img');
					img.src = ownerAvatarUrl;
					img.className = 'server-owner-avatar-img';
					img.alt = '';
					avatar.appendChild(img);
				} else {
					avatar.textContent = ownerInitial;
				}

				const ownerText = document.createElement('span');
				ownerText.className = 'server-owner-text';
				ownerText.innerHTML = html`
					<span class="server-owner-name">${ownerDisplayName}</span>
					${ownerUserName ? html`<span class="server-owner-handle">@${ownerUserName}</span>` : ''}
				`;

				ownerRow.appendChild(avatar);
				ownerRow.appendChild(ownerText);
				ownerInfo.appendChild(ownerRow);
				card.appendChild(ownerInfo);
			}

			// Status and timestamp on one line (admin only)
			if (viewerIsAdmin) {
				const meta = document.createElement('div');
				meta.className = 'admin-meta';
				const statusText = server.status || 'unknown';
				const memberText = (typeof server.members_count === 'number' && server.id !== 1)
					? ` • ${server.members_count} member${server.members_count !== 1 ? 's' : ''}`
					: '';
				const timeText = server.created_at ? formatRelativeTime(server.created_at, { style: 'long' }) : '—';
				meta.textContent = `${statusText}${memberText} • ${timeText}`;
				card.appendChild(meta);
			}

			// Click card to view details
			card.addEventListener('click', () => {
				const modal = document.querySelector('app-modal-server');
				if (modal) {
					modal.open({
						mode: server.can_manage ? 'edit' : 'view',
						serverId: server.id
					});
				}
			});

			container.appendChild(card);
		});

		// Ghost card for adding a custom server (always last).
		const ghostCard = document.createElement('button');
		ghostCard.type = 'button';
		ghostCard.className = 'card server-card server-card-ghost';
		ghostCard.setAttribute('aria-label', 'Add custom server');

		const ghostTitle = document.createElement('div');
		ghostTitle.className = 'server-card-ghost-title';
		ghostTitle.textContent = 'Add custom server';

		const ghostSubtitle = document.createElement('div');
		ghostSubtitle.className = 'server-card-ghost-subtitle';
		ghostSubtitle.textContent = 'Register your own image generation server.';

		ghostCard.appendChild(ghostTitle);
		ghostCard.appendChild(ghostSubtitle);

		ghostCard.addEventListener('click', () => {
			const modal = document.querySelector('app-modal-server');
			if (modal) {
				modal.open({ mode: 'add' });
			}
		});

		container.appendChild(ghostCard);
	}
}

customElements.define('app-route-servers', AppRouteServers);
