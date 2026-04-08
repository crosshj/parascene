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

/** Hide repeated sender meta when the next message is same author within this window (ms). */
const CHAT_MESSAGE_GROUP_GAP_MS = 7 * 60 * 1000;

function parseChatMessageCreatedMs(m) {
	if (!m || m.created_at == null) return NaN;
	const t = Date.parse(String(m.created_at));
	return Number.isFinite(t) ? t : NaN;
}

/**
 * Same sender as the row above and within the time window — one visual group (single meta row).
 */
function isChatMessageGroupContinue(prev, current) {
	if (prev == null || current == null) return false;
	if (Number(prev.sender_id) !== Number(current.sender_id)) return false;
	const prevMs = parseChatMessageCreatedMs(prev);
	const curMs = parseChatMessageCreatedMs(current);
	if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) return false;
	const delta = curMs - prevMs;
	if (delta < 0) return false;
	return delta <= CHAT_MESSAGE_GROUP_GAP_MS;
}

/** Whether an optimistic bubble can stack under the last loaded message from the viewer. */
function isOptimisticChatGroupContinue(lastMessage, viewerId) {
	if (lastMessage == null || !Number.isFinite(Number(viewerId))) return false;
	if (Number(lastMessage.sender_id) !== Number(viewerId)) return false;
	const lastMs = parseChatMessageCreatedMs(lastMessage);
	if (!Number.isFinite(lastMs)) return false;
	return Date.now() - lastMs <= CHAT_MESSAGE_GROUP_GAP_MS;
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
let createConnectCommentRowElement;

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

		const connectCardMod = await import(`../shared/connectCommentCard.js${qs}`);
		createConnectCommentRowElement = connectCardMod.createConnectCommentRowElement;
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

/**
 * Generic inline images are `display: block`; `pre-wrap` turns `\n` between the image and caption
 * into a tall line box (unlike back-to-back message rows). Strip boundary whitespace, then wrap
 * a leading plain-text caption so spacing matches an image message followed by a text message.
 */
function normalizeChatBubbleInlineImageSpacing(bubble) {
	if (!(bubble instanceof HTMLElement)) return;
	if (!bubble.querySelector('.user-text-inline-image-wrap')) return;

	for (const wrap of bubble.querySelectorAll('.user-text-inline-image-wrap')) {
		let prev = wrap.previousSibling;
		while (prev && prev.nodeType === Node.TEXT_NODE) {
			const raw = prev.nodeValue || '';
			const trimmed = raw.replace(/\s+$/, '');
			if (trimmed.length > 0) {
				prev.nodeValue = trimmed;
				break;
			}
			const rm = prev;
			prev = prev.previousSibling;
			rm.parentNode?.removeChild(rm);
		}
	}

	for (const wrap of bubble.querySelectorAll('.user-text-inline-image-wrap')) {
		let next = wrap.nextSibling;
		while (next && next.nodeType === Node.TEXT_NODE) {
			const raw = next.nodeValue || '';
			const trimmed = raw.replace(/^\s+/, '');
			if (trimmed.length > 0) {
				const cap = document.createElement('span');
				cap.className = 'user-text-inline-chat-caption';
				cap.textContent = trimmed;
				next.parentNode?.replaceChild(cap, next);
				break;
			}
			const rm = next;
			next = next.nextSibling;
			rm.parentNode?.removeChild(rm);
		}
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
	const {
		sendIcon,
		plusIcon,
		REACTION_ORDER,
		REACTION_ICONS,
		smileIcon,
		gearIcon,
		copyIcon,
		trashIcon
	} = await import(`../icons/svg-strings.js${qs}`);
	const chatSidebarServerGearSvg = gearIcon('chat-page-sidebar-server-settings-icon');
	const rosterMod = await import(`../shared/chatSidebarRoster.js${qs}`);
	const serverChatTagMod = await import(`../shared/serverChatTag.js${qs}`);
	const serverChannelTagFromServerName = serverChatTagMod.serverChannelTagFromServerName;

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
	const attachInlineMount = root.querySelector('[data-chat-add-image-inline]');
	if (attachInlineMount) {
		attachInlineMount.innerHTML = plusIcon('chat-page-composer-attach-inline-icon');
	}

	const docTitleBase = typeof document !== 'undefined' ? document.title : 'parascene';
	let chatViewerId = null;
	/** Set from GET /api/chat/threads (`viewer_is_admin`) or threads cache. */
	let chatViewerIsAdmin = false;
	let chatThreads = [];
	let activeThreadId = null;
	/** @type {string | null} — e.g. reserved `comments`; not a real chat thread id. */
	let activePseudoChannelSlug = null;
	let commentsChannelHasMore = false;
	let commentsChannelLoadingMore = false;
	/** @type {IntersectionObserver | null} */
	let commentsChannelLoadMoreObserver = null;
	const COMMENTS_CHANNEL_PAGE_SIZE = 50;
	let loadingMessages = false;
	let sendInFlight = false;
	/** Staged images before send (ChatGPT-style composer). */
	let chatPendingImages = [];
	/** Optimistic / failed send row (re-mounted after each loadMessages when still relevant). */
	let optimisticSend = null;
	/** @type {null | (() => void)} */
	let chatViewportCleanup = null;
	/** Debounced retries after focus (iOS keyboard animates; vv.height can lag). */
	let chatViewportRetryTimeouts = [];
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
	/** @type {null | ((e: Event) => void)} */
	let chatSidebarSectionAddHandler = null;
	/** @type {{ closeAll?: () => void } | null} */
	let chatSidebarModalsApi = null;
	/** @type {null | (() => void)} */
	let chatSidebarPopstateHandler = null;
	/** @type {null | (() => void)} */
	let chatSidebarVisibilityHandler = null;
	/** @type {null | ((e: PointerEvent) => void)} */
	let chatToolbarOutsidePointerHandler = null;
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatToolbarUnpinOnOtherRowHover = null;
	/** @type {HTMLElement | null} */
	let chatInlineImageLightboxEl = null;
	/** @type {null | ((e: KeyboardEvent) => void)} */
	let chatInlineImageLightboxKeydown = null;
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatInlineImageLightboxClickHandler = null;

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

	const CHAT_MAX_BODY_CHARS = 4000;

	function chatMiscGenericKeyFromApiPath(urlPath) {
		const s = String(urlPath || '').trim();
		const m = s.match(/\/api\/images\/generic\/(.+)$/);
		if (!m) return null;
		const tail = m[1].split('?')[0];
		try {
			const key = tail
				.split('/')
				.filter(Boolean)
				.map((seg) => decodeURIComponent(seg))
				.join('/');
			if (key.includes('..') || !/^profile\/\d+\/generic_[^/]+$/i.test(key)) return null;
			return key;
		} catch {
			return null;
		}
	}

	async function deleteChatMiscGenericOnServer(urlPath) {
		const key = chatMiscGenericKeyFromApiPath(urlPath);
		if (!key) return;
		const reqPath =
			'/api/images/generic/' + key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
		try {
			await fetch(reqPath, { method: 'DELETE', credentials: 'include' });
		} catch {
			// ignore
		}
	}

	function revokeChatAttachmentPreview(entry) {
		const u = entry?.previewUrl;
		if (typeof u === 'string' && u.startsWith('blob:')) {
			try {
				URL.revokeObjectURL(u);
			} catch {
				// ignore
			}
		}
	}

	function syncChatAttachmentsVisibility() {
		const attWrap = root.querySelector('[data-chat-attachments]');
		const inlineBtn = root.querySelector('[data-chat-add-image-inline]');
		const inp = root.querySelector('[data-chat-body-input]');
		const pseudo = Boolean(activePseudoChannelSlug);
		const inpDisabled = inp instanceof HTMLTextAreaElement && inp.disabled;
		const tid = activeThreadId;
		const noThread =
			tid == null || !Number.isFinite(Number(tid)) || Number(tid) <= 0;
		if (attWrap instanceof HTMLElement) {
			attWrap.hidden = pseudo || chatPendingImages.length === 0;
			attWrap.classList.toggle('chat-page-composer-attachments--has-media', chatPendingImages.length > 0);
		}
		if (inlineBtn instanceof HTMLElement) {
			inlineBtn.hidden = pseudo || inpDisabled || noThread;
		}
	}

	function clearChatPendingAttachments(opts = {}) {
		const skipServer = opts.skipServerDelete === true;
		const urlsToDelete = skipServer
			? []
			: chatPendingImages
					.filter((e) => e.status === 'ready' && e.urlPath)
					.map((e) => e.urlPath);
		for (const e of chatPendingImages) {
			revokeChatAttachmentPreview(e);
		}
		chatPendingImages = [];
		renderChatAttachmentStrip();
		syncChatSendButton();
		if (!skipServer) {
			for (const u of urlsToDelete) {
				void deleteChatMiscGenericOnServer(u);
			}
		}
	}

	function renderChatAttachmentStrip() {
		const list = root.querySelector('[data-chat-attachments-list]');
		if (!list) return;
		list.replaceChildren();
		for (const item of chatPendingImages) {
			const card = document.createElement('div');
			card.className = 'chat-page-composer-attachment';
			if (item.status === 'error') {
				card.classList.add('chat-page-composer-attachment--error');
			}
			card.dataset.chatAttachmentId = item.id;

			const img = document.createElement('img');
			img.className = 'chat-page-composer-attachment-preview';
			img.alt = '';
			if (item.status === 'ready' && item.urlPath) {
				img.src = item.urlPath;
			} else if (item.previewUrl) {
				img.src = item.previewUrl;
			}
			card.appendChild(img);

			if (item.status === 'uploading') {
				const ov = document.createElement('div');
				ov.className = 'chat-page-composer-attachment-uploading';
				const sp = document.createElement('div');
				sp.className = 'chat-page-composer-attachment-spinner';
				ov.appendChild(sp);
				card.appendChild(ov);
			} else if (item.status === 'error') {
				const errEl = document.createElement('div');
				errEl.className = 'chat-page-composer-attachment-error';
				errEl.textContent = 'Failed';
				errEl.title = item.errorMessage || '';
				card.appendChild(errEl);
			}

			const rm = document.createElement('button');
			rm.type = 'button';
			rm.className = 'chat-page-composer-attachment-remove';
			rm.setAttribute('aria-label', 'Remove image');
			rm.textContent = '×';
			rm.addEventListener('click', () => void removeChatAttachment(item.id));
			card.appendChild(rm);

			list.appendChild(card);
		}
		syncChatAttachmentsVisibility();
	}

	async function removeChatAttachment(id) {
		const idx = chatPendingImages.findIndex((e) => e.id === id);
		if (idx < 0) return;
		const entry = chatPendingImages[idx];
		const urlToRemove = entry.status === 'ready' && entry.urlPath ? entry.urlPath : null;
		revokeChatAttachmentPreview(entry);
		chatPendingImages.splice(idx, 1);
		renderChatAttachmentStrip();
		syncChatSendButton();
		if (urlToRemove) {
			await deleteChatMiscGenericOnServer(urlToRemove);
		}
	}

	async function addChatImageFiles(fileList) {
		if (!activeThreadId || activePseudoChannelSlug || sendInFlight) return;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (bodyInput instanceof HTMLTextAreaElement && bodyInput.disabled) return;
		const arr = Array.from(fileList || []).filter(
			(f) => f instanceof File && typeof f.type === 'string' && f.type.startsWith('image/')
		);
		if (arr.length === 0) return;

		const errStrip = root.querySelector('[data-chat-error]');
		if (errStrip instanceof HTMLElement) {
			errStrip.hidden = true;
			errStrip.textContent = '';
		}

		let mod;
		try {
			mod = await import(`../shared/createSubmit.js${qs}`);
		} catch (err) {
			console.error('[Chat page] image module:', err);
			if (errStrip instanceof HTMLElement) {
				errStrip.hidden = false;
				errStrip.textContent = 'Could not load image upload.';
			}
			return;
		}

		for (const file of arr) {
			const id =
				typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const previewUrl = URL.createObjectURL(file);
			chatPendingImages.push({
				id,
				previewUrl,
				status: 'uploading',
				file
			});
			renderChatAttachmentStrip();
			syncChatSendButton();

			void (async () => {
				try {
					const urlPath = await mod.uploadImageFile(file, { uploadKind: 'generic' });
					const path = String(urlPath || '').trim();
					if (!path) throw new Error('Upload returned no URL');
					const ent = chatPendingImages.find((e) => e.id === id);
					if (!ent) {
						void deleteChatMiscGenericOnServer(path);
						return;
					}
					revokeChatAttachmentPreview(ent);
					ent.previewUrl = '';
					ent.urlPath = path;
					ent.status = 'ready';
					renderChatAttachmentStrip();
					syncChatSendButton();
				} catch (err) {
					console.error('[Chat page] image upload:', err);
					const ent = chatPendingImages.find((e) => e.id === id);
					if (!ent) return;
					ent.status = 'error';
					ent.errorMessage = err?.message || 'Upload failed';
					renderChatAttachmentStrip();
					syncChatSendButton();
				}
			})();
		}
	}

	function syncChatSendButton() {
		const sendBtn = root.querySelector('[data-chat-send]');
		const inp = root.querySelector('[data-chat-body-input]');
		if (!(sendBtn instanceof HTMLButtonElement) || !(inp instanceof HTMLTextAreaElement)) return;
		if (activePseudoChannelSlug) {
			sendBtn.hidden = true;
			sendBtn.disabled = false;
			return;
		}
		const textLen = String(inp.value || '').trim().length;
		const readyCount = chatPendingImages.filter((x) => x.status === 'ready' && x.urlPath).length;
		const hasOutgoing = textLen > 0 || readyCount > 0;
		const uploading = chatPendingImages.some((x) => x.status === 'uploading');
		sendBtn.hidden = !hasOutgoing;
		sendBtn.disabled = uploading || sendInFlight;
	}

	function applyComposerState() {
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const hint = root.querySelector('[data-chat-pseudo-composer-hint]');
		const shell = root.querySelector('[data-chat-composer] .chat-page-input-shell');
		const composerForm = root.querySelector('[data-chat-composer]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;

		if (activePseudoChannelSlug === 'comments') {
			clearChatPendingAttachments();
			bodyInput.disabled = true;
			bodyInput.value = '';
			bodyInput.placeholder = '';
			bodyInput.hidden = true;
			if (shell instanceof HTMLElement) shell.hidden = true;
			if (hint instanceof HTMLElement) {
				hint.hidden = false;
				hint.textContent =
					'Click a comment above to open its creation — you can comment and react there.';
			}
			if (composerForm instanceof HTMLFormElement) {
				composerForm.setAttribute('aria-label', 'Comments channel');
			}
		} else {
			bodyInput.hidden = false;
			if (shell instanceof HTMLElement) shell.hidden = false;
			if (hint instanceof HTMLElement) hint.hidden = true;
			if (activePseudoChannelSlug) {
				clearChatPendingAttachments();
				bodyInput.disabled = true;
				bodyInput.placeholder = 'Replies are on each creation page.';
				bodyInput.value = '';
			} else {
				bodyInput.disabled = false;
				bodyInput.placeholder = 'Message…';
			}
			if (composerForm instanceof HTMLFormElement) {
				composerForm.setAttribute('aria-label', 'Send a message');
			}
		}
		syncChatAttachmentsVisibility();
		syncChatSendButton();
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
		normalizeChatBubbleInlineImageSpacing(bubble);
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
		const sameSenderAsPrev = isOptimisticChatGroupContinue(last, vid);
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
	 * When the visual viewport changes (keyboard, URL bar, rotate), sync --chat-vh on
	 * documentElement so html height matches the visible viewport (avoids layout vs visual
	 * mismatch on mobile) and re-pin the message list if the user was already stuck to the
	 * bottom. Pixel `style.height` on html caused worse clipping; CSS variables are fine.
	 */
	function applyChatRootHeightFromVisualViewport() {
		const el = document.documentElement;
		if (!el.classList.contains('chat-page')) return;
		const vv = window.visualViewport;
		const ih =
			typeof window.innerHeight === 'number' && Number.isFinite(window.innerHeight)
				? window.innerHeight
				: 0;
		let h = 0;
		if (vv && typeof vv.height === 'number' && Number.isFinite(vv.height) && vv.height > 0) {
			/* iOS: innerHeight and visualViewport.height can disagree across keyboard frames; the
			 * smaller value matches the area above the keyboard and avoids a tall layout with a
			 * blank band between the thread and the composer. */
			h = ih > 0 ? Math.min(vv.height, ih) : vv.height;
		} else if (ih > 0) {
			h = ih;
		}
		if (h > 0) {
			el.style.setProperty('--chat-vh', `${h}px`);
		} else {
			el.style.removeProperty('--chat-vh');
		}
	}

	function clearChatViewportRetryTimeouts() {
		for (const id of chatViewportRetryTimeouts) {
			clearTimeout(id);
		}
		chatViewportRetryTimeouts = [];
	}

	function scheduleChatViewportHeightRetries() {
		clearChatViewportRetryTimeouts();
		const nudge = () => nudgeChatScrollIfStuckToBottom();
		const delays = [0, 50, 120, 220, 400];
		for (const ms of delays) {
			const id = setTimeout(() => {
				applyChatRootHeightFromVisualViewport();
				nudge();
			}, ms);
			chatViewportRetryTimeouts.push(id);
		}
	}

	function setupChatViewportSync() {
		teardownChatViewportSync();
		const nudge = () => nudgeChatScrollIfStuckToBottom();
		const onViewport = () => {
			applyChatRootHeightFromVisualViewport();
			nudge();
		};
		const onComposerFocusViewport = (ev) => {
			const inp = root.querySelector('[data-chat-body-input]');
			if (!(inp instanceof HTMLElement) || ev.target !== inp) return;
			scheduleChatViewportHeightRetries();
		};
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', onViewport);
			window.visualViewport.addEventListener('scroll', onViewport);
		}
		window.addEventListener('resize', onViewport);
		window.addEventListener('orientationchange', onViewport);
		root.addEventListener('focusin', onComposerFocusViewport);
		root.addEventListener('focusout', onComposerFocusViewport);
		applyChatRootHeightFromVisualViewport();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				applyChatRootHeightFromVisualViewport();
				nudge();
			});
		});
		chatViewportCleanup = () => {
			clearChatViewportRetryTimeouts();
			try {
				document.documentElement.style.removeProperty('--chat-vh');
			} catch {
				// ignore
			}
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', onViewport);
				window.visualViewport.removeEventListener('scroll', onViewport);
			}
			window.removeEventListener('resize', onViewport);
			window.removeEventListener('orientationchange', onViewport);
			root.removeEventListener('focusin', onComposerFocusViewport);
			root.removeEventListener('focusout', onComposerFocusViewport);
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

	const CHAT_HOVER_QUICK_REACTION_KEYS = REACTION_ORDER.slice(0, 3);

	function buildChatMessageHoverBarElement(m, viewerId, rowOpts) {
		const messageId = m?.id != null ? Number(m.id) : null;
		if (!Number.isFinite(messageId) || messageId <= 0) return null;

		const bar = document.createElement('div');
		bar.className = 'connect-chat-msg-hover-bar';
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', 'Message actions');

		const quick = document.createElement('div');
		quick.className = 'connect-chat-msg-hover-bar-quick';
		const viewerReactions = Array.isArray(m?.viewer_reactions) ? m.viewer_reactions : [];

		for (const key of CHAT_HOVER_QUICK_REACTION_KEYS) {
			const iconFn = REACTION_ICONS[key];
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'connect-chat-msg-hover-react';
			btn.dataset.emojiKey = key;
			btn.dataset.chatMessageId = String(messageId);
			btn.setAttribute('aria-label', `React with ${key}`);
			btn.innerHTML = iconFn ? iconFn('connect-chat-msg-hover-react-icon') : '';
			if (viewerReactions.includes(key)) btn.classList.add('is-viewer');
			quick.appendChild(btn);
		}

		const addBtn = document.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'connect-chat-msg-hover-add-react';
		addBtn.dataset.chatMessageId = String(messageId);
		addBtn.setAttribute('aria-label', 'Add reaction');
		addBtn.innerHTML = `<span class="comment-reaction-icon-wrap" aria-hidden="true">${smileIcon('connect-chat-hover-add-react-icon')}</span>`;

		const sep = document.createElement('span');
		sep.className = 'connect-chat-msg-hover-sep';
		sep.setAttribute('aria-hidden', 'true');

		const actions = document.createElement('div');
		actions.className = 'connect-chat-msg-hover-actions';

		const copyBtn = document.createElement('button');
		copyBtn.type = 'button';
		copyBtn.className = 'connect-chat-msg-hover-copy';
		copyBtn.setAttribute('data-chat-hover-copy', '1');
		copyBtn.dataset.chatMessageId = String(messageId);
		copyBtn.setAttribute('aria-label', 'Copy message text');
		copyBtn.innerHTML = copyIcon('connect-chat-hover-copy-icon');

		actions.appendChild(copyBtn);

		const senderId = Number(m.sender_id);
		const isSelf = Number.isFinite(viewerId) && Number.isFinite(senderId) && senderId === viewerId;
		const canDelete = isSelf || rowOpts.showAdminDelete === true;
		if (canDelete) {
			const delBtn = document.createElement('button');
			delBtn.type = 'button';
			delBtn.className = 'connect-chat-msg-hover-delete';
			delBtn.setAttribute('data-chat-hover-delete', '1');
			delBtn.dataset.chatMessageId = String(messageId);
			delBtn.setAttribute(
				'aria-label',
				isSelf ? 'Delete your message' : 'Delete message (moderator)'
			);
			delBtn.innerHTML = trashIcon('connect-chat-hover-delete-icon');
			actions.appendChild(delBtn);
		}

		bar.appendChild(quick);
		bar.appendChild(addBtn);
		bar.appendChild(sep);
		bar.appendChild(actions);
		return bar;
	}

	function updateChatHoverBarReactionState(messageId, m) {
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) return;
		const row = root.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (!row) return;
		const viewerReactions = Array.isArray(m?.viewer_reactions) ? m.viewer_reactions : [];
		for (const btn of row.querySelectorAll('.connect-chat-msg-hover-react[data-emoji-key]')) {
			if (!(btn instanceof HTMLButtonElement)) continue;
			const k = btn.dataset.emojiKey;
			if (!k) continue;
			btn.classList.toggle('is-viewer', viewerReactions.includes(k));
		}
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
		updateChatHoverBarReactionState(mid, m);
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

	function closeChatInlineImageLightbox() {
		if (typeof chatInlineImageLightboxKeydown === 'function') {
			document.removeEventListener('keydown', chatInlineImageLightboxKeydown);
			chatInlineImageLightboxKeydown = null;
		}
		if (chatInlineImageLightboxEl?.parentNode) {
			chatInlineImageLightboxEl.parentNode.removeChild(chatInlineImageLightboxEl);
		}
		chatInlineImageLightboxEl = null;
	}

	function openChatInlineImageLightbox(src) {
		const url = String(src || '').trim();
		if (!url) return;
		closeReactionPicker();
		closeChatInlineImageLightbox();

		const overlay = document.createElement('div');
		overlay.className = 'chat-inline-image-lightbox';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Image');

		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'chat-inline-image-lightbox-close';
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.textContent = '×';

		const frame = document.createElement('div');
		frame.className = 'chat-inline-image-lightbox-frame';

		const imgEl = document.createElement('img');
		imgEl.className = 'chat-inline-image-lightbox-img';
		imgEl.src = url;
		imgEl.alt = '';

		frame.appendChild(imgEl);
		overlay.appendChild(closeBtn);
		overlay.appendChild(frame);

		chatInlineImageLightboxKeydown = (e) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			closeChatInlineImageLightbox();
		};
		document.addEventListener('keydown', chatInlineImageLightboxKeydown);

		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeChatInlineImageLightbox();
		});
		closeBtn.addEventListener('click', () => closeChatInlineImageLightbox());

		document.body.appendChild(overlay);
		chatInlineImageLightboxEl = overlay;
		requestAnimationFrame(() => {
			try {
				closeBtn.focus({ preventScroll: true });
			} catch {
				closeBtn.focus();
			}
		});
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
			chatViewerIsAdmin = cached.viewerIsAdmin === true;
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
		chatViewerIsAdmin = Boolean(result.data?.viewer_is_admin);
		if (chatViewerId != null && Number.isFinite(chatViewerId)) {
			try {
				writeCachedChatThreads?.(chatViewerId, chatThreads, {
					viewerIsAdmin: chatViewerIsAdmin
				});
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
				name: typeof s.name === 'string' ? s.name.trim() : '',
				can_manage: Boolean(s.can_manage)
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
		const svEl = sidebar.querySelector('[data-chat-sidebar-servers]');
		if (!chEl || !dmEl || !svEl) return;

		// Phase 1: fast paint from cache (no extra fetches) if we have nothing rendered yet.
		if (!skipThreads && (chatThreads || []).length === 0) {
			try {
				await loadChatThreads({ allowCache: true, forceNetwork: false });
			} catch {
				// ignore: we'll handle on the network attempt below
			}
		}

		const deps = { renderCommentAvatarHtml, getAvatarColor };
		/**
		 * Same roster as Connect: merge threads + joined-server channel stubs, then split into
		 * sections for layout only (DMs / server-linked channels / other channels).
		 */
		const render = (threads, joined, onlineIds) => {
			const threadsArr = Array.isArray(threads) ? threads : [];
			const joinedArr = Array.isArray(joined) ? joined : [];
			const merged = rosterMod.appendReservedPseudoChannels(
				rosterMod.mergeThreadRowsWithJoinedServers(threadsArr, joinedArr)
			);
			const joinedSorted = [...joinedArr].sort((a, b) => Number(a.id) - Number(b.id));
			const joinedSlugs = new Set();
			for (const s of joinedSorted) {
				const tag = serverChannelTagFromServerName(
					typeof s?.name === 'string' ? s.name : ''
				);
				if (tag) joinedSlugs.add(tag.toLowerCase());
			}
			const dms = merged.filter((t) => t && t.type === 'dm');
			const channelRows = merged.filter((t) => t && t.type === 'channel');
			const serverChannels = channelRows.filter((t) => {
				const slug =
					typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
				return Boolean(slug && joinedSlugs.has(slug));
			});
			const otherChannels = channelRows.filter((t) => {
				const slug =
					typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
				return !slug || !joinedSlugs.has(slug);
			});

			function joinedServerMetaForSlug(slug) {
				const key = String(slug || '').trim().toLowerCase();
				if (!key) return null;
				for (const s of joinedSorted) {
					const tag = serverChannelTagFromServerName(
						typeof s?.name === 'string' ? s.name : ''
					);
					if (tag && tag.toLowerCase() === key) return s;
				}
				return null;
			}

			function rowHtml(t) {
				const href = rosterMod.buildChatThreadUrl(t);
				const active = isChatHrefActive(href);
				const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
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
					</div>
				</a>`;
			}

			function serverRowHtml(t) {
				const href = rosterMod.buildChatThreadUrl(t);
				const active = isChatHrefActive(href);
				const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
				const avatarHtml = rosterMod.buildChatThreadRowAvatarHtml(t, deps);
				const activeClass = active ? ' is-active' : '';
				const unc = Number(t.unread_count);
				const showUnread =
					!active && Number.isFinite(unc) && unc > 0;
				const unreadLabel = unc > 99 ? '99+' : String(unc);
				const unreadHtml = showUnread
					? `<span class="chat-page-sidebar-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>`
					: '';
				const slug =
					typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
				const meta = joinedServerMetaForSlug(slug);
				const gearHtml =
					meta && Number.isFinite(Number(meta.id)) && Number(meta.id) > 0
						? `<button type="button" class="chat-page-sidebar-server-settings" data-chat-server-settings="${Number(meta.id)}" data-chat-server-can-manage="${meta.can_manage ? '1' : '0'}" aria-label="Server details">${chatSidebarServerGearSvg}</button>`
						: '';
				return `<div class="chat-page-sidebar-row chat-page-sidebar-row--server${activeClass}">
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
			}

			dmEl.innerHTML = dms.length
				? dms.map(rowHtml).join('')
				: '<p class="chat-page-sidebar-empty">No direct messages yet.</p>';
			svEl.innerHTML = serverChannels.length
				? serverChannels.map(serverRowHtml).join('')
				: '<p class="chat-page-sidebar-empty">No servers joined yet.</p>';
			chEl.innerHTML = otherChannels.length
				? otherChannels.map(rowHtml).join('')
				: '<p class="chat-page-sidebar-empty">No channels yet.</p>';
		};

		/** Keep `.chat-page-sidebar-scroll` position stable when DMs / servers / channels lists re-render. */
		function runRender(threads, joined, onlineIds) {
			const scrollEl = sidebar.querySelector('.chat-page-sidebar-scroll');
			const prevTop = scrollEl ? scrollEl.scrollTop : 0;
			render(threads, joined, onlineIds);
			if (!scrollEl) return;
			requestAnimationFrame(() => {
				scrollEl.scrollTop = prevTop;
			});
		}

		// Do not paint the sidebar before `joined` is loaded. A render with `joined=[]` leaves
		// `joinedSlugs` empty, so every channel row is classified under “Channels” and “Servers”
		// shows the empty copy — then the next paint moves rows and only the server strip looks
		// broken. DMs don’t move because they never use `joinedSlugs`. One paint after awaits.

		if (skipThreads) {
			const [joined, onlineIds] = await Promise.all([
				fetchJoinedServersForChat(),
				fetchPresenceOnlineIds()
			]);
			runRender(chatThreads || [], joined, onlineIds);
			return;
		}

		try {
			const [_, joined, onlineIds] = await Promise.all([
				loadChatThreads({ allowCache: true, forceNetwork: true }),
				fetchJoinedServersForChat(),
				fetchPresenceOnlineIds()
			]);
			runRender(chatThreads || [], joined, onlineIds);
			dispatchChatUnreadRefresh();
		} catch {
			// If network fails, keep cached render.
		}
	}

	function setupChatSidebarClientNav() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;

		chatSidebarNavClickHandler = (e) => {
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
			const a = e.target?.closest?.('a.chat-page-sidebar-row, a.chat-page-sidebar-row-link');
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

	/** Plus buttons → section-specific modals (new DM, servers, channels). */
	async function setupChatSidebarSectionAdds() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;

		const mod = await import(`../components/modals/chatSidebarModals.js${qs}`);
		chatSidebarModalsApi = mod.initChatSidebarModals({
			getThreads: () => chatThreads || [],
			getViewerId: () => chatViewerId,
			navigateToChatPath: (pathname) => {
				const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
				history.pushState({ prsnChat: true }, '', path);
				void openThreadForCurrentPath().then(() => {
					void refreshChatSidebar({ skipThreadsFetch: true });
				});
			},
			refreshSidebar: () => void refreshChatSidebar({ skipThreadsFetch: true })
		});

		chatSidebarSectionAddHandler = (e) => {
			const btn = e.target?.closest?.('[data-chat-sidebar-add]');
			if (!(btn instanceof HTMLButtonElement)) return;
			const kind = btn.getAttribute('data-chat-sidebar-add');
			if (kind === 'dm') {
				chatSidebarModalsApi?.openDmModal?.();
				return;
			}
			if (kind === 'servers') {
				chatSidebarModalsApi?.openServersModal?.();
				return;
			}
			if (kind === 'channels') {
				chatSidebarModalsApi?.openChannelsModal?.();
				return;
			}
		};
		sidebar.addEventListener('click', chatSidebarSectionAddHandler);
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

	function mapCommentRowToChatMessageShape(c) {
		const uid = Number(c.user_id);
		return {
			id: Number(c.id),
			body: typeof c.text === 'string' ? c.text : '',
			sender_id: Number.isFinite(uid) ? uid : 0,
			sender_user_name: typeof c.user_name === 'string' ? c.user_name : '',
			sender_avatar_url: typeof c.avatar_url === 'string' ? c.avatar_url : '',
			created_at: c.created_at ?? null,
			reactions: c.reactions && typeof c.reactions === 'object' ? c.reactions : {},
			viewer_reactions: Array.isArray(c.viewer_reactions) ? c.viewer_reactions : [],
			comment: c,
		};
	}

	function updateChatLatestRowMarker(messagesEl) {
		if (!messagesEl) return;
		for (const el of messagesEl.querySelectorAll('.connect-chat-msg[data-chat-latest]')) {
			el.removeAttribute('data-chat-latest');
		}
		const rows = messagesEl.querySelectorAll('.connect-chat-msg');
		const last = rows[rows.length - 1];
		if (last) {
			last.setAttribute('data-chat-latest', '1');
		}
	}

	/** #comments channel: same Connect "latest comments" card (thumb, title, creators, text, reactions). */
	function createCommentsChannelPlainRow(m) {
		const raw = m?.comment;
		if (raw && typeof raw === 'object' && typeof createConnectCommentRowElement === 'function') {
			const row = createConnectCommentRowElement(raw, { extraRootClass: 'comments-channel-plain-msg' });
			row.setAttribute('data-comments-channel-row', '1');
			row.setAttribute('data-comment-id', String(m.id ?? ''));
			return row;
		}
		const row = document.createElement('div');
		row.className = 'comments-channel-plain-msg';
		row.setAttribute('data-comments-channel-row', '1');
		row.setAttribute('data-comment-id', String(m.id ?? ''));
		const body = document.createElement('div');
		body.className = 'comments-channel-plain-msg-body';
		body.textContent = typeof m.body === 'string' ? m.body : '';
		row.appendChild(body);
		return row;
	}

	function updateCommentsChannelLatestMarker(messagesEl) {
		if (!messagesEl) return;
		for (const el of messagesEl.querySelectorAll('[data-comments-channel-latest]')) {
			el.removeAttribute('data-comments-channel-latest');
		}
		const rows = messagesEl.querySelectorAll('[data-comments-channel-row]');
		const last = rows[rows.length - 1];
		if (last) {
			last.setAttribute('data-comments-channel-latest', '1');
		}
	}

	/**
	 * @param {HTMLElement | null} appendAfter
	 */
	function paintCommentsChannelPlainRows(messagesEl, messages, appendAfter = null) {
		if (!appendAfter) {
			messagesEl.innerHTML = '';
		}
		if (!Array.isArray(messages) || messages.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'chat-page-empty-hint';
			empty.setAttribute('role', 'status');
			empty.textContent = 'No comments yet.';
			if (appendAfter) {
				messagesEl.insertBefore(empty, appendAfter.nextSibling);
			} else {
				messagesEl.appendChild(empty);
			}
			return;
		}
		let ref = appendAfter;
		for (let i = 0; i < messages.length; i++) {
			const row = createCommentsChannelPlainRow(messages[i]);
			if (ref) {
				messagesEl.insertBefore(row, ref.nextSibling);
				ref = row;
			} else {
				messagesEl.appendChild(row);
			}
		}
		hydrateUserTextLinks(messagesEl);
		if (typeof setupReactionTooltipTap === 'function') {
			setupReactionTooltipTap(messagesEl);
		}
		updateCommentsChannelLatestMarker(messagesEl);
	}

	/**
	 * @param {object} m
	 * @param {number} i
	 * @param {object[]} messages
	 * @param {number | null} viewerId
	 * @param {{ effectiveUnread: boolean, vStart: number, vEnd: number, showAdminDelete?: boolean, showHoverBar?: boolean }} rowOpts
	 */
	function createChatMessageRowElement(m, i, messages, viewerId, rowOpts) {
		const senderId = Number(m.sender_id);
		const isSelf = Number.isFinite(viewerId) && senderId === viewerId;
		const prev = i > 0 ? messages[i - 1] : null;
		const isGroupContinue = isChatMessageGroupContinue(prev, m);
		const row = document.createElement('div');
		row.className = `connect-chat-msg${isSelf ? ' is-self' : ''}${isGroupContinue ? ' is-group-continue' : ''}`;
		row.setAttribute('data-chat-message-id', String(m.id));
		const effectiveUnread = rowOpts.effectiveUnread;
		const vStart = rowOpts.vStart;
		const vEnd = rowOpts.vEnd;
		const isUnread =
			effectiveUnread &&
			!isSelf &&
			i >= vStart &&
			i <= vEnd;
		if (isUnread) {
			row.classList.add('is-unread');
			const prevMsg = i > 0 ? messages[i - 1] : null;
			const nextMsg = i + 1 < messages.length ? messages[i + 1] : null;
			const prevSender = prevMsg?.sender_id != null ? Number(prevMsg.sender_id) : null;
			const nextSender = nextMsg?.sender_id != null ? Number(nextMsg.sender_id) : null;
			const prevIsSelf = Number.isFinite(viewerId) && prevSender === viewerId;
			const nextIsSelf = Number.isFinite(viewerId) && nextSender === viewerId;
			const prevUnread =
				effectiveUnread && !prevIsSelf && i - 1 >= vStart && i - 1 <= vEnd;
			const nextUnread =
				effectiveUnread && !nextIsSelf && i + 1 >= vStart && i + 1 <= vEnd;
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
		if (!messageHasAnyReactions(m)) {
			row.classList.add('connect-chat-msg--reaction-empty');
		}
		const inner = document.createElement('div');
		inner.className = 'connect-chat-msg-inner';
		const safeBody = processUserText(m.body ?? '');
		const bubble = document.createElement('div');
		bubble.className = 'connect-chat-msg-bubble';
		bubble.innerHTML = safeBody;
		normalizeChatBubbleInlineImageSpacing(bubble);
		if (!isGroupContinue) {
			const metaLine = document.createElement('div');
			metaLine.className = 'connect-chat-msg-meta';
			const handleRaw = m.sender_user_name != null ? String(m.sender_user_name).trim() : '';
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
		if (rowOpts.showHoverBar) {
			const hoverBar = buildChatMessageHoverBarElement(m, viewerId, rowOpts);
			if (hoverBar) row.appendChild(hoverBar);
		}
		return row;
	}

	/**
	 * Shared message list painting for real threads and reserved pseudo-channels (e.g. `comments`).
	 * @param {HTMLElement} messagesEl
	 * @param {object[]} messages
	 * @param {number | null} viewerId
	 * @param {number | null} threadId — for optimistic send row only
	 * @param {{ skipUnread?: boolean, visualStart?: number, visualEnd?: number, hasVisualUnreadRange?: boolean, emptyHintText?: string, showAdminDelete?: boolean, showHoverBar?: boolean }} paintOpts
	 * @param {HTMLElement | null} appendAfter — if set, `messagesEl` is not cleared; rows are inserted after this node (e.g. load-more sentinel).
	 */
	function paintMessageRowsForChat(messagesEl, messages, viewerId, threadId, paintOpts = {}, appendAfter = null) {
		const skipUnread = paintOpts.skipUnread === true;
		const visualStart = typeof paintOpts.visualStart === 'number' ? paintOpts.visualStart : -1;
		const visualEnd = typeof paintOpts.visualEnd === 'number' ? paintOpts.visualEnd : -1;
		const hasVisualUnreadRange = Boolean(paintOpts.hasVisualUnreadRange);
		const emptyHintText =
			typeof paintOpts.emptyHintText === 'string'
				? paintOpts.emptyHintText
				: 'No messages yet. Send one below.';
		const effectiveUnread = !skipUnread && hasVisualUnreadRange;
		const vStart = skipUnread ? -1 : visualStart;
		const vEnd = skipUnread ? -1 : visualEnd;

		if (!appendAfter) {
			messagesEl.innerHTML = '';
		}

		if (messages.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'chat-page-empty-hint';
			empty.setAttribute('role', 'status');
			empty.textContent = emptyHintText;
			if (appendAfter) {
				messagesEl.insertBefore(empty, appendAfter.nextSibling);
			} else {
				messagesEl.appendChild(empty);
			}
			return;
		}

		const rowFlags = {
			effectiveUnread,
			vStart,
			vEnd,
			showAdminDelete: paintOpts.showAdminDelete === true,
			showHoverBar: paintOpts.showHoverBar === true,
		};
		let ref = appendAfter;
		for (let i = 0; i < messages.length; i++) {
			const row = createChatMessageRowElement(messages[i], i, messages, viewerId, rowFlags);
			if (ref) {
				messagesEl.insertBefore(row, ref.nextSibling);
				ref = row;
			} else {
				messagesEl.appendChild(row);
			}
		}
		updateChatLatestRowMarker(messagesEl);

		if (
			threadId != null &&
			optimisticSend &&
			Number(optimisticSend.threadId) === threadId
		) {
			messagesEl.querySelector('.chat-page-empty-hint')?.remove();
			messagesEl.querySelector('[data-chat-latest="1"]')?.removeAttribute('data-chat-latest');
			const last = messages[messages.length - 1];
			const sameSenderAsPrev = isOptimisticChatGroupContinue(last, viewerId);
			mountOptimisticRow(messagesEl, optimisticSend, sameSenderAsPrev, viewerId);
		}
	}

	function disconnectCommentsChannelLoadObserver() {
		if (commentsChannelLoadMoreObserver) {
			try {
				commentsChannelLoadMoreObserver.disconnect();
			} catch {
				// ignore
			}
			commentsChannelLoadMoreObserver = null;
		}
	}

	function teardownCommentsChannelLoadMore() {
		commentsChannelHasMore = false;
		disconnectCommentsChannelLoadObserver();
	}

	function setupCommentsChannelLoadMoreObserver(messagesEl) {
		disconnectCommentsChannelLoadObserver();
		const sentinel = messagesEl.querySelector('[data-chat-comments-load-sentinel]');
		if (!sentinel) return;
		commentsChannelLoadMoreObserver = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (
						e.target === sentinel &&
						e.isIntersecting &&
						commentsChannelHasMore &&
						!commentsChannelLoadingMore &&
						!loadingMessages &&
						activePseudoChannelSlug === 'comments'
					) {
						void loadMoreCommentsChannelMessages();
					}
				}
			},
			/* Large top margin so the next page starts loading while the user is still well below the oldest row. */
			{ root: messagesEl, rootMargin: '1400px 0px 0px 0px', threshold: 0 }
		);
		commentsChannelLoadMoreObserver.observe(sentinel);
	}

	async function loadMoreCommentsChannelMessages() {
		if (
			activePseudoChannelSlug !== 'comments' ||
			commentsChannelLoadingMore ||
			!commentsChannelHasMore
		) {
			return;
		}
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || !Array.isArray(lastChatMessagesPayload) || lastChatMessagesPayload.length === 0) {
			return;
		}
		const oldest = lastChatMessagesPayload[0];
		const beforeRaw = oldest?.created_at;
		const before =
			typeof beforeRaw === 'string' && beforeRaw.trim()
				? beforeRaw.trim()
				: beforeRaw != null
					? String(beforeRaw)
					: '';
		if (!before) {
			return;
		}

		commentsChannelLoadingMore = true;
		const firstMsg = messagesEl.querySelector('[data-comments-channel-row]');

		function preserveScrollAfterPrepend(anchorTopBefore) {
			if (!firstMsg || !firstMsg.isConnected) return;
			const anchorTopAfter =
				firstMsg.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
			const d = anchorTopAfter - anchorTopBefore;
			if (Number.isFinite(d) && Math.abs(d) > 0.25) {
				messagesEl.scrollTop += d;
			}
		}

		try {
			const commentsMod = await import(`../shared/comments.js${qs}`);
			const result = await commentsMod.fetchLatestComments({
				limit: COMMENTS_CHANNEL_PAGE_SIZE,
				before,
			});
			if (!result.ok) {
				return;
			}
			commentsChannelHasMore = result.data?.has_more === true;
			const raw = Array.isArray(result.data?.comments) ? result.data.comments : [];
			const batch = raw.map(mapCommentRowToChatMessageShape).reverse();
			const existingIds = new Set(lastChatMessagesPayload.map((m) => Number(m.id)));
			const mergedFiltered = batch.filter((m) => Number.isFinite(Number(m.id)) && !existingIds.has(Number(m.id)));
			if (mergedFiltered.length === 0) {
				return;
			}

			const full = [...mergedFiltered, ...lastChatMessagesPayload];
			lastChatMessagesPayload = full;

			/** Snapshot immediately before mutating the list (not before the network round-trip). */
			let anchorTopBefore = 0;
			if (firstMsg) {
				anchorTopBefore =
					firstMsg.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
			}

			if (!firstMsg) {
				for (let i = 0; i < mergedFiltered.length; i++) {
					const row = createCommentsChannelPlainRow(full[i]);
					messagesEl.appendChild(row);
				}
			} else {
				for (let i = 0; i < mergedFiltered.length; i++) {
					const row = createCommentsChannelPlainRow(full[i]);
					messagesEl.insertBefore(row, firstMsg);
				}
			}

			hydrateUserTextLinks(messagesEl);
			if (typeof setupReactionTooltipTap === 'function') {
				setupReactionTooltipTap(messagesEl);
			}
			updateCommentsChannelLatestMarker(messagesEl);

			void messagesEl.offsetHeight;
			preserveScrollAfterPrepend(anchorTopBefore);
			requestAnimationFrame(() => {
				preserveScrollAfterPrepend(anchorTopBefore);
				requestAnimationFrame(() => {
					preserveScrollAfterPrepend(anchorTopBefore);
				});
			});
		} catch (err) {
			console.error('[Chat page] comments channel load more:', err);
		} finally {
			commentsChannelLoadingMore = false;
		}
	}

	async function loadCommentsChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || loadingMessages) return;
		loadingMessages = true;
		teardownCommentsChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			const commentsMod = await import(`../shared/comments.js${qs}`);
			const result = await commentsMod.fetchLatestComments({ limit: COMMENTS_CHANNEL_PAGE_SIZE });
			if (!result.ok) {
				const msg =
					result.data?.message ||
					result.data?.error ||
					'Failed to load comments';
				throw new Error(typeof msg === 'string' ? msg : 'Failed to load comments');
			}
			commentsChannelHasMore = result.data?.has_more === true;
			const raw = Array.isArray(result.data?.comments) ? result.data.comments : [];
			// Latest-comments API is newest-first; chat threads show oldest at the top.
			const messages = raw.map(mapCommentRowToChatMessageShape).reverse();
			lastChatMessagesPayload = messages;
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';
			const sentinel = document.createElement('div');
			sentinel.dataset.chatCommentsLoadSentinel = '1';
			sentinel.className = 'chat-page-comments-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			messagesEl.appendChild(sentinel);
			paintCommentsChannelPlainRows(messagesEl, messages, sentinel);
			if (commentsChannelHasMore) {
				setupCommentsChannelLoadMoreObserver(messagesEl);
			}
			scrollChatMessagesToEnd();
		} catch (err) {
			console.error('[Chat page] comments channel:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load comments.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
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
				const prevSender = prev?.sender_id != null ? Number(prev.sender_id) : null;
				const prevIsSelf = Number.isFinite(viewerId) && Number.isFinite(prevSender) && prevSender === viewerId;
				if (isChatMessageGroupContinue(prev, first) && !prevIsSelf) {
					// Include the meta-bearing row (the previous message in the run).
					visualStart = visualStart - 1;
				}
			}
			const hasVisualUnreadRange = visualStart >= 0 && visualEnd >= visualStart;

			paintMessageRowsForChat(messagesEl, messages, viewerId, threadId, {
				skipUnread: false,
				visualStart,
				visualEnd,
				hasVisualUnreadRange,
				showAdminDelete: chatViewerIsAdmin && !activePseudoChannelSlug,
				showHoverBar: !activePseudoChannelSlug,
			});
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
				onReconnect: refetch,
				onDeleted: () => {
					window.location.href = '/connect#chat';
				}
			});
		} catch (err) {
			console.warn('[Chat page] realtime:', err);
		}
	}

	function closeChatMessageToolbar() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		for (const r of messagesEl.querySelectorAll('.connect-chat-msg--toolbar-open')) {
			r.classList.remove('connect-chat-msg--toolbar-open');
		}
	}

	async function deleteChatMessage(messageId) {
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) return;
		if (!window.confirm('Delete this message permanently? This cannot be undone.')) {
			return;
		}
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;

		const idx = lastChatMessagesPayload.findIndex((m) => Number(m.id) === mid);
		if (idx < 0) return;
		const msgSnapshot = lastChatMessagesPayload[idx];

		const row = messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (!row) return;

		const insertBefore = row.nextElementSibling;
		const rowRestored = row.cloneNode(true);
		closeChatMessageToolbar();

		row.remove();
		lastChatMessagesPayload = lastChatMessagesPayload.filter((m) => Number(m.id) !== mid);
		updateChatLatestRowMarker(messagesEl);
		dispatchChatUnreadRefresh();

		try {
			const res = await fetch(`/api/chat/messages/${mid}`, {
				method: 'DELETE',
				credentials: 'include',
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Could not delete message');
			}
		} catch (err) {
			console.error('[Chat page] delete message:', err);
			lastChatMessagesPayload = [
				...lastChatMessagesPayload.slice(0, idx),
				msgSnapshot,
				...lastChatMessagesPayload.slice(idx),
			];
			if (insertBefore && insertBefore.parentNode === messagesEl) {
				messagesEl.insertBefore(rowRestored, insertBefore);
			} else {
				messagesEl.appendChild(rowRestored);
			}
			updateChatLatestRowMarker(messagesEl);
			dispatchChatUnreadRefresh();
			try {
				hydrateUserTextLinks(rowRestored);
				hydrateChatYoutubeEmbeds(rowRestored);
				hydrateChatCreationEmbeds(rowRestored);
			} catch {
				// ignore
			}
			for (const b of rowRestored.querySelectorAll('.connect-chat-msg-bubble')) {
				trimTrailingWhitespaceAfterChatEmbed(b);
			}
			for (const embed of rowRestored.querySelectorAll('.connect-chat-creation-embed')) {
				trimChatCreationEmbedWhitespace(embed);
			}
			alert(err?.message || 'Could not delete message.');
		}
	}

	function onChatMessagesClick(e) {
		const inHoverBar = e.target?.closest?.('.connect-chat-msg-hover-bar');
		if (inHoverBar) {
			e.stopPropagation();
		}

		const copyBtn = e.target?.closest?.('[data-chat-hover-copy]');
		if (copyBtn instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(copyBtn.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			const msg = lastChatMessagesPayload.find((x) => Number(x.id) === messageId);
			const text = msg?.body != null ? String(msg.body) : '';
			void (async () => {
				try {
					if (navigator.clipboard?.writeText) {
						await navigator.clipboard.writeText(text);
					} else {
						throw new Error('no clipboard');
					}
				} catch {
					try {
						const ta = document.createElement('textarea');
						ta.value = text;
						ta.setAttribute('readonly', '');
						ta.style.position = 'fixed';
						ta.style.left = '-9999px';
						document.body.appendChild(ta);
						ta.select();
						document.execCommand('copy');
						ta.remove();
					} catch {
						// ignore
					}
				}
			})();
			return;
		}

		const delHover = e.target?.closest?.('[data-chat-hover-delete]');
		if (delHover instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(delHover.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			void deleteChatMessage(messageId);
			return;
		}

		const hoverReact = e.target?.closest?.('.connect-chat-msg-hover-react[data-emoji-key]');
		if (hoverReact instanceof HTMLButtonElement) {
			if (activePseudoChannelSlug) {
				e.preventDefault();
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(hoverReact.dataset.chatMessageId);
			const emojiKey = hoverReact.dataset.emojiKey;
			if (!Number.isFinite(messageId) || !emojiKey) return;
			void toggleChatMessageReaction(messageId, emojiKey).then((res) => {
				if (res?.ok) applyChatReactionAfterToggle(messageId, emojiKey, res.data);
			});
			return;
		}

		const hoverAddReact = e.target?.closest?.('.connect-chat-msg-hover-add-react');
		if (hoverAddReact instanceof HTMLButtonElement) {
			if (activePseudoChannelSlug) {
				e.preventDefault();
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(hoverAddReact.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			const msg = lastChatMessagesPayload.find((x) => Number(x.id) === messageId);
			const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
			const unusedKeys = REACTION_ORDER.filter((key) => chatReactionGetCount(reactions[key]) === 0);
			if (unusedKeys.length === 0) return;
			showReactionPicker(hoverAddReact, messageId, unusedKeys, (mid, ek) => {
				void toggleChatMessageReaction(mid, ek).then((res) => {
					if (res?.ok) applyChatReactionAfterToggle(mid, ek, res.data);
				});
			});
			return;
		}

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
			if (activePseudoChannelSlug) {
				e.preventDefault();
				return;
			}
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
			if (activePseudoChannelSlug) {
				e.preventDefault();
				return;
			}
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
			if (activePseudoChannelSlug) {
				return;
			}
			const messageId = Number(msgRow.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			e.preventDefault();
			const wasOpen = msgRow.classList.contains('connect-chat-msg--toolbar-open');
			const messagesEl = root.querySelector('[data-chat-messages]');
			if (messagesEl) {
				for (const r of messagesEl.querySelectorAll('.connect-chat-msg--toolbar-open')) {
					r.classList.remove('connect-chat-msg--toolbar-open');
				}
			}
			if (!wasOpen) {
				msgRow.classList.add('connect-chat-msg--toolbar-open');
			}
		}
	}

	/**
	 * @param {string} trimmedBody
	 * @param {{ clearInput?: boolean }} [opts]
	 */
	async function sendChatOutgoing(trimmedBody, opts = {}) {
		const clearInput = opts.clearInput === true;
		const threadId = activeThreadId;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !(bodyInput instanceof HTMLTextAreaElement) || !messagesEl) return;
		if (sendInFlight) return;

		const text = String(trimmedBody || '').trim();
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

		if (clearInput) {
			bodyInput.value = '';
			syncChatSendButton();
		}

		optimisticSend = { tempId, body: text, threadId, status: 'pending' };
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

	async function submitChatMessage() {
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;
		if (chatPendingImages.some((x) => x.status === 'uploading')) return;
		const text = String(bodyInput.value || '').trim();
		const paths = chatPendingImages
			.filter((x) => x.status === 'ready' && x.urlPath)
			.map((x) => x.urlPath);
		if (!text && paths.length === 0) return;

		let body = paths.join('\n');
		if (text) {
			/* Space (no `\n`): `pre-wrap` makes a newline after the image span a full line box. */
			body = paths.length > 0 ? `${body} ${text}` : text;
		}
		if (body.length > CHAT_MAX_BODY_CHARS) {
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = `Message is too long (max ${CHAT_MAX_BODY_CHARS} characters).`;
			}
			return;
		}
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}
		clearChatPendingAttachments({ skipServerDelete: true });
		await sendChatOutgoing(body, { clearInput: true });
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
		clearChatPendingAttachments();
		activePseudoChannelSlug = null;
		teardownCommentsChannelLoadMore();

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
				if (slug === 'comments') {
					activePseudoChannelSlug = 'comments';
					activeThreadId = null;
					updateTitleFromMeta({
						type: 'channel',
						channel_slug: 'comments',
						title: '#comments',
					});
					if (messagesEl) {
						messagesEl.removeAttribute('aria-busy');
					}
					await loadCommentsChannelMessages();
					return;
				}
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
		} finally {
			applyComposerState();
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
	const fileInput = root.querySelector('[data-chat-file-input]');
	const addImageInlineBtn = root.querySelector('[data-chat-add-image-inline]');
	function triggerChatImageFilePicker() {
		if (activePseudoChannelSlug || !activeThreadId) return;
		if (bodyInput instanceof HTMLTextAreaElement && bodyInput.disabled) return;
		if (!(fileInput instanceof HTMLInputElement)) return;
		fileInput.value = '';
		fileInput.click();
	}
	if (fileInput instanceof HTMLInputElement) {
		fileInput.addEventListener('change', () => {
			const files = fileInput.files;
			if (!files || files.length === 0) return;
			void addChatImageFiles(files);
			fileInput.value = '';
		});
	}
	if (addImageInlineBtn instanceof HTMLButtonElement) {
		addImageInlineBtn.addEventListener('click', triggerChatImageFilePicker);
	}

	if (bodyInput instanceof HTMLTextAreaElement) {
		attachAutoGrowTextarea(bodyInput);
		attachMentionSuggest(bodyInput);
		bodyInput.addEventListener('input', () => syncChatSendButton());
		bodyInput.addEventListener('paste', (ev) => {
			if (activePseudoChannelSlug || !activeThreadId || bodyInput.disabled) return;
			if (sendInFlight) return;
			const cd = ev.clipboardData;
			if (!cd) return;
			const imageFiles = [];
			for (const it of cd.items || []) {
				if (it.kind !== 'file') continue;
				const f = it.getAsFile();
				if (f && typeof f.type === 'string' && f.type.startsWith('image/')) {
					imageFiles.push(f);
				}
			}
			if (imageFiles.length === 0 && cd.files && cd.files.length > 0) {
				for (const f of cd.files) {
					if (f && typeof f.type === 'string' && f.type.startsWith('image/')) {
						imageFiles.push(f);
					}
				}
			}
			if (imageFiles.length === 0) return;
			ev.preventDefault();
			void addChatImageFiles(imageFiles);
		});
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
		teardownCommentsChannelLoadMore();
		tearDownVisibilityResync();
		tearDownRoomBroadcast();
		closeReactionPicker();
		closeChatInlineImageLightbox();
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
		if (sidebarNav && typeof chatSidebarSectionAddHandler === 'function') {
			sidebarNav.removeEventListener('click', chatSidebarSectionAddHandler);
			chatSidebarSectionAddHandler = null;
		}
		try {
			chatSidebarModalsApi?.closeAll?.();
		} catch {
			// ignore
		}
		chatSidebarModalsApi = null;
		if (typeof chatSidebarPopstateHandler === 'function') {
			window.removeEventListener('popstate', chatSidebarPopstateHandler);
			chatSidebarPopstateHandler = null;
		}
		if (typeof chatSidebarVisibilityHandler === 'function') {
			document.removeEventListener('visibilitychange', chatSidebarVisibilityHandler);
			chatSidebarVisibilityHandler = null;
		}
		if (typeof chatToolbarOutsidePointerHandler === 'function') {
			document.removeEventListener('pointerdown', chatToolbarOutsidePointerHandler, true);
			chatToolbarOutsidePointerHandler = null;
		}
		const messagesElTeardown = root.querySelector('[data-chat-messages]');
		if (
			messagesElTeardown &&
			typeof chatToolbarUnpinOnOtherRowHover === 'function'
		) {
			messagesElTeardown.removeEventListener('mouseover', chatToolbarUnpinOnOtherRowHover);
			chatToolbarUnpinOnOtherRowHover = null;
		}
		if (typeof chatInlineImageLightboxClickHandler === 'function') {
			root.removeEventListener('click', chatInlineImageLightboxClickHandler);
			chatInlineImageLightboxClickHandler = null;
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

		chatToolbarUnpinOnOtherRowHover = (e) => {
			if (activePseudoChannelSlug) return;
			if (!(messagesContainerForReactions instanceof HTMLElement)) return;
			if (!messagesContainerForReactions.contains(e.target)) return;
			const pinned = messagesContainerForReactions.querySelectorAll('.connect-chat-msg--toolbar-open');
			if (pinned.length === 0) return;
			const row = e.target.closest?.('.connect-chat-msg[data-chat-message-id]');
			if (!row || !messagesContainerForReactions.contains(row)) return;
			for (const p of pinned) {
				if (p !== row) p.classList.remove('connect-chat-msg--toolbar-open');
			}
		};
		messagesContainerForReactions.addEventListener('mouseover', chatToolbarUnpinOnOtherRowHover);
	}

	chatInlineImageLightboxClickHandler = (e) => {
		const a = e.target?.closest?.('a.user-text-inline-image-link');
		if (!(a instanceof HTMLAnchorElement)) return;
		if (!a.closest('.connect-chat-msg-bubble')) return;
		if (!root.contains(a)) return;
		e.preventDefault();
		e.stopPropagation();
		const thumb = a.querySelector('img.user-text-inline-image');
		let src = '';
		if (thumb instanceof HTMLImageElement) {
			src = thumb.currentSrc || thumb.getAttribute('src') || '';
		}
		if (!src) src = a.getAttribute('href') || '';
		openChatInlineImageLightbox(src);
	};
	root.addEventListener('click', chatInlineImageLightboxClickHandler);

	chatToolbarOutsidePointerHandler = (e) => {
		if (activePseudoChannelSlug) return;
		if (!(e.target instanceof Node)) return;
		if (e.target.closest?.('.comment-reaction-picker')) return;
		if (e.target.closest?.('.connect-chat-msg-hover-bar')) return;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || !messagesEl.contains(e.target)) {
			closeChatMessageToolbar();
			return;
		}
		const row = e.target.closest?.('.connect-chat-msg[data-chat-message-id]');
		if (!row) {
			closeChatMessageToolbar();
		}
	};
	document.addEventListener('pointerdown', chatToolbarOutsidePointerHandler, true);

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
	await setupChatSidebarSectionAdds();
}
