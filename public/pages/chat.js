/**
 * Standalone /chat/* thread UI (plain JS; not a custom element).
 */

let formatRelativeTime;
let fetchJsonWithStatusDeduped;
let readCachedChatThreads;
let writeCachedChatThreads;
let clearCachedChatThreads;
let isChatThreadsCacheStale;
let getAvatarColor;
let buildProfilePath;
let renderCommentAvatarHtml;
let processUserText;
let hydrateUserTextLinks;
let hydrateChatCreationEmbeds;
let renderEmptyError;
let renderEmptyState;
let attachAutoGrowTextarea;
let attachMentionSuggest;
let toggleChatMessageReaction;
let setupReactionTooltipTap;

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
		const datetimeMod = await import(`../shared/datetime.js${qs}`);
		formatRelativeTime = datetimeMod.formatRelativeTime;

		const apiMod = await import(`../shared/api.js${qs}`);
		fetchJsonWithStatusDeduped = apiMod.fetchJsonWithStatusDeduped;

		const chatThreadsCacheMod = await import(`../shared/chatThreadsCache.js${qs}`);
		readCachedChatThreads = chatThreadsCacheMod.readCachedChatThreads;
		writeCachedChatThreads = chatThreadsCacheMod.writeCachedChatThreads;
		clearCachedChatThreads = chatThreadsCacheMod.clearCachedChatThreads;
		isChatThreadsCacheStale = chatThreadsCacheMod.isChatThreadsCacheStale;

		const avatarMod = await import(`../shared/avatar.js${qs}`);
		getAvatarColor = avatarMod.getAvatarColor;

		const profileLinksMod = await import(`../shared/profileLinks.js${qs}`);
		buildProfilePath = profileLinksMod.buildProfilePath;

		const commentItemMod = await import(`../shared/commentItem.js${qs}`);
		renderCommentAvatarHtml = commentItemMod.renderCommentAvatarHtml;

		const userTextMod = await import(`../shared/userText.js${qs}`);
		processUserText = userTextMod.processUserText;
		hydrateUserTextLinks = userTextMod.hydrateUserTextLinks;
		hydrateChatCreationEmbeds = userTextMod.hydrateChatCreationEmbeds;

		const emptyStateMod = await import(`../shared/emptyState.js${qs}`);
		renderEmptyError = emptyStateMod.renderEmptyError;
		renderEmptyState = emptyStateMod.renderEmptyState;

		const autogrowMod = await import(`../shared/autogrow.js${qs}`);
		attachAutoGrowTextarea = autogrowMod.attachAutoGrowTextarea;

		const suggestMod = await import(`../shared/triggeredSuggest.js${qs}`);
		attachMentionSuggest = suggestMod.attachMentionSuggest;

		const commentsMod = await import(`../shared/comments.js${qs}`);
		toggleChatMessageReaction = commentsMod.toggleChatMessageReaction;

		const tooltipTapMod = await import(`../shared/reactionTooltipTap.js${qs}`);
		setupReactionTooltipTap = tooltipTapMod.setupReactionTooltipTap;
	})();
	return _depsPromise;
}

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * `white-space: pre-wrap` on the bubble preserves trailing newlines as an extra blank line
 * after the embed. Strip whitespace-only trailing text nodes after hydration.
 */
function trimTrailingWhitespaceAfterChatEmbed(bubble) {
	if (!(bubble instanceof HTMLElement)) return;
	if (!bubble.querySelector('.connect-chat-creation-embed')) return;
	let n = bubble.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		bubble.removeChild(n);
		n = prev;
	}
}

/** Same issue inside `.connect-chat-creation-embed` (e.g. after `</div>` before title). */
function trimChatCreationEmbedWhitespace(embed) {
	if (!(embed instanceof HTMLElement)) return;
	let n = embed.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		embed.removeChild(n);
		n = prev;
	}
}

function otherUserIdFromDmPair(dmPairKey, viewerId) {
	if (!dmPairKey || typeof dmPairKey !== 'string') return null;
	const parts = dmPairKey.split(':');
	if (parts.length !== 2) return null;
	const a = Number(parts[0]);
	const b = Number(parts[1]);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
	if (!Number.isFinite(viewerId)) return null;
	if (a === viewerId) return b;
	if (b === viewerId) return a;
	return null;
}

/** Matches server `normalizeDmUsernameInput` / profile handle rules (user.js). */
function normalizeDmPathUsername(raw) {
	if (typeof raw !== 'string') return null;
	let s = raw.trim();
	if (!s) return null;
	if (s.startsWith('@')) s = s.slice(1).trim();
	s = s.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(s)) return null;
	return s;
}

