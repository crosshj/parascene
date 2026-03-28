/**
 * Standalone /chat/* thread UI (plain JS; not a custom element).
 */

const ENTER_SENDS = (() => {
	try {
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	} catch {
		return typeof window.innerWidth === 'number' && window.innerWidth >= 768;
	}
})();

/** `?chatSimulateSendFail=1` — next POST /messages returns failure so you can preview resend UI. */
function chatSimulateSendFail() {
	try {
		return new URLSearchParams(window.location.search).get('chatSimulateSendFail') === '1';
	} catch {
		return false;
	}
}

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
	if (!bubble.querySelector('.connect-chat-creation-embed, .connect-chat-youtube-embed')) return;
	let n = bubble.lastChild;
	while (n && n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) {
		const prev = n.previousSibling;
		bubble.removeChild(n);
		n = prev;
	}
}

function hydrateChatYoutubeEmbeds(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;

	const links = Array.from(root.querySelectorAll('a[data-youtube-video-id][href]'));
	for (const a of links) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (a.dataset.chatYoutubeEmbed === 'true') continue;
		const videoId = String(a.dataset.youtubeVideoId || '').trim();
		if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) continue;
		a.dataset.chatYoutubeEmbed = 'true';

		const wrap = document.createElement('div');
		wrap.className = 'connect-chat-youtube-embed';
		const title = a.textContent ? String(a.textContent).trim() : '';
		const safeTitle = title || `youtube ${videoId}`;
		const iframe = document.createElement('iframe');
		iframe.className = 'connect-chat-youtube-embed-iframe';
		iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
		iframe.title = safeTitle;
		iframe.setAttribute(
			'allow',
			'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
		);
		iframe.setAttribute('allowfullscreen', '');
		iframe.setAttribute('loading', 'lazy');
		iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		wrap.appendChild(iframe);
		a.insertAdjacentElement('afterend', wrap);
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
	const rosterMod = await import(`../shared/chatSidebarRoster.js${qs}`);

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
	/** Optimistic / failed send row (re-mounted after each loadMessages when still relevant). */
	let optimisticSend = null;
	/** @type {null | (() => void)} */
	let chatViewportCleanup = null;
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
	/** @type {ReturnType<typeof setInterval> | null} */
	let chatSidebarPollTimer = null;
	/** @type {null | (() => void)} */
	let chatSidebarServersHandler = null;
	/** @type {null | ((e: Event) => void)} */
	let chatSidebarNavClickHandler = null;
	/** @type {null | (() => void)} */
	let chatSidebarPopstateHandler = null;
	/** @type {null | (() => void)} */
	let chatSidebarVisibilityHandler = null;

	let lastMarkReadSentId = null;
	let lastReadThreadIdForMark = null;
	/** @type {IntersectionObserver | null} */
	let latestMessageReadObserver = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let bottomDwellTimer = null;
	let bottomDwellThreadId = null;

	const CHAT_BOTTOM_THRESHOLD_PX = 56;
	const DM_OFFLINE_GRACE_MS = 45 * 1000;
	/** @type {Map<number, number>} */
	const dmLastSeenOnlineAtByUserId = new Map();

	function isDmConsideredOnlineWithGrace(otherUserId, onlineIds) {
		const oid = Number(otherUserId);
		if (!Number.isFinite(oid) || oid <= 0) return false;
		const now = Date.now();
		if (onlineIds && onlineIds.has(oid)) {
			dmLastSeenOnlineAtByUserId.set(oid, now);
			return true;
		}
		const last = dmLastSeenOnlineAtByUserId.get(oid);
		if (last != null && now - last < DM_OFFLINE_GRACE_MS) {
			return true;
		}
		return false;
	}

	function dispatchChatUnreadRefresh() {
		try {
			document.dispatchEvent(new CustomEvent('chat-unread-refresh'));
		} catch {
			// ignore
		}
	}

	function patchChatThreadRow(threadId, patch) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0 || !patch || typeof patch !== 'object') return;
		const row = (chatThreads || []).find((t) => Number(t.id) === tid);
		if (row) Object.assign(row, patch);
	}

	function fadeOutUnreadHighlightsInDom() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const rows = [...messagesEl.querySelectorAll('.connect-chat-msg.is-unread')];
		if (rows.length === 0) return;
		for (const row of rows) {
			row.classList.add('is-unread-clearing');
		}
		window.setTimeout(() => {
			for (const row of rows) {
				if (!row.isConnected) continue;
				row.classList.remove('is-unread-clearing');
				row.classList.remove('is-unread');
				row.classList.remove('is-unread-first');
				row.classList.remove('is-unread-middle');
				row.classList.remove('is-unread-last');
				row.classList.remove('is-unread-solo');
			}
		}, 2300);
	}

	function teardownBottomDwellTimer() {
		if (bottomDwellTimer != null) {
			clearTimeout(bottomDwellTimer);
			bottomDwellTimer = null;
		}
		bottomDwellThreadId = null;
	}

	/** Mark read only after the latest message row is visible (IntersectionObserver). */
	async function markLatestMessageRead() {
		const threadId = activeThreadId;
		if (!threadId || loadingMessages) return;
		const messages = lastChatMessagesPayload;
		if (!Array.isArray(messages) || messages.length === 0) return;
		const last = messages[messages.length - 1];
		const mid = Number(last?.id);
		if (!Number.isFinite(mid) || mid <= 0) return;
		if (lastMarkReadSentId === mid) return;
		lastMarkReadSentId = mid;
		try {
			const res = await fetch(`/api/chat/threads/${threadId}/read`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
				body: JSON.stringify({ last_read_message_id: mid })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				lastMarkReadSentId = null;
				return;
			}
			const lr =
				data?.last_read_message_id != null ? Number(data.last_read_message_id) : mid;
			if (Number.isFinite(lr) && lr > 0) {
				patchChatThreadRow(threadId, { last_read_message_id: lr, unread_count: 0 });
			}
			fadeOutUnreadHighlightsInDom();
			dispatchChatUnreadRefresh();
			void refreshChatSidebar({ skipThreadsFetch: true });
		} catch {
			lastMarkReadSentId = null;
		}
	}

	function teardownLatestMessageReadObserver() {
		if (latestMessageReadObserver) {
			try {
				latestMessageReadObserver.disconnect();
			} catch {
				// ignore
			}
			latestMessageReadObserver = null;
		}
	}

	function setupLatestMessageReadObserver() {
		teardownLatestMessageReadObserver();
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || typeof IntersectionObserver === 'undefined') return;
		const lastRow = messagesEl.querySelector('.connect-chat-msg[data-chat-latest="1"]');
		if (!lastRow) return;

		latestMessageReadObserver = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (
						e.target === lastRow &&
						e.isIntersecting &&
						e.intersectionRatio >= 0.42
					) {
						void markLatestMessageRead();
					}
				}
			},
			{
				root: messagesEl,
				rootMargin: '0px 0px -12px 0px',
				threshold: [0, 0.1, 0.2, 0.35, 0.42, 0.5, 0.65, 0.85, 1]
			}
		);
		latestMessageReadObserver.observe(lastRow);
	}

	function scrollChatMessagesToFirstUnread(unreadEl) {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || !unreadEl) return;
		chatStickToBottom = false;
		const apply = () => {
			unreadEl.scrollIntoView({ block: 'center', behavior: 'auto' });
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(() => {
				apply();
				updateChatStickToBottomFromScroll();
			});
		});
	}

	function updateChatStickToBottomFromScroll() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
		const nextStick = dist <= CHAT_BOTTOM_THRESHOLD_PX;
		const prevStick = chatStickToBottom;
		chatStickToBottom = nextStick;
		if (!nextStick) {
			teardownBottomDwellTimer();
			return;
		}
		// If the user stays pinned to the bottom briefly, treat that as "caught up" even if IO is flaky.
		const threadId = activeThreadId;
		if (!threadId) return;
		if (prevStick && bottomDwellTimer != null && bottomDwellThreadId === threadId) {
			return;
		}
		teardownBottomDwellTimer();
		bottomDwellThreadId = threadId;
		bottomDwellTimer = setTimeout(() => {
			bottomDwellTimer = null;
			if (activeThreadId !== threadId) return;
			if (!chatStickToBottom) return;
			void markLatestMessageRead();
		}, 4000);
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
		teardownBottomDwellTimer();
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
		teardownLatestMessageReadObserver();
		teardownBottomDwellTimer();
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
		sendBtn.hidden = String(inp.value || '').trim().length === 0;
	}

	function findOptimisticRow(messagesEl, tempId) {
		if (!messagesEl || !tempId) return null;
		for (const el of messagesEl.querySelectorAll('[data-chat-optimistic-id]')) {
			if (el.getAttribute('data-chat-optimistic-id') === tempId) return el;
		}
		return null;
	}

	function getViewerChatProfileHints() {
		const vid = chatViewerId;
		if (!Number.isFinite(vid)) return { handleRaw: '', avatarUrl: '' };
		const list = Array.isArray(lastChatMessagesPayload) ? lastChatMessagesPayload : [];
		for (let i = list.length - 1; i >= 0; i--) {
			const m = list[i];
			if (Number(m?.sender_id) === vid) {
				const handleRaw = m.sender_user_name != null ? String(m.sender_user_name).trim() : '';
				return { handleRaw, avatarUrl: String(m.sender_avatar_url || '') };
			}
		}
		return { handleRaw: '', avatarUrl: '' };
	}

	function mountOptimisticRow(messagesEl, opt, sameSenderAsPrev, viewerId) {
		const row = document.createElement('div');
		const pending = opt.status === 'pending';
		row.className = `connect-chat-msg is-self${sameSenderAsPrev ? ' is-group-continue' : ''}${pending ? ' is-optimistic-pending' : ' is-optimistic-failed'}`;
		row.setAttribute('data-chat-optimistic-id', opt.tempId);
		const inner = document.createElement('div');
		inner.className = 'connect-chat-msg-inner';
		const hints = getViewerChatProfileHints();
		const handleRaw = hints.handleRaw;
		const displayForAvatar = handleRaw || 'You';
		const handleLabel = handleRaw ? `@${handleRaw}` : 'You';
		const profileHref = buildProfilePath({ userName: handleRaw || undefined, userId: viewerId });

		if (!sameSenderAsPrev) {
			const metaLine = document.createElement('div');
			metaLine.className = 'connect-chat-msg-meta';
			const avatarWrap = document.createElement('div');
			avatarWrap.innerHTML = renderCommentAvatarHtml({
				avatarUrl: hints.avatarUrl,
				displayName: displayForAvatar,
				color: getAvatarColor(handleRaw || String(viewerId)),
				href: profileHref || undefined,
				flairSize: 'xs'
			});
			while (avatarWrap.firstChild) metaLine.appendChild(avatarWrap.firstChild);
			const textSpan = document.createElement('span');
			textSpan.className = 'connect-chat-msg-meta-text';
			const nameSpan = document.createElement('span');
			nameSpan.className = 'connect-chat-msg-meta-user';
			nameSpan.textContent = handleLabel;
			textSpan.appendChild(nameSpan);
			if (pending) {
				const sepSpan = document.createElement('span');
				sepSpan.className = 'connect-chat-msg-meta-sep';
				sepSpan.textContent = ' · ';
				textSpan.appendChild(sepSpan);
				const whenSpan = document.createElement('span');
				whenSpan.className = 'connect-chat-msg-meta-when';
				whenSpan.textContent = 'Sending…';
				textSpan.appendChild(whenSpan);
			}
			metaLine.appendChild(textSpan);
			inner.appendChild(metaLine);
		}

		if (!pending) {
			const failedLine = document.createElement('div');
			failedLine.className = 'chat-page-optimistic-failed-line';
			const iconWrap = document.createElement('span');
			iconWrap.className = 'chat-page-optimistic-failed-icon';
			iconWrap.setAttribute('aria-hidden', 'true');
			iconWrap.innerHTML =
				'<svg class="chat-page-optimistic-failed-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
				'<circle cx="8" cy="8" r="8" fill="currentColor"/>' +
				'<path fill="var(--bg)" d="M8 3.5c.41 0 .75.34.75.75v4.5a.75.75 0 01-1.5 0v-4.5c0-.41.34-.75.75-.75zm0 7a.75.75 0 110 1.5.75.75 0 010-1.5z"/>' +
				'</svg>';
			const textWrap = document.createElement('span');
			textWrap.className = 'chat-page-optimistic-failed-copy';
			textWrap.appendChild(document.createTextNode('Failed to send. '));
			const retryBtn = document.createElement('button');
			retryBtn.type = 'button';
			retryBtn.className = 'chat-page-optimistic-retry';
			retryBtn.setAttribute('data-chat-optimistic-resend', opt.tempId);
			retryBtn.setAttribute('aria-label', 'Retry sending message');
			retryBtn.textContent = 'Click here to retry.';
			textWrap.appendChild(retryBtn);
			failedLine.appendChild(iconWrap);
			failedLine.appendChild(textWrap);
			inner.appendChild(failedLine);
		}

		const bubble = document.createElement('div');
		bubble.className = 'connect-chat-msg-bubble';
		bubble.innerHTML = processUserText(opt.body ?? '');
		inner.appendChild(bubble);

		row.appendChild(inner);
		messagesEl.appendChild(row);
		row.setAttribute('data-chat-latest', '1');
		hydrateUserTextLinks(row);
		hydrateChatYoutubeEmbeds(row);
		hydrateChatCreationEmbeds(row);
		for (const b of row.querySelectorAll('.connect-chat-msg-bubble')) {
			trimTrailingWhitespaceAfterChatEmbed(b);
		}
		for (const embed of row.querySelectorAll('.connect-chat-creation-embed')) {
			trimChatCreationEmbedWhitespace(embed);
		}
	}

	async function postChatMessage(threadId, body) {
		if (chatSimulateSendFail()) {
			await new Promise((r) => setTimeout(r, 400));
			return {
				ok: false,
				error: 'Simulated failure (remove ?chatSimulateSendFail=1 from the URL to send for real)'
			};
		}
		const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ body })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { ok: false, error: data.message || data.error || 'Could not send' };
		}
		return { ok: true };
	}

	function placeOptimisticInDom(messagesEl, opt) {
		const vid = chatViewerId;
		findOptimisticRow(messagesEl, opt.tempId)?.remove();
		messagesEl.querySelector('[data-chat-latest="1"]')?.removeAttribute('data-chat-latest');
		const last = lastChatMessagesPayload[lastChatMessagesPayload.length - 1];
		const sameSenderAsPrev =
			last != null && Number.isFinite(Number(vid)) && Number(last.sender_id) === Number(vid);
		mountOptimisticRow(messagesEl, opt, sameSenderAsPrev, vid);
		chatStickToBottom = true;
		scrollChatMessagesToEnd();
		setupReactionTooltipTap(messagesEl);
	}

	async function afterSendSuccess(threadId) {
		optimisticSend = null;
		await loadMessages();
		const tail = lastChatMessagesPayload[lastChatMessagesPayload.length - 1];
		const newMid = tail?.id != null ? Number(tail.id) : null;
		if (Number.isFinite(newMid) && newMid > 0) {
			patchChatThreadRow(threadId, { last_read_message_id: newMid, unread_count: 0 });
			lastMarkReadSentId = newMid;
		}
		fadeOutUnreadHighlightsInDom();
		dispatchChatUnreadRefresh();
		void refreshChatSidebar({ skipThreadsFetch: true });
	}

	async function resendOptimisticFromUi(tempId) {
		if (!optimisticSend || optimisticSend.tempId !== tempId || optimisticSend.status !== 'failed') return;
		if (sendInFlight) return;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const { threadId, body } = optimisticSend;
		const errEl = root.querySelector('[data-chat-error]');
		sendInFlight = true;
		optimisticSend = { tempId, body, threadId, status: 'pending' };
		placeOptimisticInDom(messagesEl, optimisticSend);
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}
		try {
			const result = await postChatMessage(threadId, body);
			if (!result.ok) {
				optimisticSend = {
					tempId,
					body,
					threadId,
					status: 'failed',
					errorMessage: result.error
				};
				placeOptimisticInDom(messagesEl, optimisticSend);
				return;
			}
			await afterSendSuccess(threadId);
		} catch (err) {
			console.error('[Chat page] resend:', err);
			optimisticSend = {
				tempId,
				body,
				threadId,
				status: 'failed',
				errorMessage: err?.message || 'Could not send message.'
			};
			placeOptimisticInDom(messagesEl, optimisticSend);
		} finally {
			sendInFlight = false;
		}
	}

	function teardownChatViewportSync() {
		if (typeof chatViewportCleanup === 'function') {
			chatViewportCleanup();
			chatViewportCleanup = null;
		}
	}

	/**
	 * When the visual viewport changes (keyboard, URL bar, rotate), re-pin the message list
	 * if the user was already stuck to the bottom. Does not set root height — that caused
	 * clipped/off-screen composers across WebKit versions.
	 */
	function setupChatViewportSync() {
		teardownChatViewportSync();
		const nudge = () => nudgeChatScrollIfStuckToBottom();
		const onVVResize = () => nudge();
		const onVVScroll = () => nudge();
		const onWinResize = () => nudge();
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', onVVResize);
			window.visualViewport.addEventListener('scroll', onVVScroll);
		}
		window.addEventListener('resize', onWinResize);
		chatViewportCleanup = () => {
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', onVVResize);
				window.visualViewport.removeEventListener('scroll', onVVScroll);
			}
			window.removeEventListener('resize', onWinResize);
		};
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
					<div class="comment-reaction-pills">
						<div class="comment-reaction-pills-inner">${reactionPills}${addReactionBtn}</div>
					</div>
				</div>
			</div>
		</div>`;
	}

	/**
	 * Update cached message + reaction footer only (avoids full `loadMessages()` so embedded videos keep playing).
	 * @param {number} messageId
	 * @param {string} emojiKey
	 * @param {{ added?: boolean, count?: number } | undefined} data — JSON from POST …/reactions
	 */
	function applyChatReactionAfterToggle(messageId, emojiKey, data) {
		if (!data || typeof data.count !== 'number' || !Number.isFinite(data.count)) {
			void loadMessages();
			return;
		}
		const count = Math.max(0, Math.floor(data.count));
		const added = data.added === true;
		const mid = Number(messageId);
		const m = lastChatMessagesPayload.find((x) => Number(x.id) === mid);
		if (!m) {
			void loadMessages();
			return;
		}
		m.reactions = m.reactions && typeof m.reactions === 'object' ? { ...m.reactions } : {};
		m.viewer_reactions = Array.isArray(m.viewer_reactions) ? [...m.viewer_reactions] : [];
		if (count > 0) {
			m.reactions[emojiKey] = count;
		} else {
			delete m.reactions[emojiKey];
		}
		if (added) {
			if (!m.viewer_reactions.includes(emojiKey)) m.viewer_reactions.push(emojiKey);
		} else {
			m.viewer_reactions = m.viewer_reactions.filter((k) => k !== emojiKey);
		}
		patchChatMessageReactionDom(mid, m);
	}

	function patchChatMessageReactionDom(messageId, m) {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const row = messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${messageId}"]`);
		if (!row) return;
		const inner = row.querySelector('.connect-chat-msg-inner');
		if (!inner) return;
		const reactionHtml = buildChatReactionMetaRowHtml(m);
		let footer = inner.querySelector('.connect-chat-msg-footer');
		if (reactionHtml) {
			if (!footer) {
				footer = document.createElement('div');
				footer.className = 'connect-chat-msg-footer';
				inner.appendChild(footer);
			}
			footer.innerHTML = reactionHtml.trim();
		} else if (footer) {
			footer.remove();
		}
		if (messageHasAnyReactions(m)) {
			row.classList.remove('connect-chat-msg--reaction-empty');
		} else {
			row.classList.add('connect-chat-msg--reaction-empty');
		}
	}

	/**
	 * Preserve embed video playback across `loadMessages()` re-renders.
	 * Keyed by message id + video src. Best-effort: if any step fails, we simply don't restore.
	 */
	function captureChatVideoPlaybackStates(messagesEl) {
		try {
			const out = [];
			for (const v of messagesEl.querySelectorAll('video')) {
				if (!(v instanceof HTMLVideoElement)) continue;
				const row = v.closest('.connect-chat-msg[data-chat-message-id]');
				const messageId = row ? Number(row.getAttribute('data-chat-message-id')) : null;
				if (!Number.isFinite(messageId) || messageId <= 0) continue;
				const src = v.currentSrc || v.getAttribute('src') || '';
				if (!src) continue;
				const t = Number(v.currentTime);
				if (!Number.isFinite(t) || t < 0) continue;
				out.push({
					messageId,
					src,
					currentTime: t,
					wasPaused: v.paused,
					muted: v.muted,
					volume: typeof v.volume === 'number' ? v.volume : 1
				});
			}
			return out;
		} catch {
			return [];
		}
	}

	function restoreChatVideoPlaybackStates(messagesEl, states) {
		if (!Array.isArray(states) || states.length === 0) return;
		for (const s of states) {
			const mid = Number(s?.messageId);
			const src = typeof s?.src === 'string' ? s.src : '';
			const t = Number(s?.currentTime);
			const wasPaused = s?.wasPaused === true;
			const prevMuted = s?.muted;
			const prevVol = s?.volume;
			if (!Number.isFinite(mid) || mid <= 0 || !src || !Number.isFinite(t) || t < 0) continue;
			const row = messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
			if (!row) continue;
			const vids = [...row.querySelectorAll('video')].filter((v) => v instanceof HTMLVideoElement);
			if (vids.length === 0) continue;
			const v =
				vids.find((vv) => (vv.currentSrc || vv.getAttribute('src') || '') === src) ||
				vids.find((vv) => (vv.currentSrc || vv.getAttribute('src') || '').includes(src)) ||
				vids[0];
			if (!(v instanceof HTMLVideoElement)) continue;

			const apply = () => {
				try {
					if (typeof prevVol === 'number' && Number.isFinite(prevVol)) {
						v.volume = Math.min(1, Math.max(0, prevVol));
					}
					if (typeof prevMuted === 'boolean') {
						v.muted = prevMuted;
					}
					v.currentTime = t;
					if (!wasPaused) {
						const p = v.play();
						if (p && typeof p.catch === 'function') p.catch(() => {});
					}
				} catch {
					// ignore
				}
			};

			if (v.readyState >= 1) {
				apply();
			} else {
				const onMeta = () => {
					v.removeEventListener('loadedmetadata', onMeta);
					apply();
				};
				v.addEventListener('loadedmetadata', onMeta);
			}
		}
	}

	function closeReactionPicker() {
		if (activeReactionPicker && activeReactionPicker.parentNode) {
			activeReactionPicker.parentNode.removeChild(activeReactionPicker);
			document.removeEventListener('click', activeReactionPicker._outsideClick);
			document.removeEventListener('keydown', activeReactionPicker._escapeKeydown);
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
		const escapeKeydown = (e) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			closeReactionPicker();
		};
		panel._escapeKeydown = escapeKeydown;
		requestAnimationFrame(() => document.addEventListener('click', outsideClick));
		document.addEventListener('keydown', escapeKeydown);

		activeReactionPicker = panel;
	}

	async function loadChatThreads(options = {}) {
		const forceNetwork = options.forceNetwork === true;
		const allowCache = options.allowCache !== false;

		const cached = allowCache ? readCachedChatThreads?.() : null;
		const needNetwork =
			forceNetwork ||
			!cached ||
			isChatThreadsCacheStale?.(cached.cachedAt);

		// Paint from cache immediately (sidebar can render synchronously).
		if (cached && !forceNetwork) {
			chatViewerId = cached.viewerId;
			chatThreads = cached.threads;
		}

		if (!needNetwork) {
			return { fromCache: Boolean(cached), fromNetwork: false };
		}

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
		if (chatViewerId != null && Number.isFinite(chatViewerId)) {
			try {
				writeCachedChatThreads?.(chatViewerId, chatThreads);
			} catch {
				// ignore
			}
		}
		return { fromCache: Boolean(cached), fromNetwork: true };
	}

	function normalizePathForCompare(p) {
		const s = String(p || '')
			.replace(/\/+$/, '')
			.trim();
		return s || '/';
	}

	function isChatHrefActive(href) {
		const cur = normalizePathForCompare(window.location.pathname);
		let pathOnly = href;
		if (typeof href === 'string' && href.startsWith('/')) {
			pathOnly = href.split('?')[0].split('#')[0];
		} else {
			try {
				pathOnly = new URL(href, window.location.origin).pathname;
			} catch {
				return false;
			}
		}
		return normalizePathForCompare(pathOnly) === cur;
	}

	async function fetchJoinedServersForChat() {
		const result = await fetchJsonWithStatusDeduped(
			'/api/servers',
			{ credentials: 'include' },
			{ windowMs: 2000 }
		);
		if (!result.ok) return [];
		const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
		return servers
			.filter((s) => s && s.is_member)
			.map((s) => ({
				id: Number(s.id),
				name: typeof s.name === 'string' ? s.name.trim() : ''
			}))
			.filter((s) => Number.isFinite(s.id) && s.id > 0);
	}

	async function fetchPresenceOnlineIds() {
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

	async function refreshChatSidebar(options = {}) {
		const skipThreads = options.skipThreadsFetch === true;
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;
		const chEl = sidebar.querySelector('[data-chat-sidebar-channels]');
		const dmEl = sidebar.querySelector('[data-chat-sidebar-users]');
		if (!chEl || !dmEl) return;

		// Phase 1: fast paint from cache (no extra fetches) if we have nothing rendered yet.
		if (!skipThreads && (chatThreads || []).length === 0) {
			try {
				await loadChatThreads({ allowCache: true, forceNetwork: false });
			} catch {
				// ignore: we'll handle on the network attempt below
			}
		}

		const deps = { renderCommentAvatarHtml, getAvatarColor };
		const render = (threads, joined, onlineIds) => {
			const merged = rosterMod.mergeThreadRowsWithJoinedServers(threads, joined);
			const channels = merged.filter((t) => t && t.type === 'channel');
			const dms = merged.filter((t) => t && t.type === 'dm');

			function rowHtml(t) {
				const href = rosterMod.buildChatThreadUrl(t);
				const active = isChatHrefActive(href);
				const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
				const last = t.last_message;
				const preview =
					last && typeof last.body === 'string'
						? last.body.trim().replace(/\s+/g, ' ').slice(0, 120)
						: '';
				const avatarHtml = rosterMod.buildChatThreadRowAvatarHtml(t, deps);
				let presenceClass = '';
				if (t.type === 'dm') {
					const oid = rosterMod.getDmOtherUserId(t);
					const online = isDmConsideredOnlineWithGrace(oid, onlineIds);
					presenceClass = online ? 'is-online' : 'is-offline';
				}
				const activeClass = active ? ' is-active' : '';
				const pc = presenceClass ? ` ${presenceClass}` : '';
				const unc = Number(t.unread_count);
				const showUnread =
					!active && Number.isFinite(unc) && unc > 0;
				const unreadLabel = unc > 99 ? '99+' : String(unc);
				const unreadHtml = showUnread
					? `<span class="chat-page-sidebar-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>`
					: '';
				return `<a class="chat-page-sidebar-row${activeClass}${pc}" href="${escapeHtml(href)}">
					${avatarHtml}
					<div class="chat-page-sidebar-row-body">
						<div class="chat-page-sidebar-row-title-line">
							<span class="chat-page-sidebar-row-title">${escapeHtml(title)}</span>
							${unreadHtml}
						</div>
						${preview ? `<span class="chat-page-sidebar-row-preview">${escapeHtml(preview)}</span>` : ''}
					</div>
				</a>`;
			}

			chEl.innerHTML = channels.length
				? channels.map(rowHtml).join('')
				: '<p class="chat-page-sidebar-empty">No channels yet.</p>';
			dmEl.innerHTML = dms.length
				? dms.map(rowHtml).join('')
				: '<p class="chat-page-sidebar-empty">No direct messages yet.</p>';
		};

		// Fast paint (no presence/joined yet) using whatever we have.
		render(chatThreads || [], [], new Set());

		// Phase 2: hydrate with network data in parallel (threads, joined servers, presence).
		if (skipThreads) {
			const [joined, onlineIds] = await Promise.all([
				fetchJoinedServersForChat(),
				fetchPresenceOnlineIds()
			]);
			render(chatThreads || [], joined, onlineIds);
			return;
		}

		try {
			const [_, joined, onlineIds] = await Promise.all([
				loadChatThreads({ allowCache: true, forceNetwork: true }),
				fetchJoinedServersForChat(),
				fetchPresenceOnlineIds()
			]);
			render(chatThreads || [], joined, onlineIds);
			dispatchChatUnreadRefresh();
		} catch {
			// If network fails, keep cached render.
		}
	}

	function setupChatSidebarClientNav() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;

		chatSidebarNavClickHandler = (e) => {
			const a = e.target?.closest?.('a.chat-page-sidebar-row');
			if (!(a instanceof HTMLAnchorElement)) return;
			if (e.defaultPrevented) return;
			if (e.button !== 0) return;
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			let nextUrl;
			try {
				nextUrl = new URL(a.href, window.location.href);
			} catch {
				return;
			}
			if (nextUrl.origin !== window.location.origin) return;
			if (!nextUrl.pathname.startsWith('/chat')) return;
			const cur = normalizePathForCompare(window.location.pathname);
			const next = normalizePathForCompare(nextUrl.pathname);
			if (cur === next) {
				e.preventDefault();
				return;
			}
			e.preventDefault();
			history.pushState({ prsnChat: true }, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
			void openThreadForCurrentPath().then(() => {
				void refreshChatSidebar({ skipThreadsFetch: true });
			});
		};
		sidebar.addEventListener('click', chatSidebarNavClickHandler);

		chatSidebarPopstateHandler = () => {
			void openThreadForCurrentPath().then(() => {
				void refreshChatSidebar({ skipThreadsFetch: true });
			});
		};
		window.addEventListener('popstate', chatSidebarPopstateHandler);
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
			const slug = String(t.channel_slug);
			chatThreads.push({
				id: tid,
				type: 'channel',
				channel_slug: slug,
				title: typeof t.title === 'string' && t.title.trim() ? t.title.trim() : `#${slug}`,
				unread_count: 0,
				last_read_message_id: null
			});
		} else if (t.type === 'dm' && t.dm_pair_key) {
			const otherId = otherUserIdFromDmPair(t.dm_pair_key, viewerId);
			chatThreads.push({
				id: tid,
				type: 'dm',
				dm_pair_key: t.dm_pair_key,
				other_user_id: otherId,
				title:
					typeof t.title === 'string' && t.title.trim()
						? t.title.trim()
						: otherId != null
							? `User ${otherId}`
							: 'Chat',
				unread_count: 0,
				last_read_message_id: null
			});
		} else {
			chatThreads.push({
				id: tid,
				type: t.type || 'dm',
				title: 'Chat',
				unread_count: 0,
				last_read_message_id: null
			});
		}
		try {
			if (chatViewerId != null && Number.isFinite(Number(chatViewerId))) {
				writeCachedChatThreads?.(Number(chatViewerId), chatThreads);
			}
		} catch {
			// ignore
		}
	}

	async function loadMessages() {
		const threadId = activeThreadId;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !messagesEl || loadingMessages) return;
		if (threadId !== lastReadThreadIdForMark) {
			lastReadThreadIdForMark = threadId;
			lastMarkReadSentId = null;
		}
		loadingMessages = true;
		messagesEl.setAttribute('aria-busy', 'true');
		const prevVideoStates = captureChatVideoPlaybackStates(messagesEl);

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
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';

			const threadMeta = (chatThreads || []).find((t) => Number(t.id) === threadId);
			const lastReadBoundary =
				threadMeta?.last_read_message_id != null
					? Number(threadMeta.last_read_message_id)
					: null;

			// Compute the full visual "new" range so we can include the sender meta row even if the
			// first unread message is a group-continue (meta shown on the previous row).
			const unreadLogical = messages.map((m) => {
				const mid = m?.id != null ? Number(m.id) : null;
				const sid = m?.sender_id != null ? Number(m.sender_id) : null;
				const isSelf =
					Number.isFinite(viewerId) && Number.isFinite(sid) && sid === viewerId;
				return (
					!isSelf &&
					Number.isFinite(mid) &&
					mid > 0 &&
					(lastReadBoundary == null || mid > lastReadBoundary)
				);
			});
			let visualStart = unreadLogical.findIndex(Boolean);
			let visualEnd = -1;
			for (let i = unreadLogical.length - 1; i >= 0; i--) {
				if (unreadLogical[i]) {
					visualEnd = i;
					break;
				}
			}
			if (visualStart > 0) {
				const first = messages[visualStart];
				const prev = messages[visualStart - 1];
				const firstSender = first?.sender_id != null ? Number(first.sender_id) : null;
				const prevSender = prev?.sender_id != null ? Number(prev.sender_id) : null;
				const prevIsSelf = Number.isFinite(viewerId) && Number.isFinite(prevSender) && prevSender === viewerId;
				const sameSender =
					Number.isFinite(firstSender) &&
					Number.isFinite(prevSender) &&
					firstSender === prevSender;
				if (sameSender && !prevIsSelf) {
					// Include the meta-bearing row (the previous message in the run).
					visualStart = visualStart - 1;
				}
			}
			const hasVisualUnreadRange = visualStart >= 0 && visualEnd >= visualStart;

			if (messages.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'chat-page-empty-hint';
				empty.setAttribute('role', 'status');
				empty.textContent = 'No messages yet. Send one below.';
				messagesEl.appendChild(empty);
			}

			for (let i = 0; i < messages.length; i++) {
				const m = messages[i];
				const midNum = Number(m.id);
				const senderIdPre = Number(m.sender_id);
				const isSelfPre = Number.isFinite(viewerId) && senderIdPre === viewerId;
				const senderId = Number(m.sender_id);
				const isSelf = Number.isFinite(viewerId) && senderId === viewerId;
				const prev = i > 0 ? messages[i - 1] : null;
				const sameSenderAsPrev =
					prev != null && Number(prev.sender_id) === senderId;
				const row = document.createElement('div');
				row.className = `connect-chat-msg${isSelf ? ' is-self' : ''}${sameSenderAsPrev ? ' is-group-continue' : ''}`;
				row.setAttribute('data-chat-message-id', String(m.id));
				const isUnread =
					hasVisualUnreadRange &&
					!isSelf &&
					i >= visualStart &&
					i <= visualEnd;
				if (isUnread) {
					row.classList.add('is-unread');
					const prevMsg = i > 0 ? messages[i - 1] : null;
					const nextMsg = i + 1 < messages.length ? messages[i + 1] : null;
					const prevId = prevMsg?.id != null ? Number(prevMsg.id) : null;
					const nextId = nextMsg?.id != null ? Number(nextMsg.id) : null;
					const prevSender = prevMsg?.sender_id != null ? Number(prevMsg.sender_id) : null;
					const nextSender = nextMsg?.sender_id != null ? Number(nextMsg.sender_id) : null;
					const prevIsSelf = Number.isFinite(viewerId) && prevSender === viewerId;
					const nextIsSelf = Number.isFinite(viewerId) && nextSender === viewerId;
					const prevUnread =
						hasVisualUnreadRange && !prevIsSelf && i - 1 >= visualStart && i - 1 <= visualEnd;
					const nextUnread =
						hasVisualUnreadRange && !nextIsSelf && i + 1 >= visualStart && i + 1 <= visualEnd;
					if (!prevUnread && !nextUnread) {
						row.classList.add('is-unread-solo');
					} else if (!prevUnread && nextUnread) {
						row.classList.add('is-unread-first');
					} else if (prevUnread && nextUnread) {
						row.classList.add('is-unread-middle');
					} else if (prevUnread && !nextUnread) {
						row.classList.add('is-unread-last');
					}
				}
				if (i === messages.length - 1) {
					row.setAttribute('data-chat-latest', '1');
				}
				if (!messageHasAnyReactions(m)) {
					row.classList.add('connect-chat-msg--reaction-empty');
				}
				const inner = document.createElement('div');
				inner.className = 'connect-chat-msg-inner';
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
					const nameSpan = document.createElement('span');
					nameSpan.className = 'connect-chat-msg-meta-user';
					nameSpan.textContent = handleLabel;
					textSpan.appendChild(nameSpan);
					if (when) {
						const sepSpan = document.createElement('span');
						sepSpan.className = 'connect-chat-msg-meta-sep';
						sepSpan.textContent = ' · ';
						textSpan.appendChild(sepSpan);
						const whenSpan = document.createElement('span');
						whenSpan.className = 'connect-chat-msg-meta-when';
						whenSpan.textContent = when;
						textSpan.appendChild(whenSpan);
					}
					metaLine.appendChild(textSpan);
					inner.appendChild(metaLine);
				}
				inner.appendChild(bubble);
				const reactionHtml = buildChatReactionMetaRowHtml(m);
				if (reactionHtml) {
					const footer = document.createElement('div');
					footer.className = 'connect-chat-msg-footer';
					footer.innerHTML = reactionHtml.trim();
					inner.appendChild(footer);
				}
				row.appendChild(inner);
				messagesEl.appendChild(row);
			}
			if (optimisticSend && Number(optimisticSend.threadId) === threadId) {
				messagesEl.querySelector('.chat-page-empty-hint')?.remove();
				messagesEl.querySelector('[data-chat-latest="1"]')?.removeAttribute('data-chat-latest');
				const last = messages[messages.length - 1];
				const sameSenderAsPrev =
					last != null &&
					Number.isFinite(Number(viewerId)) &&
					Number(last.sender_id) === Number(viewerId);
				mountOptimisticRow(messagesEl, optimisticSend, sameSenderAsPrev, viewerId);
			}
			hydrateUserTextLinks(messagesEl);
			hydrateChatYoutubeEmbeds(messagesEl);
			hydrateChatCreationEmbeds(messagesEl);
			for (const bubble of messagesEl.querySelectorAll('.connect-chat-msg-bubble')) {
				trimTrailingWhitespaceAfterChatEmbed(bubble);
			}
			for (const embed of messagesEl.querySelectorAll('.connect-chat-creation-embed')) {
				trimChatCreationEmbedWhitespace(embed);
			}
			restoreChatVideoPlaybackStates(messagesEl, prevVideoStates);
			setupReactionTooltipTap(messagesEl);
			const firstUnread = messagesEl.querySelector('.connect-chat-msg.is-unread');
			if (firstUnread) {
				scrollChatMessagesToFirstUnread(firstUnread);
			} else {
				scrollChatMessagesToEnd();
			}
			window.setTimeout(() => {
				setupLatestMessageReadObserver();
			}, 550);
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
		const resendBtn = e.target?.closest?.('[data-chat-optimistic-resend]');
		if (resendBtn instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			const tempId = resendBtn.getAttribute('data-chat-optimistic-resend');
			if (tempId) void resendOptimisticFromUi(tempId);
			return;
		}

		const pill = e.target?.closest?.('.comment-reaction-pill[data-emoji-key][data-chat-message-id]');
		if (pill && pill instanceof HTMLElement) {
			const messageId = Number(pill.dataset.chatMessageId);
			const emojiKey = pill.dataset.emojiKey;
			if (!Number.isFinite(messageId) || !emojiKey) return;
			void toggleChatMessageReaction(messageId, emojiKey).then((res) => {
				if (res?.ok) applyChatReactionAfterToggle(messageId, emojiKey, res.data);
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
					if (res?.ok) applyChatReactionAfterToggle(mid, ek, res.data);
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
					if (res?.ok) applyChatReactionAfterToggle(mid, ek, res.data);
				});
			});
		}
	}

	async function submitChatMessage() {
		const threadId = activeThreadId;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !(bodyInput instanceof HTMLTextAreaElement) || !messagesEl) return;
		if (sendInFlight) return;

		const text = String(bodyInput.value || '').trim();
		if (!text) return;

		const tempId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

		sendInFlight = true;
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}

		optimisticSend = { tempId, body: text, threadId, status: 'pending' };
		bodyInput.value = '';
		syncChatSendButton();
		messagesEl.querySelector('.chat-page-empty-hint')?.remove();
		placeOptimisticInDom(messagesEl, optimisticSend);

		try {
			const result = await postChatMessage(threadId, text);
			if (!result.ok) {
				optimisticSend = {
					tempId,
					body: text,
					threadId,
					status: 'failed',
					errorMessage: result.error
				};
				placeOptimisticInDom(messagesEl, optimisticSend);
				return;
			}
			await afterSendSuccess(threadId);
		} catch (err) {
			console.error('[Chat page] send:', err);
			optimisticSend = {
				tempId,
				body: text,
				threadId,
				status: 'failed',
				errorMessage: err?.message || 'Could not send message.'
			};
			placeOptimisticInDom(messagesEl, optimisticSend);
		} finally {
			sendInFlight = false;
			syncChatSendButton();
			requestAnimationFrame(() => {
				try {
					bodyInput.focus({ preventScroll: true });
				} catch {
					bodyInput.focus();
				}
			});
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

		optimisticSend = null;

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
	const sendBtnEl = root.querySelector('[data-chat-send]');
	if (sendBtnEl instanceof HTMLButtonElement) {
		/* type="button" + send on pointerdown: preventDefault() stops the button taking focus
		 * (keeps keyboard up) but also suppresses click — so we must call submit here.
		 * click fires as fallback for keyboard activation; sendInFlight / empty body guard doubles. */
		const activateSend = () => {
			void submitChatMessage();
		};
		sendBtnEl.addEventListener('pointerdown', (e) => {
			if (sendBtnEl.disabled) return;
			e.preventDefault();
			activateSend();
		});
		sendBtnEl.addEventListener('click', (e) => {
			if (sendBtnEl.disabled) return;
			e.preventDefault();
			activateSend();
		});
	}
	if (bodyInput instanceof HTMLTextAreaElement) {
		attachAutoGrowTextarea(bodyInput);
		attachMentionSuggest(bodyInput);
		bodyInput.addEventListener('input', () => syncChatSendButton());
		bodyInput.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Enter' || ev.isComposing) return;
			if (!ENTER_SENDS) return;
			if (ev.shiftKey) return;
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
		if (chatSidebarPollTimer != null) {
			clearInterval(chatSidebarPollTimer);
			chatSidebarPollTimer = null;
		}
		if (typeof chatSidebarServersHandler === 'function') {
			document.removeEventListener('servers-updated', chatSidebarServersHandler);
			chatSidebarServersHandler = null;
		}
		const sidebarNav = document.querySelector('[data-chat-sidebar]');
		if (sidebarNav && typeof chatSidebarNavClickHandler === 'function') {
			sidebarNav.removeEventListener('click', chatSidebarNavClickHandler);
			chatSidebarNavClickHandler = null;
		}
		if (typeof chatSidebarPopstateHandler === 'function') {
			window.removeEventListener('popstate', chatSidebarPopstateHandler);
			chatSidebarPopstateHandler = null;
		}
		if (typeof chatSidebarVisibilityHandler === 'function') {
			document.removeEventListener('visibilitychange', chatSidebarVisibilityHandler);
			chatSidebarVisibilityHandler = null;
		}
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
				void refreshChatSidebar({ skipThreadsFetch: true });
			});
		});
	}

	await openThreadForCurrentPath();
	void refreshChatSidebar({ skipThreadsFetch: true });
	dispatchChatUnreadRefresh();
	/** Poll often enough that DM online/offline styling tracks presence without feeling stuck. */
	chatSidebarPollTimer = setInterval(() => void refreshChatSidebar(), 15000);
	chatSidebarServersHandler = () => void refreshChatSidebar();
	document.addEventListener('servers-updated', chatSidebarServersHandler);
	chatSidebarVisibilityHandler = () => {
		if (document.visibilityState !== 'visible') return;
		void refreshChatSidebar({ skipThreadsFetch: true });
	};
	document.addEventListener('visibilitychange', chatSidebarVisibilityHandler);
	setupChatSidebarClientNav();
}
