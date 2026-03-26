let formatRelativeTime;
let fetchJsonWithStatusDeduped;
let readCachedChatThreads;
let writeCachedChatThreads;
let clearCachedChatThreads;
let isChatThreadsCacheStale;
let getAvatarColor;
let fetchLatestComments;
let processUserText;
let hydrateUserTextLinks;
let renderEmptyState;
let renderEmptyError;
let renderCommentRowsSkeleton;
let renderServerCardsSkeleton;
let attachAutoGrowTextarea;
let buildProfilePath;
let renderCommentAvatarHtml;
let REACTION_ORDER;
let REACTION_ICONS;
let setupReactionTooltipTap;
let serverChannelTagFromServerName;

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

		const avatarMod = await import(`../../shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;

		const commentsMod = await import(`../../shared/comments.js${qs}`);
		fetchLatestComments = commentsMod.fetchLatestComments;

		const userTextMod = await import(`../../shared/userText.js${qs}`);
		processUserText = userTextMod.processUserText;
		hydrateUserTextLinks = userTextMod.hydrateUserTextLinks;

		const emptyStateMod = await import(`../../shared/emptyState.js${qs}`);
		renderEmptyState = emptyStateMod.renderEmptyState;
		renderEmptyError = emptyStateMod.renderEmptyError;

		const skeletonMod = await import(`../../shared/skeleton.js${qs}`);
		renderCommentRowsSkeleton = skeletonMod.renderCommentRowsSkeleton;
		renderServerCardsSkeleton = skeletonMod.renderServerCardsSkeleton;

		const autogrowMod = await import(`../../shared/autogrow.js${qs}`);
		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;

		const profileLinksMod = await import(`../../shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;

		const commentItemMod = await import(`../../shared/commentItem.js${qs}`);
		renderCommentAvatarHtml = commentItemMod.renderCommentAvatarHtml;

		const tooltipTapMod = await import(`../../shared/reactionTooltipTap.js${qs}`);
		setupReactionTooltipTap = tooltipTapMod.setupReactionTooltipTap;

		const serverChatTagMod = await import(`../../shared/serverChatTag.js${qs}`);
		serverChannelTagFromServerName = serverChatTagMod.serverChannelTagFromServerName;

		const iconsMod = await import(`../../icons/svg-strings.js${qs}`);
		REACTION_ORDER = iconsMod.REACTION_ORDER;
		REACTION_ICONS = iconsMod.REACTION_ICONS;
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

const CONNECT_HASH_TAB_IDS = ['chat', 'latest-comments', 'servers', 'feature-requests'];
const CONNECT_HASH_ALIASES = { comments: 'latest-comments' };

/** Parse `/connect` location hash: #chat, #latest-comments, #servers, … (tab id only). */
function parseConnectLocationHash(hash) {
	const raw = (hash || '').replace(/^#/, '');
	if (!raw) return { tab: null };
	const first = raw.split('/')[0].trim().toLowerCase();
	const head = (CONNECT_HASH_ALIASES[first] || first).toLowerCase();
	if (CONNECT_HASH_TAB_IDS.includes(head)) return { tab: head };
	return { tab: null };
}

function buildChatThreadUrl(meta) {
	if (!meta) return '/connect#chat';
	if (meta.type === 'channel' && meta.channel_slug) {
		return `/chat/c/${encodeURIComponent(String(meta.channel_slug))}`;
	}
	if (meta.type === 'dm') {
		const un = typeof meta.other_user?.user_name === 'string' ? meta.other_user.user_name.trim() : '';
		if (un) {
			return `/chat/dm/${encodeURIComponent(un.toLowerCase())}`;
		}
		if (Number.isFinite(Number(meta.other_user_id))) {
			return `/chat/dm/${encodeURIComponent(String(meta.other_user_id))}`;
		}
	}
	const id = Number(meta.id);
	if (Number.isFinite(id) && id > 0) {
		return `/chat/t/${encodeURIComponent(String(id))}`;
	}
	return '/connect#chat';
}

/** Avatar for Connect chat thread rows: DM uses profile image or initial; channel uses # on getAvatarColor(slug). */
function buildConnectChatThreadAvatarHtml(t) {
	if (t?.type === 'dm') {
		const ou = t.other_user;
		const displayName =
			(typeof ou?.display_name === 'string' && ou.display_name.trim()) ||
			(typeof ou?.user_name === 'string' && ou.user_name.trim()) ||
			(typeof t.title === 'string' && t.title.trim().startsWith('@')
				? t.title.trim().slice(1)
				: String(t.title || '').trim()) ||
			'User';
		const seed =
			(typeof ou?.user_name === 'string' && ou.user_name.trim()) ||
			(ou?.id != null ? String(ou.id) : '') ||
			displayName;
		const avatarUrl = ou && typeof ou.avatar_url === 'string' ? ou.avatar_url.trim() : '';
		return renderCommentAvatarHtml({
			avatarUrl,
			displayName,
			color: getAvatarColor(seed),
			href: '',
			isFounder: false,
			flairSize: 'xs'
		});
	}
	const slugRaw =
		(typeof t?.channel_slug === 'string' && t.channel_slug.trim()) ||
		(typeof t?.title === 'string' && t.title.trim().startsWith('#')
			? t.title.trim().slice(1)
			: '') ||
		'';
	const color = getAvatarColor(slugRaw.toLowerCase() || 'channel');
	return `<div class="comment-avatar connect-chat-thread-row-channel-avatar" style="background: ${color};" aria-hidden="true">#</div>`;
}

class AppRouteServers extends HTMLElement {
	async connectedCallback() {
		await loadDeps();
		this.innerHTML = html`
	<div class="servers-route">
		<div class="route-header">
			<h3>Connect</h3>
			<p>See what the community is talking about, manage your image generation servers, and send feature requests
				directly to the team.</p>
		</div>
		<app-tabs>
			<tab data-id="chat" label="Chat" default>
				<div class="connect-chat" data-connect-chat>
					<div class="connect-chat-toolbar">
						<label class="connect-chat-label" for="connect-chat-channel-input">Open a channel</label>
						<div class="connect-chat-toolbar-row">
							<input type="text" id="connect-chat-channel-input" class="connect-chat-input"
								placeholder="e.g. pixelart" maxlength="40" autocomplete="off" data-connect-chat-tag-input />
							<button type="button" class="btn-primary connect-chat-open-channel"
								data-connect-chat-open-channel>Open</button>
						</div>
						<p class="connect-chat-hint">Tags match Explore: lowercase, 2–32 characters, letters, numbers,
							<code>_</code> and <code>-</code>. Opens in full-screen chat.</p>
					</div>
					<div class="connect-chat-sidebar">
						<div class="connect-chat-thread-list" data-connect-chat-thread-list aria-busy="true"
							aria-label="Loading conversations"></div>
					</div>
					<p class="connect-chat-error" data-connect-chat-error hidden></p>
				</div>
			</tab>
			<tab data-id="latest-comments" label="Comments">
				<div class="comment-list" data-comments-container aria-busy="true" aria-label="Loading">
					${renderCommentRowsSkeleton(10)}
				</div>
			</tab>
	
			<tab data-id="servers" label="Servers">
				<div class="route-cards admin-cards" data-servers-container aria-busy="true" aria-label="Loading">
					${renderServerCardsSkeleton(4)}
				</div>
			</tab>
	
			<tab data-id="feature-requests" label="Feedback">
				<div class="route-header">
					<p>Tell us what you want to see next. We read every submission.</p>
				</div>
				<div class="alert" data-feature-request-status hidden></div>
				<form data-feature-request-form>
					<textarea name="message" rows="10" maxlength="5000"
						placeholder="What should we build? What problem does it solve?" aria-label="Feature request details"
						data-feature-request-message required></textarea>
					<button type="submit" class="btn-primary btn-inline" data-feature-request-submit>Send</button>
				</form>
			</tab>
		</app-tabs>
	</div>
    `;

		this._appDocTitleBase = typeof document !== 'undefined' ? document.title : 'parascene';

		this.loadLatestComments();
		this.loadServers();
		this.setupFeatureRequestForm();
		this.setupConnectChat();
		this.setupConnectTabHash();
		this._onServersUpdated = () => this.loadServers();
		document.addEventListener('servers-updated', this._onServersUpdated);
	}

	/** Sync Connect tab from URL hash (#chat, #servers, …). */
	setupConnectTabHash() {
		const syncTabFromHash = () => {
			const path = window.location.pathname || '';
			if (path !== '/connect' && !path.startsWith('/connect/')) return;
			const parsed = parseConnectLocationHash(window.location.hash);
			if (!parsed.tab) return;
			const tabs = this.querySelector('app-tabs');
			if (!tabs || typeof tabs.setActiveTab !== 'function') return;
			tabs.setActiveTab(parsed.tab, { focus: false });
		};

		const onRouteChange = (e) => {
			if (e.detail?.route === 'connect') syncTabFromHash();
		};

		const onHashChange = () => syncTabFromHash();

		setTimeout(() => {
			if (document.documentElement?.dataset?.route === 'connect') syncTabFromHash();
		}, 0);

		document.addEventListener('route-change', onRouteChange);
		window.addEventListener('hashchange', onHashChange);

		const tabs = this.querySelector('app-tabs');
		if (tabs) {
			tabs.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (!id) return;
				const path = window.location.pathname || '';
				if (path !== '/connect' && !path.startsWith('/connect/')) return;
				const newHash = `#${id}`;
				if (window.location.hash !== newHash) {
					window.history.replaceState(null, '', `/connect${newHash}`);
				}
			});
		}

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

	setupConnectChat() {
		const root = this.querySelector('[data-connect-chat]');
		if (!root) return;

		this._chatViewerId = null;
		this._chatThreads = [];
		this._joinedServersForChat = [];
		this._userBroadcastTeardown = null;
		this._userBroadcastViewerBound = null;

		this._onTabChangeForChat = (e) => {
			if (e.detail?.id !== 'chat') return;
			const ourTabs = this.querySelector('app-tabs');
			if (e.target !== ourTabs) return;
			this.loadChatThreads();
		};
		document.addEventListener('tab-change', this._onTabChangeForChat);

		const openChannelBtn = root.querySelector('[data-connect-chat-open-channel]');
		const tagInput = root.querySelector('[data-connect-chat-tag-input]');

		if (openChannelBtn instanceof HTMLButtonElement && tagInput instanceof HTMLInputElement) {
			openChannelBtn.addEventListener('click', () => this.openConnectChatChannel());
			tagInput.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					this.openConnectChatChannel();
				}
			});
		}

		this.loadChatThreads();

		this._connectChatCleanup = () => {
			document.removeEventListener('tab-change', this._onTabChangeForChat);
			this._tearDownConnectChatUserBroadcast();
		};
	}

	async loadChatThreads(options = {}) {
		const forceNetwork = options.forceNetwork === true;
		const listEl = this.querySelector('[data-connect-chat-thread-list]');
		if (!listEl) return;

		const cached = readCachedChatThreads();
		const needNetwork =
			forceNetwork || !cached || isChatThreadsCacheStale(cached.cachedAt);

		if (cached) {
			this._chatViewerId = cached.viewerId;
			this._chatThreads = cached.threads;
			this.renderConnectChatThreadList();
			const errEl = this.querySelector('[data-connect-chat-error]');
			if (errEl instanceof HTMLElement) {
				errEl.hidden = true;
				errEl.textContent = '';
			}
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
					listEl.removeAttribute('aria-busy');
					listEl.removeAttribute('aria-label');
					listEl.innerHTML = renderEmptyState({
						title: 'Sign in to use chat.',
						message: 'You need an account to open channels and DMs.'
					});
					return;
				}
				if (cached) {
					return;
				}
				throw new Error(result.data?.message || 'Failed to load conversations');
			}
			const viewerId = result.data?.viewer_id != null ? Number(result.data.viewer_id) : null;
			const threads = Array.isArray(result.data?.threads) ? result.data.threads : [];
			this._chatViewerId = viewerId;
			this._chatThreads = threads;
			if (viewerId != null && Number.isFinite(viewerId)) {
				writeCachedChatThreads(viewerId, threads);
			}
			this.renderConnectChatThreadList();
			void this._bindConnectChatUserBroadcast();
			const errEl = this.querySelector('[data-connect-chat-error]');
			if (errEl instanceof HTMLElement) {
				errEl.hidden = true;
				errEl.textContent = '';
			}
		} catch (err) {
			console.error('[Connect chat] load threads:', err);
			if (cached) {
				return;
			}
			listEl.removeAttribute('aria-busy');
			listEl.removeAttribute('aria-label');
			listEl.innerHTML = renderEmptyError(err?.message || 'Chat unavailable.');
		}
	}

	/** Merge GET /api/chat/threads with joined servers (slug from server name only; deduped vs threads and duplicate names). */
	_getMergedChatThreadRows() {
		const threads = Array.isArray(this._chatThreads) ? this._chatThreads : [];
		const existingSlugs = new Set();
		for (const t of threads) {
			if (t && t.type === 'channel' && t.channel_slug) {
				existingSlugs.add(String(t.channel_slug).toLowerCase());
			}
		}
		const tagFn =
			typeof serverChannelTagFromServerName === 'function'
				? serverChannelTagFromServerName
				: null;
		const joined = Array.isArray(this._joinedServersForChat) ? this._joinedServersForChat : [];
		const joinedSorted = [...joined].sort((a, b) => Number(a.id) - Number(b.id));
		const extras = [];
		const usedExtraSlugs = new Set();
		for (const s of joinedSorted) {
			const nameRaw = typeof s?.name === 'string' ? s.name : '';
			const slug = tagFn ? tagFn(nameRaw) : null;
			const key = slug ? slug.toLowerCase() : '';
			if (!slug || existingSlugs.has(key) || usedExtraSlugs.has(key)) continue;
			usedExtraSlugs.add(key);
			extras.push({
				type: 'channel',
				channel_slug: slug,
				title: `#${slug}`,
				last_message: null,
				unread_count: 0,
				last_read_message_id: null
			});
		}
		return [...threads, ...extras];
	}

	renderConnectChatThreadList() {
		const listEl = this.querySelector('[data-connect-chat-thread-list]');
		if (!listEl) return;

		listEl.removeAttribute('aria-busy');
		listEl.removeAttribute('aria-label');
		listEl.innerHTML = '';

		const rows = this._getMergedChatThreadRows();
		if (rows.length === 0) {
			listEl.innerHTML = renderEmptyState({
				title: 'No conversations yet.',
				message: 'Open a channel above to get started.'
			});
			return;
		}

		rows.forEach((t) => {
			const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
			const last = t.last_message;
			const preview = last && typeof last.body === 'string'
				? last.body.trim().replace(/\s+/g, ' ').slice(0, 120)
				: '';
			const unc = Number(t.unread_count);
			const showUnread = Number.isFinite(unc) && unc > 0;
			const unreadLabel = unc > 99 ? '99+' : String(unc);

			const row = document.createElement('a');
			row.className = 'connect-chat-thread-row';
			row.href = buildChatThreadUrl(t);
			const avatarHtml = buildConnectChatThreadAvatarHtml(t);
			row.innerHTML = `
				${avatarHtml}
				<div class="connect-chat-thread-row-body">
					<div class="connect-chat-thread-row-title-line">
						<span class="connect-chat-thread-row-title">${escapeHtml(title)}</span>
						${showUnread ? `<span class="connect-chat-thread-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>` : ''}
					</div>
					${preview ? `<span class="connect-chat-thread-row-preview">${escapeHtml(preview)}</span>` : ''}
				</div>
			`;
			listEl.appendChild(row);
		});
		try {
			document.dispatchEvent(new CustomEvent('chat-unread-refresh'));
		} catch {
			// ignore
		}
	}

	async openConnectChatChannel() {
		const input = this.querySelector('[data-connect-chat-tag-input]');
		const errEl = this.querySelector('[data-connect-chat-error]');
		if (!(input instanceof HTMLInputElement)) return;

		const raw = String(input.value || '').trim();
		if (!raw) {
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = 'Enter a channel tag.';
			}
			return;
		}
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}

		try {
			const res = await fetch('/api/chat/channels', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tag: raw })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Could not open channel');
			}
			const slug = (data?.thread?.channel_slug && String(data.thread.channel_slug).trim())
				? String(data.thread.channel_slug).trim()
				: raw.toLowerCase().trim();
			input.value = '';
			window.location.href = `/chat/c/${encodeURIComponent(slug)}`;
		} catch (err) {
			console.error('[Connect chat] open channel:', err);
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = err?.message || 'Could not open channel.';
			}
		}
	}

	async loadLatestComments() {
		const container = this.querySelector('[data-comments-container]');
		if (!container) return;

		try {
			const result = await fetchLatestComments({ limit: 10 });
			if (!result.ok) {
				throw new Error('Failed to load comments');
			}
			container.removeAttribute('aria-busy');
			container.removeAttribute('aria-label');
			const comments = Array.isArray(result.data?.comments) ? result.data.comments : [];
			this.renderLatestComments(comments, container);
		} catch (err) {
			container.removeAttribute('aria-busy');
			container.removeAttribute('aria-label');
			console.error('[Connect] Error loading comments:', err);
			container.innerHTML = renderEmptyError('Error loading comments.');
		}
	}

	renderLatestComments(comments, container) {
		container.innerHTML = '';

		if (!Array.isArray(comments) || comments.length === 0) {
			container.innerHTML = renderEmptyState({ title: 'No recent comments yet.' });
			return;
		}

		container.classList.add('connect-comment-list');

		comments.forEach((comment) => {
			const createdImageId = Number(comment?.created_image_id);
			const href = (Number.isFinite(createdImageId) && createdImageId > 0) ? `/creations/${createdImageId}` : null;

			const displayName = (typeof comment?.display_name === 'string' && comment.display_name.trim())
				? comment.display_name.trim()
				: '';
			const userName = (typeof comment?.user_name === 'string' && comment.user_name.trim())
				? comment.user_name.trim()
				: '';
			const fallbackName = userName ? userName : 'User';
			const commenterName = displayName || fallbackName;
			const commenterHandle = userName ? `@${userName}` : '';

			const createdImageTitle = (typeof comment?.created_image_title === 'string' && comment.created_image_title.trim())
				? comment.created_image_title.trim()
				: (Number.isFinite(createdImageId) && createdImageId > 0 ? `Creation ${createdImageId}` : 'Creation');

			const creatorDisplayName = (typeof comment?.created_image_display_name === 'string' && comment.created_image_display_name.trim())
				? comment.created_image_display_name.trim()
				: '';
			const creatorUserName = (typeof comment?.created_image_user_name === 'string' && comment.created_image_user_name.trim())
				? comment.created_image_user_name.trim()
				: '';
			const creator = creatorDisplayName || (creatorUserName ? `@${creatorUserName}` : '');

			const row = document.createElement('div');
			row.className = `connect-comment${href ? '' : ' is-disabled'}`;
			if (href) {
				row.setAttribute('role', 'link');
				row.tabIndex = 0;
				row.dataset.href = href;
				row.setAttribute('aria-label', `Open creation ${createdImageTitle}`);
				row.addEventListener('click', (e) => {
					const target = e.target;
					if (target instanceof HTMLElement && target.closest('a')) return;
					window.location.href = href;
				});
				row.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						window.location.href = href;
					}
				});
			}

			const thumbWrap = document.createElement('div');
			thumbWrap.className = `connect-comment-thumb${comment.nsfw ? ' nsfw' : ''}`;
			if (comment.created_image_media_type === 'video') {
				thumbWrap.setAttribute('data-media-type', 'video');
			}
			thumbWrap.setAttribute('aria-hidden', 'true');
			const thumbUrl = typeof comment?.created_image_thumbnail_url === 'string' ? comment.created_image_thumbnail_url.trim() : '';
			const imageUrl = typeof comment?.created_image_url === 'string' ? comment.created_image_url.trim() : '';
			const resolvedThumb = thumbUrl || imageUrl || '';
			if (resolvedThumb) {
				const img = document.createElement('img');
				img.src = resolvedThumb;
				img.alt = '';
				img.loading = 'lazy';
				img.decoding = 'async';
				img.className = 'connect-comment-thumb-img';
				thumbWrap.appendChild(img);
			}

			const creationTitle = document.createElement('div');
			creationTitle.className = 'connect-comment-creation-title';
			creationTitle.textContent = createdImageTitle;

			const creatorRow = document.createElement('div');
			creatorRow.className = 'connect-comment-creator';

			const creatorId = Number(comment?.created_image_user_id ?? 0);
			const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
			const creatorName = creatorDisplayName || (creatorUserName ? creatorUserName : 'User');
			const creatorHandle = creatorUserName ? `@${creatorUserName}` : '';
			const creatorSeed = creatorUserName || String(creatorId || '') || creatorName;
			const creatorColor = getAvatarColor(creatorSeed);
			const creatorInitial = creatorName.charAt(0).toUpperCase() || '?';
			const creatorAvatarUrl = typeof comment?.created_image_avatar_url === 'string' ? comment.created_image_avatar_url.trim() : '';
			const creatorPlan = comment?.created_image_owner_plan === 'founder';
			const creatorAvatarHtml = renderCommentAvatarHtml({
				avatarUrl: creatorAvatarUrl,
				displayName: creatorName,
				color: creatorColor,
				href: creatorProfileHref,
				isFounder: creatorPlan,
				flairSize: 'xs',
			});

			// Note: on Connect, we intentionally hide the creation timestamp to reduce clutter.
			creatorRow.innerHTML = `
				<div class="connect-comment-creator-left">
					${creatorAvatarHtml}
					<div class="connect-comment-creator-who">
						<span class="comment-author-name${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorName)}</span>
						${creatorHandle ? `<span class="comment-author-handle${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorHandle)}</span>` : ''}
					</div>
				</div>
			`;

			const commenterId = Number(comment?.user_id ?? 0);
			const profileHref = buildProfilePath({ userName, userId: commenterId });
			const seed = userName || String(comment?.user_id ?? '') || commenterName;
			const color = getAvatarColor(seed);
			const avatarUrl = typeof comment?.avatar_url === 'string' ? comment.avatar_url.trim() : '';
			const commenterPlan = comment?.plan === 'founder';
			const avatarHtml = renderCommentAvatarHtml({
				avatarUrl,
				displayName: commenterName,
				color,
				href: profileHref,
				isFounder: commenterPlan,
				flairSize: 'xs',
			});

			const timeAgo = comment?.created_at ? (formatRelativeTime(comment.created_at) || '') : '';
			const safeText = processUserText(comment?.text ?? '');

			const commentText = document.createElement('div');
			commentText.className = 'comment-text';
			commentText.innerHTML = safeText;

			const reactions = comment?.reactions && typeof comment.reactions === 'object' ? comment.reactions : {};
			let chipsWithCount = [];
			let reactionsEl = null;
			try {
				chipsWithCount = Array.isArray(REACTION_ORDER) ? REACTION_ORDER.filter((key) => {
					const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
					const last = arr[arr.length - 1];
					const others = typeof last === 'number' ? last : 0;
					const strings = typeof last === 'number' ? arr.slice(0, -1) : arr;
					return strings.length + others > 0;
				}) : [];
			} catch (e) {
				console.error('[Connect] Error filtering reaction chips:', e);
			}
			if (chipsWithCount.length > 0) {
				reactionsEl = document.createElement('div');
				reactionsEl.className = 'comment-reactions comment-reactions-readonly';
				try {
					const pillsHtml = chipsWithCount.map((key) => {
						const arr = Array.isArray(reactions[key]) ? reactions[key] : [];
						const last = arr[arr.length - 1];
						const others = typeof last === 'number' ? last : 0;
						const strings = (typeof last === 'number' ? arr.slice(0, -1) : arr).filter((s) => typeof s === 'string');
						const count = strings.length + others;
						const countLabel = count > 99 ? '99+' : String(count);
						const tooltip = strings.length > 0 || others > 0
							? [...strings, others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'}` : ''].filter(Boolean).join(', ')
							: '';
						const iconFn = REACTION_ICONS?.[key];
						const iconHtml = (typeof iconFn === 'function' ? iconFn('comment-reaction-icon') : '') || '';
						const tooltipAttr = tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : '';
						return `<span class="comment-reaction-pill" aria-label="${escapeHtml(key)}: ${escapeHtml(countLabel)}"${tooltipAttr}><span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span><span class="comment-reaction-count">${escapeHtml(countLabel)}</span></span>`;
					}).join('');
					reactionsEl.innerHTML = `<div class="comment-reaction-pills"><div class="comment-reaction-pills-inner">${pillsHtml}</div></div>`;
				} catch (e) {
					console.error('[Connect] Error rendering reaction chips for comment:', comment?.id, e);
				}
			}

			const footer = document.createElement('div');
			footer.className = 'connect-comment-footer';
			footer.innerHTML = `
				<div class="connect-comment-footer-left">
					${avatarHtml}
					<div class="connect-comment-footer-who">
						<span class="connect-comment-footer-name-handle-time">
							<span class="comment-author-name${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterName)}</span>
							${commenterHandle ? `<span class="comment-author-handle${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterHandle)}</span>` : ''}
							${timeAgo ? `<span class="comment-time">&nbsp;·&nbsp;${escapeHtml(timeAgo)}</span>` : ''}
						</span>
					</div>
				</div>
			`;

			row.appendChild(thumbWrap);
			row.appendChild(creationTitle);
			row.appendChild(creatorRow);
			row.appendChild(commentText);
			row.appendChild(footer);
			if (reactionsEl?.innerHTML) {
				row.classList.add('has-reactions');
				row.appendChild(reactionsEl);
			}
			container.appendChild(row);
		});

		// Comments were rendered; hydrate any special link labels within them.
		hydrateUserTextLinks(container);

		// Tap-to-show tooltip for mobile (readonly pills; interactive pills elsewhere have their own tap action).
		if (typeof setupReactionTooltipTap === 'function') {
			setupReactionTooltipTap(container);
		}
	}

	// Listen for server updates from modal
	setupEventListeners() {
		document.addEventListener('server-updated', () => {
			this.loadServers({ force: true });
		});
	}

	setupFeatureRequestForm() {
		const form = this.querySelector('[data-feature-request-form]');
		if (!(form instanceof HTMLFormElement)) return;

		const status = this.querySelector('[data-feature-request-status]');
		const submit = this.querySelector('[data-feature-request-submit]');
		const messageEl = this.querySelector('[data-feature-request-message]');
		const refreshMessage = messageEl instanceof HTMLTextAreaElement
			? attachAutoGrowTextarea(messageEl)
			: () => { };

		let statusTimer = null;

		const setStatus = ({ type, text } = {}) => {
			if (!(status instanceof HTMLElement)) return;
			if (statusTimer) {
				clearTimeout(statusTimer);
				statusTimer = null;
			}
			status.hidden = !text;
			status.classList.toggle('error', type === 'error');
			if (!text) {
				status.textContent = '';
				return;
			}

			// Render a dismissible alert.
			status.innerHTML = `
				<span>${escapeHtml(text)}</span>
				<button type="button" class="alert-close" data-alert-close aria-label="Dismiss">✕</button>
			`;

			const close = status.querySelector('[data-alert-close]');
			if (close instanceof HTMLButtonElement) {
				close.addEventListener('click', () => {
					setStatus({ type: 'info', text: '' });
				});
			}

			// Auto-dismiss non-error notices.
			if (type !== 'error') {
				statusTimer = setTimeout(() => {
					setStatus({ type: 'info', text: '' });
				}, 4000);
			}
		};

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			setStatus({ type: 'info', text: '' });

			const message = String(form.elements.message.value || '').trim();
			const context = {
				route: (document.documentElement?.dataset?.route || window.__CURRENT_ROUTE__ || '').toString(),
				referrer: (document.referrer || '').toString(),
				timezone: (() => {
					try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
				})(),
				locale: (navigator.language || '').toString(),
				platform: (navigator.platform || '').toString(),
				colorScheme: (() => {
					try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return ''; }
				})(),
				reducedMotion: (() => {
					try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'; } catch { return ''; }
				})(),
				network: (() => {
					const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
					const effectiveType = conn?.effectiveType ? String(conn.effectiveType) : '';
					const saveData = typeof conn?.saveData === 'boolean' ? (conn.saveData ? 'save-data' : '') : '';
					return [effectiveType, saveData].filter(Boolean).join(' ');
				})(),
				viewportWidth: window.innerWidth || 0,
				viewportHeight: window.innerHeight || 0,
				screenWidth: window.screen?.width || 0,
				screenHeight: window.screen?.height || 0,
				devicePixelRatio: window.devicePixelRatio || 1
			};

			if (!message) {
				setStatus({ type: 'error', text: 'Please share your idea.' });
				return;
			}

			if (submit instanceof HTMLButtonElement) {
				submit.disabled = true;
				submit.textContent = 'Sending…';
			}

			try {
				const response = await fetch('/api/feature-requests', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ message, context })
				});
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(data.error || 'Failed to send feature request.');
				}
				form.reset();
				refreshMessage();
				setStatus({ type: 'info', text: 'Sent. Thanks — we’ll review it soon.' });
			} catch (err) {
				setStatus({ type: 'error', text: err?.message || 'Failed to send feature request.' });
			} finally {
				if (submit instanceof HTMLButtonElement) {
					submit.disabled = false;
					submit.textContent = 'Send';
				}
			}
		});
	}

	async loadServers({ force = false } = {}) {
		const container = this.querySelector('[data-servers-container]');
		if (!container) return;

		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load servers');
			}

			container.removeAttribute('aria-busy');
			container.removeAttribute('aria-label');
			const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
			const viewerIsAdmin = Boolean(result.data?.viewer_is_admin);
			this._joinedServersForChat = servers
				.filter((s) => s && s.is_member)
				.map((s) => ({
					id: Number(s.id),
					name: typeof s.name === 'string' ? s.name.trim() : ''
				}))
				.filter((s) => Number.isFinite(s.id) && s.id > 0);
			this.renderServers(servers, container, viewerIsAdmin);
			this.renderConnectChatThreadList();
		} catch (error) {
			// console.error('Error loading servers:', error);
			container.removeAttribute('aria-busy');
			container.removeAttribute('aria-label');
			container.innerHTML = renderEmptyError('Error loading servers.');
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

	async handleJoin(serverId) {
		try {
			const response = await fetch(`/api/servers/${serverId}/join`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to join server');
				return;
			}

			// Refresh the page to show updated state
			window.location.reload();
		} catch (error) {
			// console.error('Error joining server:', error);
			alert('Failed to join server');
		}
	}

	async handleLeave(serverId) {
		if (!confirm('Are you sure you want to leave this server?')) {
			return;
		}

		try {
			const response = await fetch(`/api/servers/${serverId}/leave`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to leave server');
				return;
			}

			// Refresh the page to show updated state
			window.location.reload();
		} catch (error) {
			// console.error('Error leaving server:', error);
			alert('Failed to leave server');
		}
	}
}

customElements.define('app-route-servers', AppRouteServers);