/**
 * @param {string} pathname
 * @returns {{ kind: 'empty' } | { kind: 'invalid' } | { kind: 'thread', threadId: number } | { kind: 'channel', slug: string } | { kind: 'dm', userId: number } | { kind: 'dm', userName: string }}
 */
function parseChatPathname(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	const parts = p.split('/').filter(Boolean);
	if (parts[0] !== 'chat') return { kind: 'invalid' };
	if (parts.length === 1) return { kind: 'empty' };
	const seg = parts[1].toLowerCase();
	if (seg === 'c' && parts[2]) {
		let slug = parts[2];
		try {
			slug = decodeURIComponent(slug);
		} catch {
			// keep raw
		}
		return { kind: 'channel', slug };
	}
	if (seg === 'dm' && parts[2]) {
		let rawSeg = parts[2];
		try {
			rawSeg = decodeURIComponent(rawSeg);
		} catch {
			// keep raw
		}
		rawSeg = String(rawSeg).trim();
		if (!rawSeg) return { kind: 'invalid' };
		// All-digit segment: legacy URLs and users without a handle (numeric id only).
		if (/^\d+$/.test(rawSeg)) {
			const uid = Number(rawSeg);
			if (Number.isFinite(uid) && uid > 0) return { kind: 'dm', userId: uid };
			return { kind: 'invalid' };
		}
		const un = normalizeDmPathUsername(rawSeg);
		if (un) return { kind: 'dm', userName: un };
		return { kind: 'invalid' };
	}
	if (seg === 't' && parts[2]) {
		const tid = Number(parts[2]);
		if (Number.isFinite(tid) && tid > 0) return { kind: 'thread', threadId: tid };
	}
	return { kind: 'invalid' };
}

/**
 * Mount chat UI and load the thread for the current URL.
 * @param {HTMLElement} root — container with [data-chat] markup (see pages/chat.html)
 */
export async function initChatPage(root) {
	if (!(root instanceof HTMLElement)) return;

	await loadDeps();

	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	const { sendIcon, REACTION_ORDER, REACTION_ICONS, smileIcon } = await import(`../icons/svg-strings.js${qs}`);

	function chatReactionGetCount(val) {
		if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
		if (!Array.isArray(val) || val.length === 0) return 0;
		const last = val[val.length - 1];
		const others = typeof last === 'number' ? last : 0;
		const strings = typeof last === 'number' ? val.slice(0, -1) : val;
		return strings.filter((s) => typeof s === 'string').length + others;
	}

	function messageHasAnyReactions(m) {
		const reactions = m?.reactions && typeof m.reactions === 'object' ? m.reactions : {};
		return REACTION_ORDER.some((key) => chatReactionGetCount(reactions[key]) > 0);
	}

	const sendBtnMount = root.querySelector('[data-chat-send]');
	if (sendBtnMount) {
		sendBtnMount.innerHTML = sendIcon('chat-page-send-icon');
	}

	const docTitleBase = typeof document !== 'undefined' ? document.title : 'parascene';
	let chatViewerId = null;
	let chatThreads = [];
	let activeThreadId = null;
	let loadingMessages = false;
	let sendInFlight = false;
	let chatViewportHandler = null;
	let activeReactionPicker = null;
	let lastChatMessagesPayload = [];
	/** @type {null | (() => void)} */
	let roomBroadcastTeardown = null;
	/** @type {null | (() => void)} */
	let visibilityResyncCleanup = null;
	/** True when the viewer is pinned to the latest messages (used for lazy embeds + viewport resize). */
	let chatStickToBottom = true;
	/** @type {ResizeObserver | null} */
	let chatMessagesRowResizeObserver = null;
	/** @type {MutationObserver | null} */
	let chatMessagesChildListObserver = null;
	/** @type {null | (() => void)} */
	let chatMessagesScrollCleanup = null;

	const CHAT_BOTTOM_THRESHOLD_PX = 56;

	function updateChatStickToBottomFromScroll() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
		chatStickToBottom = dist <= CHAT_BOTTOM_THRESHOLD_PX;
	}

	/**
	 * Scroll the thread to the latest message. Call after render/send; also re-runs on the next
	 * animation frames so mobile WebKit finishes layout before we read scrollHeight.
	 * Async creation embeds and images still grow the list after this — ResizeObserver keeps the bottom pinned.
	 */
	function scrollChatMessagesToEnd() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		chatStickToBottom = true;
		const apply = () => {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
	}

	/** Re-scroll after visual viewport changes only if the user was already following the thread. */
	function nudgeChatScrollIfStuckToBottom() {
		if (!chatStickToBottom) return;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const apply = () => {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		};
		apply();
		requestAnimationFrame(apply);
	}

	function setupChatMessagesScrollAssist() {
		teardownChatMessagesScrollAssist();
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;

		const onScroll = () => updateChatStickToBottomFromScroll();
		messagesEl.addEventListener('scroll', onScroll, { passive: true });
		chatMessagesScrollCleanup = () => messagesEl.removeEventListener('scroll', onScroll);

		/* Observing the scroll box misses inner growth (fixed height + overflow). Observe each row so
		 * async embeds / images changing height re-pin the list when we’re following the thread. */
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => {
			if (!chatStickToBottom) return;
			requestAnimationFrame(() => {
				messagesEl.scrollTop = messagesEl.scrollHeight;
			});
		});
		const syncRowObservers = () => {
			ro.disconnect();
			for (const child of messagesEl.children) {
				ro.observe(child);
			}
		};
		syncRowObservers();
		const mo = new MutationObserver(syncRowObservers);
		mo.observe(messagesEl, { childList: true });
		chatMessagesRowResizeObserver = ro;
		chatMessagesChildListObserver = mo;
	}

	function teardownChatMessagesScrollAssist() {
		if (typeof chatMessagesScrollCleanup === 'function') {
			chatMessagesScrollCleanup();
			chatMessagesScrollCleanup = null;
		}
		if (chatMessagesRowResizeObserver) {
			chatMessagesRowResizeObserver.disconnect();
			chatMessagesRowResizeObserver = null;
		}
		if (chatMessagesChildListObserver) {
			chatMessagesChildListObserver.disconnect();
			chatMessagesChildListObserver = null;
		}
	}

	function syncChatSendButton() {
		const sendBtn = root.querySelector('[data-chat-send]');
		const inp = root.querySelector('[data-chat-body-input]');
		if (!(sendBtn instanceof HTMLButtonElement) || !(inp instanceof HTMLTextAreaElement)) return;
		if (sendBtn.classList.contains('is-sending')) {
			sendBtn.hidden = false;
			return;
		}
		sendBtn.hidden = String(inp.value || '').trim().length === 0;
	}

	function setSendSending(sending) {
		const sendBtn = root.querySelector('[data-chat-send]');
		if (!(sendBtn instanceof HTMLButtonElement)) return;
		sendBtn.classList.toggle('is-sending', sending);
		sendBtn.disabled = sending;
		if (sending) {
			sendBtn.hidden = false;
			sendBtn.setAttribute('aria-busy', 'true');
			sendBtn.setAttribute('aria-label', 'Sending');
			sendBtn.innerHTML =
				'<span class="chat-page-send-spinner route-loading-spinner" aria-hidden="true"></span>';
		} else {
			sendBtn.removeAttribute('aria-busy');
			sendBtn.setAttribute('aria-label', 'Send');
			sendBtn.innerHTML = sendIcon('chat-page-send-icon');
			syncChatSendButton();
		}
	}

	function teardownChatViewportSync() {
		const vv = window.visualViewport;
		if (vv && chatViewportHandler) {
			vv.removeEventListener('resize', chatViewportHandler);
			vv.removeEventListener('scroll', chatViewportHandler);
		}
		chatViewportHandler = null;
		document.documentElement.style.removeProperty('height');
		document.body.style.removeProperty('height');
	}

	function setupChatViewportSync() {
		teardownChatViewportSync();
		const vv = window.visualViewport;
		if (!vv) return;
		const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
		const narrow =
			typeof window !== 'undefined' &&
			window.matchMedia &&
			window.matchMedia('(max-width: 768px)').matches;
		if (!touch && !narrow) return;

		const apply = () => {
			const h = vv.height;
			document.documentElement.style.height = `${h}px`;
			document.body.style.height = `${h}px`;
			requestAnimationFrame(() => nudgeChatScrollIfStuckToBottom());
		};

		chatViewportHandler = apply;
		vv.addEventListener('resize', apply);
		vv.addEventListener('scroll', apply);
		apply();
	}

	function updateTitleFromMeta(meta) {
		const base = docTitleBase || 'parascene';
		const label = (meta?.title && String(meta.title).trim())
			? String(meta.title).trim()
			: (meta?.type === 'channel' && meta?.channel_slug
				? `#${meta.channel_slug}`
				: 'Chat');
		document.title = `${label} · ${base}`;
		const titleEl = root.querySelector('[data-chat-title]');
		if (titleEl) titleEl.textContent = label;
	}

	function buildChatReactionMetaRowHtml(m) {
		const reactions = m?.reactions && typeof m.reactions === 'object' ? m.reactions : {};
		const viewerReactions = Array.isArray(m?.viewer_reactions) ? m.viewer_reactions : [];
		const messageId = m?.id != null ? String(m.id) : '';
		if (!messageId) return '';
		const keysWithReactions = REACTION_ORDER.filter((key) => chatReactionGetCount(reactions[key]) > 0);
		const hasAnyReactions = keysWithReactions.length > 0;
		if (!hasAnyReactions) {
			return '';
		}
		const reactionOverflowLimit =
			typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 3 : 5;
		const hasMoreThan3Reactions = keysWithReactions.length > reactionOverflowLimit;
		const hasUnusedReactions = REACTION_ORDER.some((key) => chatReactionGetCount(reactions[key]) === 0);
		const reactionPills = keysWithReactions
					.map((key) => {
						const raw = reactions[key];
						const count = chatReactionGetCount(raw);
						const countLabel = count > 99 ? '99+' : String(count);
						const hasViewer = viewerReactions.includes(key);
						const iconFn = REACTION_ICONS[key];
						const iconHtml = iconFn ? iconFn('comment-reaction-icon') : '';
						const actionLabel = hasViewer ? `Remove ${key}` : `Add ${key}`;
						let tooltipAttr = '';
						if (typeof raw !== 'number' && Array.isArray(raw) && raw.length > 0) {
							const last = raw[raw.length - 1];
							const others = typeof last === 'number' ? last : 0;
							const strings = (typeof last === 'number' ? raw.slice(0, -1) : raw).filter(
								(s) => typeof s === 'string'
							);
							const tooltip = [...strings, others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'}` : '']
								.filter(Boolean)
								.join(', ');
							if (tooltip) tooltipAttr = ` data-tooltip="${escapeHtml(tooltip)}"`;
						}
						return `<button type="button" class="comment-reaction-pill${hasViewer ? ' is-viewer' : ''}" data-emoji-key="${escapeHtml(key)}" data-chat-message-id="${escapeHtml(messageId)}" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}"${tooltipAttr}><span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span><span class="comment-reaction-count">${escapeHtml(countLabel)}</span></button>`;
					})
					.join('');
		const addReactionBtn = hasUnusedReactions
			? `<button type="button" class="comment-reaction-add" data-chat-message-id="${escapeHtml(messageId)}" aria-label="Add reaction" title="Add reaction"><span class="comment-reaction-icon-wrap" aria-hidden="true">${smileIcon('comment-reaction-add-icon')}</span></button>`
			: '';
		return `<div class="comment-meta-row connect-chat-msg-reaction-row">
			<div class="comment-meta-top">
				<div class="comment-meta-right">
					${reactionPills && !hasMoreThan3Reactions ? `<div class="comment-reaction-pills"><div class="comment-reaction-pills-inner">${reactionPills}</div></div>` : ''}
					${addReactionBtn ? `<div class="comment-reaction-add-wrap">${addReactionBtn}</div>` : ''}
				</div>
			</div>
			${reactionPills && hasMoreThan3Reactions ? `<div class="comment-reaction-pills comment-reaction-pills--below"><div class="comment-reaction-pills-inner">${reactionPills}</div></div>` : ''}
		</div>`;
	}

	function closeReactionPicker() {
		if (activeReactionPicker && activeReactionPicker.parentNode) {
			activeReactionPicker.parentNode.removeChild(activeReactionPicker);
			document.removeEventListener('click', activeReactionPicker._outsideClick);
			activeReactionPicker = null;
		}
	}

	function showReactionPicker(anchor, messageId, unusedKeys, onApplied) {
		closeReactionPicker();
		const panel = document.createElement('div');
		panel.className = 'comment-reaction-picker';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'Add reaction');

		const grid = document.createElement('div');
		grid.className = 'comment-reaction-picker-grid';
		for (const key of unusedKeys) {
			const iconFn = REACTION_ICONS[key];
			const iconHtml = iconFn ? iconFn('comment-reaction-icon') : '';
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'comment-reaction-picker-item';
			btn.dataset.emojiKey = key;
			btn.dataset.chatMessageId = String(messageId);
			btn.innerHTML = `<span class="comment-reaction-icon-wrap" aria-hidden="true">${iconHtml}</span>`;
			btn.setAttribute('aria-label', `Add ${key}`);
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				onApplied(messageId, key);
				closeReactionPicker();
			});
			grid.appendChild(btn);
		}
		panel.appendChild(grid);

		document.body.appendChild(panel);

		const rect = anchor.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const pad = 8;
		const pickerW = 200;
		const pickerH = Math.min(180, 36 * Math.ceil(unusedKeys.length / 5) + 24);

		let top = rect.bottom + pad;
		let left = rect.left;
		const preferAbove = rect.top > vh / 2;
		const preferLeft = rect.right > vw - pickerW - pad;

		if (preferAbove && rect.top - pickerH - pad >= 0) {
			top = rect.top - pickerH - pad;
		} else if (!preferAbove && rect.bottom + pickerH + pad <= vh) {
			top = rect.bottom + pad;
		} else if (rect.top >= pickerH + pad) {
			top = rect.top - pickerH - pad;
		}

		if (preferLeft && rect.right - pickerW >= pad) {
			left = rect.right - pickerW;
		} else if (!preferLeft && rect.left + pickerW <= vw - pad) {
			left = rect.left;
		} else {
			left = Math.max(pad, Math.min(vw - pickerW - pad, rect.left));
		}

		panel.style.top = `${top}px`;
		panel.style.left = `${left}px`;

		const panelRect = panel.getBoundingClientRect();
		let adjLeft = parseFloat(panel.style.left) || left;
		let adjTop = parseFloat(panel.style.top) || top;
		if (panelRect.right > vw - pad) adjLeft = vw - panelRect.width - pad;
		if (panelRect.left < pad) adjLeft = pad;
		if (panelRect.bottom > vh - pad) adjTop = vh - panelRect.height - pad;
		if (panelRect.top < pad) adjTop = pad;
		panel.style.left = `${adjLeft}px`;
		panel.style.top = `${adjTop}px`;

		const outsideClick = (e) => {
			if (!panel.contains(e.target) && !anchor.contains(e.target)) {
				closeReactionPicker();
			}
		};
		panel._outsideClick = outsideClick;
		requestAnimationFrame(() => document.addEventListener('click', outsideClick));

		activeReactionPicker = panel;
	}

	async function loadChatThreads() {
		const result = await fetchJsonWithStatusDeduped(
			'/api/chat/threads',
			{ credentials: 'include' },
			{ windowMs: 0 }
		);
		if (!result.ok) {
			const msg = result.data?.message || result.data?.error || 'Failed to load conversations';
			throw new Error(msg);
		}
		chatViewerId = result.data?.viewer_id != null ? Number(result.data.viewer_id) : null;
		chatThreads = Array.isArray(result.data?.threads) ? result.data.threads : [];
	}

	async function ensureThreadMetaForList(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		const exists = (chatThreads || []).some((t) => Number(t.id) === tid);
		if (exists) return;
		const res = await fetch(`/api/chat/threads/${tid}`, { credentials: 'include' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data?.thread) return;
		const t = data.thread;
		const viewerId = chatViewerId;
		if (t.type === 'channel' && t.channel_slug) {
			chatThreads.push({
				id: tid,
				type: 'channel',
				channel_slug: t.channel_slug,
				title: `#${t.channel_slug}`
			});
		} else if (t.type === 'dm' && t.dm_pair_key) {
			const otherId = otherUserIdFromDmPair(t.dm_pair_key, viewerId);
			chatThreads.push({
				id: tid,
				type: 'dm',
				dm_pair_key: t.dm_pair_key,
				other_user_id: otherId,
				title: otherId != null ? `User ${otherId}` : 'Chat'
			});
		} else {
			chatThreads.push({ id: tid, type: t.type || 'dm', title: 'Chat' });
		}
	}

	async function loadMessages() {
		const threadId = activeThreadId;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !messagesEl || loadingMessages) return;
		loadingMessages = true;
		messagesEl.setAttribute('aria-busy', 'true');

		const viewerId = chatViewerId;
		try {
			const res = await fetch(`/api/chat/threads/${threadId}/messages?limit=50`, {
				credentials: 'include'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Failed to load messages');
			}
			const messages = Array.isArray(data.messages) ? data.messages : [];
			lastChatMessagesPayload = messages;
			messagesEl.innerHTML = '';

			if (messages.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'chat-page-empty-hint';
				empty.setAttribute('role', 'status');
				empty.textContent = 'No messages yet. Send one below.';
				messagesEl.appendChild(empty);
			}

			for (let i = 0; i < messages.length; i++) {
				const m = messages[i];
				const senderId = Number(m.sender_id);
				const isSelf = Number.isFinite(viewerId) && senderId === viewerId;
				const prev = i > 0 ? messages[i - 1] : null;
				const sameSenderAsPrev =
					prev != null && Number(prev.sender_id) === senderId;
				const row = document.createElement('div');
				row.className = `connect-chat-msg${isSelf ? ' is-self' : ''}${sameSenderAsPrev ? ' is-group-continue' : ''}`;
				row.setAttribute('data-chat-message-id', String(m.id));
				if (!messageHasAnyReactions(m)) {
					row.classList.add('connect-chat-msg--reaction-empty');
				}
				const safeBody = processUserText(m.body ?? '');
				const bubble = document.createElement('div');
				bubble.className = 'connect-chat-msg-bubble';
				bubble.innerHTML = safeBody;
				if (!sameSenderAsPrev) {
					const metaLine = document.createElement('div');
					metaLine.className = 'connect-chat-msg-meta';
					const handleRaw =
						m.sender_user_name != null ? String(m.sender_user_name).trim() : '';
					const handleLabel = handleRaw
						? `@${handleRaw}`
						: isSelf
							? 'You'
							: `User ${senderId}`;
					const when = m.created_at ? (formatRelativeTime(m.created_at) || '') : '';
					const lineText = [handleLabel, when].filter(Boolean).join(' · ');
					const displayForAvatar = handleRaw || (isSelf ? 'You' : `User ${senderId}`);
					const profileHref = buildProfilePath({
						userName: handleRaw || undefined,
						userId: senderId
					});
					const avatarWrap = document.createElement('div');
					avatarWrap.innerHTML = renderCommentAvatarHtml({
						avatarUrl: m.sender_avatar_url || '',
						displayName: displayForAvatar,
						color: getAvatarColor(handleRaw || String(senderId)),
						href: profileHref || undefined,
						flairSize: 'xs'
					});
					while (avatarWrap.firstChild) {
						metaLine.appendChild(avatarWrap.firstChild);
					}
					const textSpan = document.createElement('span');
					textSpan.className = 'connect-chat-msg-meta-text';
					textSpan.textContent = lineText;
					metaLine.appendChild(textSpan);
					row.appendChild(metaLine);
				}
				row.appendChild(bubble);
				const reactionHtml = buildChatReactionMetaRowHtml(m);
				if (reactionHtml) {
					const footer = document.createElement('div');
					footer.className = 'connect-chat-msg-footer';
					footer.innerHTML = reactionHtml.trim();
					row.appendChild(footer);
				}
				messagesEl.appendChild(row);
			}
			hydrateUserTextLinks(messagesEl);
			hydrateChatCreationEmbeds(messagesEl);
			for (const bubble of messagesEl.querySelectorAll('.connect-chat-msg-bubble')) {
				trimTrailingWhitespaceAfterChatEmbed(bubble);
			}
			for (const embed of messagesEl.querySelectorAll('.connect-chat-creation-embed')) {
				trimChatCreationEmbedWhitespace(embed);
			}
			setupReactionTooltipTap(messagesEl);
			scrollChatMessagesToEnd();
		} catch (err) {
			console.error('[Chat page] messages:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load messages.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
		}
	}

	function tearDownRoomBroadcast() {
		if (typeof roomBroadcastTeardown === 'function') {
			try {
				roomBroadcastTeardown();
			} catch {
				// ignore
			}
		}
		roomBroadcastTeardown = null;
	}

	function tearDownVisibilityResync() {
		if (typeof visibilityResyncCleanup === 'function') {
			try {
				visibilityResyncCleanup();
			} catch {
				// ignore
			}
		}
		visibilityResyncCleanup = null;
	}

	function bindVisibilityResync() {
		tearDownVisibilityResync();
		const onVis = () => {
			if (document.visibilityState !== 'visible') return;
			if (!activeThreadId || loadingMessages) return;
			void loadMessages();
		};
		document.addEventListener('visibilitychange', onVis);
		visibilityResyncCleanup = () => document.removeEventListener('visibilitychange', onVis);
	}

	async function bindRoomBroadcast(threadId) {
		tearDownRoomBroadcast();
		bindVisibilityResync();
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		try {
			const mod = await import(`../shared/realtimeBroadcast.js${qs}`);
			const refetch = () => {
				void loadMessages();
			};
			roomBroadcastTeardown = await mod.subscribeRoomBroadcast(tid, refetch, {
				onReconnect: refetch
			});
		} catch (err) {
			console.warn('[Chat page] realtime:', err);
		}
	}

	function onChatMessagesClick(e) {
		const pill = e.target?.closest?.('.comment-reaction-pill[data-emoji-key][data-chat-message-id]');
		if (pill && pill instanceof HTMLElement) {
			const messageId = Number(pill.dataset.chatMessageId);
			const emojiKey = pill.dataset.emojiKey;
			if (!Number.isFinite(messageId) || !emojiKey) return;
			void toggleChatMessageReaction(messageId, emojiKey).then((res) => {
				if (res?.ok) void loadMessages();
			});
			return;
		}

		const addBtn = e.target?.closest?.('.comment-reaction-add[data-chat-message-id]');
		if (addBtn && addBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(addBtn.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			const m = lastChatMessagesPayload.find((x) => Number(x.id) === messageId);
			const reactions = m?.reactions && typeof m.reactions === 'object' ? m.reactions : {};
			const getCount = (val) => {
				if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
				if (!Array.isArray(val) || val.length === 0) return 0;
				const last = val[val.length - 1];
				const others = typeof last === 'number' ? last : 0;
				const strings = typeof last === 'number' ? val.slice(0, -1) : val;
				return strings.filter((s) => typeof s === 'string').length + others;
			};
			const unusedKeys = REACTION_ORDER.filter((key) => chatReactionGetCount(reactions[key]) === 0);
			if (unusedKeys.length === 0) return;
			showReactionPicker(addBtn, messageId, unusedKeys, (mid, ek) => {
				void toggleChatMessageReaction(mid, ek).then((res) => {
					if (res?.ok) void loadMessages();
				});
			});
			return;
		}

		const msgRow = e.target?.closest?.('.connect-chat-msg[data-chat-message-id]');
		if (msgRow && msgRow instanceof HTMLElement) {
			if (e.target.closest('a[href], button')) {
				return;
			}
			const messageId = Number(msgRow.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			const m = lastChatMessagesPayload.find((x) => Number(x.id) === messageId);
			const bodyInput = root.querySelector('[data-chat-body-input]');
			if (messageHasAnyReactions(m)) {
				if (bodyInput instanceof HTMLTextAreaElement) {
					bodyInput.focus();
				}
				return;
			}
			e.preventDefault();
			const anchor = msgRow;
			showReactionPicker(anchor, messageId, [...REACTION_ORDER], (mid, ek) => {
				void toggleChatMessageReaction(mid, ek).then((res) => {
					if (res?.ok) void loadMessages();
				});
			});
		}
	}

	async function submitChatMessage() {
		const threadId = activeThreadId;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		if (!threadId || !(bodyInput instanceof HTMLTextAreaElement)) return;
		if (sendInFlight) return;

		const text = String(bodyInput.value || '').trim();
		if (!text) return;

		sendInFlight = true;
		setSendSending(true);
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}

		try {
			const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: text })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Could not send');
			}
			bodyInput.value = '';
			await loadMessages();
		} catch (err) {
			console.error('[Chat page] send:', err);
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = err?.message || 'Could not send message.';
			}
		} finally {
			sendInFlight = false;
			setSendSending(false);
		}
	}

	async function openThreadForCurrentPath() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		const errEl = root.querySelector('[data-chat-error]');
		const parsed = parseChatPathname(window.location.pathname);

		if (parsed.kind === 'empty' || parsed.kind === 'invalid') {
			window.location.replace('/connect#chat');
			return;
		}

		if (messagesEl) {
			messagesEl.innerHTML = renderEmptyState({
				loading: true,
				loadingAriaLabel: 'Loading',
				className: 'chat-page-thread-loading'
			});
			messagesEl.setAttribute('aria-busy', 'true');
		}
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}

		try {
			tearDownVisibilityResync();
			tearDownRoomBroadcast();
			await loadChatThreads();

			if (parsed.kind === 'thread') {
				await ensureThreadMetaForList(parsed.threadId);
				activeThreadId = parsed.threadId;
				const meta = (chatThreads || []).find((t) => Number(t.id) === parsed.threadId);
				updateTitleFromMeta(meta);
				await loadMessages();
				await bindRoomBroadcast(activeThreadId);
				return;
			}

			if (parsed.kind === 'channel') {
				const slug = String(parsed.slug).toLowerCase().trim();
				const match = (chatThreads || []).find(
					(t) => t.type === 'channel' && String(t.channel_slug || '').toLowerCase() === slug
				);
				if (match) {
					activeThreadId = Number(match.id);
					updateTitleFromMeta(match);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
					return;
				}
				const res = await fetch('/api/chat/channels', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ tag: parsed.slug })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					const msg = data?.message || data?.error || `Could not open channel (${res.status})`;
					throw new Error(msg);
				}
				const tid = Number(data?.thread?.id);
				await loadChatThreads({ forceNetwork: true });
				if (Number.isFinite(tid) && tid > 0) {
					activeThreadId = tid;
					const meta = (chatThreads || []).find((t) => Number(t.id) === tid);
					updateTitleFromMeta(meta);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
				} else if (messagesEl) {
					messagesEl.removeAttribute('aria-busy');
					messagesEl.innerHTML = '';
					if (errEl instanceof HTMLElement) {
						errEl.hidden = false;
						errEl.textContent = 'Could not open this channel.';
					}
				}
				return;
			}

			if (parsed.kind === 'dm') {
				const uid =
					'userId' in parsed && parsed.userId != null
						? Number(parsed.userId)
						: null;
				const userName = 'userName' in parsed && parsed.userName ? String(parsed.userName) : null;

				const match = (chatThreads || []).find((t) => {
					if (t.type !== 'dm') return false;
					if (uid != null && Number.isFinite(uid) && Number(t.other_user_id) === uid) return true;
					if (userName) {
						const o = String(t.other_user?.user_name || '').toLowerCase();
						return o === userName.toLowerCase();
					}
					return false;
				});
				if (match) {
					activeThreadId = Number(match.id);
					updateTitleFromMeta(match);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
					return;
				}
				const res = await fetch('/api/chat/dm', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						uid != null && Number.isFinite(uid) && uid > 0
							? { other_user_id: uid }
							: { other_user_name: userName }
					)
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					const msg = data?.message || data?.error || `Could not open DM (${res.status})`;
					throw new Error(msg);
				}
				const tid = Number(data?.thread?.id);
				await loadChatThreads({ forceNetwork: true });
				if (Number.isFinite(tid) && tid > 0) {
					activeThreadId = tid;
					const meta = (chatThreads || []).find((t) => Number(t.id) === tid);
					updateTitleFromMeta(meta);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
				} else if (messagesEl) {
					messagesEl.removeAttribute('aria-busy');
					messagesEl.innerHTML = '';
					if (errEl instanceof HTMLElement) {
						errEl.hidden = false;
						errEl.textContent = 'Could not open this conversation.';
					}
				}
			}
		} catch (err) {
			tearDownVisibilityResync();
			tearDownRoomBroadcast();
			console.error('[Chat page]', err);
			if (messagesEl) {
				messagesEl.innerHTML = '';
				messagesEl.removeAttribute('aria-busy');
			}
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = err?.message || 'Could not open this conversation.';
			}
		}
	}

	const composer = root.querySelector('[data-chat-composer]');
	const bodyInput = root.querySelector('[data-chat-body-input]');
	if (composer instanceof HTMLFormElement) {
		composer.addEventListener('submit', (ev) => {
			ev.preventDefault();
			void submitChatMessage();
		});
	}
	if (bodyInput instanceof HTMLTextAreaElement) {
		attachAutoGrowTextarea(bodyInput);
		attachMentionSuggest(bodyInput);
		bodyInput.addEventListener('focus', () => {
			requestAnimationFrame(() => scrollChatMessagesToEnd());
		});
		bodyInput.addEventListener('input', () => syncChatSendButton());
		bodyInput.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Enter' || !ev.shiftKey) return;
			if (ev.isComposing) return;
			ev.preventDefault();
			void submitChatMessage();
		});
		syncChatSendButton();
	}

	setupChatViewportSync();
	setupChatMessagesScrollAssist();

	try {
		document.documentElement.dataset.route = 'chat';
	} catch {
		// ignore
	}

	const onPageHide = () => {
		tearDownVisibilityResync();
		tearDownRoomBroadcast();
		closeReactionPicker();
		teardownChatViewportSync();
		teardownChatMessagesScrollAssist();
		try {
			delete document.documentElement.dataset.route;
		} catch {
			// ignore
		}
		document.title = docTitleBase;
	};
	window.addEventListener('pagehide', onPageHide, { once: true });

	const messagesContainerForReactions = root.querySelector('[data-chat-messages]');
	if (messagesContainerForReactions && !messagesContainerForReactions.dataset.chatReactionUi) {
		messagesContainerForReactions.dataset.chatReactionUi = '1';
		messagesContainerForReactions.addEventListener('click', onChatMessagesClick);
	}

	const refreshBtn = root.querySelector('[data-chat-refresh]');
	if (refreshBtn instanceof HTMLButtonElement) {
		refreshBtn.addEventListener('click', () => {
			if (refreshBtn.disabled) return;
			refreshBtn.disabled = true;
			refreshBtn.setAttribute('aria-busy', 'true');
			void openThreadForCurrentPath().finally(() => {
				refreshBtn.disabled = false;
				refreshBtn.removeAttribute('aria-busy');
			});
		});
	}

	await openThreadForCurrentPath();
}
