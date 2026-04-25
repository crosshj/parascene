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

/** Align with `public/pages/chat.css` mobile chrome / canvas rules (`max-width: 768px`). */
function isChatPageMobileLayout() {
	try {
		return window.matchMedia('(max-width: 768px)').matches;
	} catch {
		return typeof window.innerWidth === 'number' && window.innerWidth <= 768;
	}
}

function shouldUseAppMobileHeaderForChatPath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	if (p === '/' || p === '/index.html' || p === '/feed' || p === '/explore' || p === '/creations') return true;
	if (!p.startsWith('/chat/c/')) return false;
	const slug = p.slice('/chat/c/'.length).split('/')[0].trim().toLowerCase();
	if (!slug || slug === 'feedback') return false;
	return slug === 'feed' || slug === 'explore' || slug === 'creations';
}

function shouldShowMobileSidebarFromLocation() {
	const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
	return isChatPageMobileLayout() && path === '/chat' && window.location.hash === '#channels';
}

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
let isTriggeredSuggestPopupOpen;
let addPageUsers;
let clearPageUsers;
let enableLikeButtons;
let createPseudoColumnPager;
let toggleChatMessageReaction;
let setupReactionTooltipTap;
let createConnectCommentRowElement;

/**
 * How pseudo feed lanes (#feed / explore browse / creations in chat) order items and infinite scroll.
 * - `newest_first`: match main home feed — newest at top, load older by scrolling down.
 * - `oldest_first`: chat-style column — newer toward the bottom, load older by scrolling up.
 * @typedef {'newest_first' | 'oldest_first'} ChatFeedLaneScrollMode
 */

/** @type {ChatFeedLaneScrollMode} */
let chatFeedLaneScrollMode = 'newest_first';

function normalizeChatFeedLaneScrollMode(mode) {
	if (mode === 'oldest_first' || mode === 'newest_first') return mode;
	return 'newest_first';
}

export function getChatFeedLaneScrollMode() {
	return chatFeedLaneScrollMode;
}

/**
 * @param {unknown} mode
 */
export function setChatFeedLaneScrollMode(mode) {
	chatFeedLaneScrollMode = normalizeChatFeedLaneScrollMode(mode);
}

function feedLanePagerColumnOrder() {
	return chatFeedLaneScrollMode === 'newest_first' ? 'feed' : 'chat';
}

/** When false, `[data-chat-composer]` is hidden for every channel mode until toggled. Default true. */
let chatComposerVisible = true;

/** @type {null | (() => void)} */
let chatApplyComposerStateRef = null;

export function getChatComposerVisible() {
	return chatComposerVisible;
}

/**
 * @param {unknown} visible
 */
export function setChatComposerVisible(visible) {
	chatComposerVisible = Boolean(visible);
	chatApplyComposerStateRef?.();
}

/**
 * Shared browse presentation for `#explore` and `#creations`: wide column (matches main app), image grid, square thumbnails, image-only tiles (no list-style feed footer). `#feed` is unchanged.
 */
let chatExploreCreationsBrowseView = true;

/** @type {null | (() => void)} */
let syncChatBrowseViewBodyClassRef = null;

export function getChatExploreCreationsBrowseView() {
	return chatExploreCreationsBrowseView;
}

/**
 * @param {unknown} enabled
 */
export function setChatExploreCreationsBrowseView(enabled) {
	chatExploreCreationsBrowseView = Boolean(enabled);
	try {
		document.querySelectorAll('[data-chat-explore-creations-lane="1"]').forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			el.classList.toggle('chat-feed-channel-route--browse-view', chatExploreCreationsBrowseView);
		});
	} catch {
		// ignore
	}
	syncChatBrowseViewBodyClassRef?.();
}

/** @deprecated use getChatExploreCreationsBrowseView */
export function getChatPseudoChannelImageGrid() {
	return chatExploreCreationsBrowseView;
}

/** @deprecated use setChatExploreCreationsBrowseView */
export function setChatPseudoChannelImageGrid(enabled) {
	setChatExploreCreationsBrowseView(enabled);
}

/** @deprecated use getChatExploreCreationsBrowseView */
export function getChatExploreCreationsHideFeedCardMetadata() {
	return chatExploreCreationsBrowseView;
}

/** @deprecated use setChatExploreCreationsBrowseView */
export function setChatExploreCreationsHideFeedCardMetadata(hide) {
	setChatExploreCreationsBrowseView(hide);
}

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
		isTriggeredSuggestPopupOpen = suggestMod.isTriggeredSuggestPopupOpen;
		addPageUsers = suggestMod.addPageUsers;
		clearPageUsers = suggestMod.clearPageUsers;

		const likesMod = await import(`../shared/likes.js${qs}`);
		enableLikeButtons = likesMod.enableLikeButtons;

		const commentsMod = await import(`../shared/comments.js${qs}`);
		toggleChatMessageReaction = commentsMod.toggleChatMessageReaction;

		const tooltipTapMod = await import(`../shared/reactionTooltipTap.js${qs}`);
		setupReactionTooltipTap = tooltipTapMod.setupReactionTooltipTap;

		const connectCardMod = await import(`../shared/connectCommentCard.js${qs}`);
		createConnectCommentRowElement = connectCardMod.createConnectCommentRowElement;

		const columnPagerMod = await import(`../shared/pseudoChannelColumnPager.js${qs}`);
		createPseudoColumnPager = columnPagerMod.createPseudoColumnPager;
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

function bindInlineVideoClickControls(rootEl) {
	const root =
		rootEl instanceof Element || rootEl instanceof Document ? rootEl : document;
	if (!root || typeof root.querySelectorAll !== 'function') return;
	for (const video of root.querySelectorAll('video[data-inline-click-controls="1"]')) {
		if (!(video instanceof HTMLVideoElement)) continue;
		if (video.dataset.clickControlsBound === '1') continue;
		video.dataset.clickControlsBound = '1';
		video.controls = false;
		const wrap = video.closest('.connect-chat-creation-embed-inner--video');
		const overlay = wrap?.querySelector?.('.user-text-inline-video-play-overlay');
		const activate = () => {
			video.controls = true;
			if (wrap instanceof HTMLElement) wrap.classList.add('user-text-inline-video--active');
			if (overlay instanceof HTMLButtonElement) overlay.hidden = true;
			void video.play().catch(() => {
				// ignore autoplay/gesture issues; controls are now visible.
			});
		};
		if (overlay instanceof HTMLButtonElement) {
			overlay.addEventListener('click', () => activate());
		}
		video.addEventListener('click', () => {
			if (video.controls) return;
			activate();
		});
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
	if (p === '/' || p === '/index.html' || p === '/feed') {
		return { kind: 'channel', slug: 'feed' };
	}
		if (p === '/chat') {
			return { kind: 'channel', slug: 'feed' };
		}
	if (p === '/explore') {
		return { kind: 'channel', slug: 'explore' };
	}
	if (p === '/creations') {
		return { kind: 'channel', slug: 'creations' };
	}
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

/** Slugs where canvases are disabled in the client (pseudo-column channels). `#feedback` is allowed; keep aligned with `CANVAS_DISALLOWED_CHANNEL_SLUGS` in api_routes/chat.js */
const CHAT_CANVAS_DISALLOWED_SLUGS = new Set(['comments', 'feed', 'explore', 'creations']);

/**
 * @param {object | null | undefined} m
 * @returns {{ title: string } | null}
 */
function getChatCanvasMetaFromMessage(m) {
	const meta = m?.meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
	const canvas = meta.canvas;
	if (!canvas || typeof canvas !== 'object') return null;
	const title = typeof canvas.title === 'string' ? canvas.title.trim() : '';
	if (!title) return null;
	return { title };
}

/**
 * Mount chat UI and load the thread for the current URL.
 * @param {HTMLElement} root — container with [data-chat] markup (see pages/chat.html)
 * @param {{
 *   feedLaneScrollMode?: ChatFeedLaneScrollMode,
 *   showComposer?: boolean,
 *   exploreCreationsBrowseView?: boolean,
 *   pseudoChannelImageGrid?: boolean,
 *   exploreCreationsHideFeedCardMetadata?: boolean,
 * }} [options] — `data-chat-explore-creations-browse-view` on `root` (or legacy `data-chat-pseudo-channel-image-grid` / `data-chat-explore-creations-hide-feed-card-metadata`) when omitted
 */
export async function initChatPage(root, options = {}) {
	if (!(root instanceof HTMLElement)) return;
	if (options.feedLaneScrollMode != null) {
		setChatFeedLaneScrollMode(options.feedLaneScrollMode);
	} else {
		const d = root.dataset.chatFeedLaneScroll;
		if (d === 'oldest_first' || d === 'newest_first') {
			setChatFeedLaneScrollMode(d);
		}
	}
	if (options.showComposer !== undefined) {
		chatComposerVisible = Boolean(options.showComposer);
	} else {
		const sc = root.dataset.chatShowComposer;
		if (sc === 'false' || sc === '0') {
			chatComposerVisible = false;
		} else if (sc === 'true' || sc === '1') {
			chatComposerVisible = true;
		}
	}
	if (options.exploreCreationsBrowseView !== undefined) {
		chatExploreCreationsBrowseView = Boolean(options.exploreCreationsBrowseView);
	} else if (options.pseudoChannelImageGrid === false || options.exploreCreationsHideFeedCardMetadata === false) {
		chatExploreCreationsBrowseView = false;
	} else if (options.pseudoChannelImageGrid === true || options.exploreCreationsHideFeedCardMetadata === true) {
		chatExploreCreationsBrowseView = true;
	} else {
		const bv = root.dataset.chatExploreCreationsBrowseView;
		if (bv === 'false' || bv === '0') {
			chatExploreCreationsBrowseView = false;
		} else if (bv === 'true' || bv === '1') {
			chatExploreCreationsBrowseView = true;
		} else {
			const ig = root.dataset.chatPseudoChannelImageGrid;
			const hm = root.dataset.chatExploreCreationsHideFeedCardMetadata;
			if (ig === 'false' || ig === '0' || hm === 'false' || hm === '0') {
				chatExploreCreationsBrowseView = false;
			} else if (ig === 'true' || ig === '1' || hm === 'true' || hm === '1') {
				chatExploreCreationsBrowseView = true;
			}
		}
	}

	/** Canvas panel lives outside `[data-chat-page]` (sibling under `.chat-page-main-split`). */
	const chatLayoutRoot = root.closest('.chat-page-main-split');
	const chatCanvasScope = chatLayoutRoot instanceof HTMLElement ? chatLayoutRoot : root;
	const mainColumn =
		chatLayoutRoot instanceof HTMLElement &&
			chatLayoutRoot.parentElement instanceof HTMLElement &&
			chatLayoutRoot.parentElement.classList.contains('chat-page-main-column')
			? chatLayoutRoot.parentElement
			: root.closest('.chat-page-main-column');
	const canvasActionRoot = mainColumn instanceof HTMLElement ? mainColumn : chatCanvasScope;

	/** @type {null | ((e: KeyboardEvent) => void)} */
	let mobileChromeEscapeKeyHandler = null;

	await loadDeps();

	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	const {
		sendIcon,
		notifyIcon,
		creditIcon,
		REACTION_ORDER,
		REACTION_ICONS,
		smileIcon,
		gearIcon,
		copyIcon,
		trashIcon,
		helpIcon,
		linkIcon2
	} = await import(`../icons/svg-strings.js${qs}`);
	const chatSidebarServerGearSvg = gearIcon('chat-page-sidebar-server-settings-icon');
	const rosterMod = await import(`../shared/chatSidebarRoster.js${qs}`);
	const chatDmSidebarGearMenuMod = await import(`../shared/chatDmSidebarGearMenu.js${qs}`);
	const openDmSidebarGearMenu = chatDmSidebarGearMenuMod.openDmSidebarGearMenu;
	const serverChatTagMod = await import(`../shared/serverChatTag.js${qs}`);
	const serverChannelTagFromServerName = serverChatTagMod.serverChannelTagFromServerName;
	const creationsPollMod = await import(`../shared/creationsInFlightPoller.js${qs}`);
	const chatGlobalUnreadChromeMod = await import(`../shared/chatGlobalUnreadChrome.js${qs}`);
	const applyChatGlobalUnreadChrome = chatGlobalUnreadChromeMod.applyChatGlobalUnreadChrome;
	const restoreChatGlobalUnreadFavicon = chatGlobalUnreadChromeMod.restoreChatGlobalUnreadFavicon;
	const chatUnreadAudioMod = await import(`../shared/chatUnreadAudio.js${qs}`);
	const playChatUnreadPing = chatUnreadAudioMod.playChatUnreadPing;
	const chatAudiblePrefMod = await import(`../shared/chatAudibleNotificationsPref.js${qs}`);
	const hydrateChatAudibleNotificationsFromServer = chatAudiblePrefMod.hydrateChatAudibleNotificationsFromServer;

	async function hydrateAudibleNotificationsFromProfileOnce() {
		try {
			const r = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
			if (r.ok && r.data) {
				hydrateChatAudibleNotificationsFromServer(r.data.audibleNotifications);
			}
		} catch {
			// ignore
		}
	}

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
	let chatGlobalUnreadTotal = 0;
	let chatGlobalUnreadInitialized = false;
	let chatGlobalUnreadPoll = null;
	let chatGlobalUnreadBroadcastTeardown = null;
	let chatGlobalUnreadBroadcastBoundId = null;
	let chatViewerId = null;
	/** Set from GET /api/chat/threads (`viewer_is_admin`) or threads cache. */
	let chatViewerIsAdmin = false;
	/** Set from GET /api/chat/threads (`viewer_is_founder`) or threads cache. */
	let chatViewerIsFounder = false;
	/** Canvas list for current channel thread (GET .../canvases). */
	let chatCanvasesList = [];
	/** Message id pinned for the active channel thread (from GET .../canvases). */
	let activeThreadPinnedCanvasId = null;
	let closeChatCanvasPanel = () => { };
	let rebuildTopbarMenuDynamic = () => { };
	let refreshChatCanvasesList = async () => { };
	/** @type {{ id: number, title: string, body: string, sender_id: number } | null} */
	let activeCanvasRow = null;
	let chatCanvasEditSnapshot = { title: '', body: '' };
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatCanvasOwnerMenuOutside = null;
	/** @type {null | (() => void)} */
	let chatCanvasCreateCleanup = null;
	let tearDownChatCanvasUi = () => { };
	let chatThreads = [];
	let activeThreadId = null;
	/** Most recent thread-ish meta used to paint desktop/mobile header title + avatar. */
	let activeHeaderMeta = null;
	/** @type {string | null} — e.g. reserved `comments`; not a real chat thread id. */
	let activePseudoChannelSlug = null;
	/** Shared pager for pseudo-column data (#comments / #feed / #explore / #creations); view layer owns DOM + sentinels. */
	let pseudoColumnPager = null;
	/** @type {IntersectionObserver | null} */
	let commentsChannelLoadMoreObserver = null;
	const COMMENTS_CHANNEL_PAGE_SIZE = 50;
	/** @type {IntersectionObserver | null} */
	let feedChannelLoadMoreObserver = null;
	/** @type {IntersectionObserver | null} */
	let feedChannelVideoObserver = null;
	const FEED_CHANNEL_PAGE_SIZE = 20;
	/** Aligned with `CREATIONS_PAGE_SIZE` in `components/routes/creations.js` + `/api/create/images`. */
	const CREATIONS_CHANNEL_PAGE_SIZE = 50;
	const EXPLORE_CHANNEL_PAGE_SIZE = 24;
	/** Keyword + semantic search batch size (aligned with `app-route-explore`). */
	const EXPLORE_SEARCH_FETCH_LIMIT = 100;
	/** Current trimmed search string for `#explore` (empty = browse `/api/explore`). */
	const exploreQueryRef = { q: '' };
	/** True while `#explore` merged keyword+semantic search fetch is in flight (composer trailing control shows a spinner). */
	let exploreChannelSearchLoading = false;
	/** True while `loadExploreChannelMessages` is running (browse or search path) so the composer can show the same trailing spinner. */
	let exploreBrowseMessagesLoading = false;
	let loadingMessages = false;
	let chatCreationsPollInterval = null;
	let chatCreationsPollLastReloadAt = 0;

	function isExploreComposerLoadLocked() {
		return exploreChannelSearchLoading || exploreBrowseMessagesLoading;
	}
	let sendInFlight = false;
	/** Staged attachments before send (ChatGPT-style composer). */
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
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatSidebarDmHoverOverHandler = null;
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatSidebarDmHoverOutHandler = null;
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
	/** @type {null | (() => void)} */
	let chatHashtagChoiceModalCleanup = null;
	/** @type {HTMLElement | null} */
	let chatSidebarDmHoverPopoverEl = null;
	/** @type {HTMLElement | null} */
	let chatSidebarDmHoverActiveAnchor = null;

	let lastMarkReadSentId = null;
	let lastReadThreadIdForMark = null;
	/** @type {IntersectionObserver | null} */
	let latestMessageReadObserver = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let bottomDwellTimer = null;
	let bottomDwellThreadId = null;

	const CHAT_BOTTOM_THRESHOLD_PX = 56;
	// TEMP: disable runtime auto-scroll behavior while keeping initial load at bottom.
	const CHAT_TEMP_DISABLE_AUTO_SCROLL = true;
	const DM_OFFLINE_GRACE_MS = 45 * 1000;
	const DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
	const DM_ORDER_WEIGHT_LAST_SEEN = 0.9;
	const DM_ORDER_WEIGHT_LAST_INTERACTED = 0.1;
	const DM_ORDER_LAST_SEEN_DECAY_MS = 10 * 60 * 1000;
	const DM_ORDER_LAST_INTERACTED_DECAY_MS = 45 * 60 * 1000;
	const DM_ORDER_RECENT_ACTIVE_EXTREME_BUMP = 8;
	const DM_ORDER_ONLINE_BOOST = 1;
	const DM_ORDER_STALE_OFFLINE_MULTIPLIER = 0.1;
	/** @type {Map<number, number>} */
	const dmLastSeenOnlineAtByUserId = new Map();
	/** Pin DM avatar URL per user for this page session (prevents poll-time URL churn/re-downloads). */
	const chatSidebarDmAvatarUrlByUserId = new Map();
	/** Pin viewer footer avatar URL for this page session. */
	let chatSidebarViewerAvatarUrlPinned = '';
	/** Last authored sidebar section HTML (avoid diffing against live DOM mutated by expand/collapse state). */
	let chatSidebarLastDmHtml = '';
	let chatSidebarLastServersHtml = '';
	let chatSidebarLastChannelsHtml = '';

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

	/** Keep first non-empty DM avatar URL for a user stable during this page session. */
	function getPinnedSidebarDmAvatarUrl(otherUserId, avatarUrlRaw) {
		const oid = Number(otherUserId);
		const incoming = typeof avatarUrlRaw === 'string' ? avatarUrlRaw.trim() : '';
		if (!Number.isFinite(oid) || oid <= 0) return incoming;
		const cached = chatSidebarDmAvatarUrlByUserId.get(oid);
		if (typeof cached === 'string' && cached) return cached;
		if (incoming) {
			chatSidebarDmAvatarUrlByUserId.set(oid, incoming);
			return incoming;
		}
		return '';
	}

	/**
	 * Keep base DM order stable, but promote online rows into the visible (uncollapsed) window.
	 * Promotion only swaps with currently visible offline rows so the list does not fully reshuffle.
	 * @param {object[]} dms
	 * @param {{
	 * 	visibleCap?: number,
	 * 	isOnline?: ((t: object) => boolean) | null,
	 * 	getLastSeenMs?: ((t: object) => number) | null,
	 * 	getLastInteractedMs?: ((t: object) => number) | null
	 * }} [opts]
	 */
	function prioritizeOnlineDmsInVisibleWindow(dms, opts = {}) {
		const raw = Array.isArray(dms) ? dms : [];
		const capRaw = Number(opts?.visibleCap);
		const cap =
			Number.isFinite(capRaw) && capRaw > 0
				? Math.floor(capRaw)
				: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP;
		const isOnline = typeof opts?.isOnline === 'function' ? opts.isOnline : () => false;
		const getLastSeenMs =
			typeof opts?.getLastSeenMs === 'function'
				? opts.getLastSeenMs
				: () => 0;
		const getLastInteractedMs =
			typeof opts?.getLastInteractedMs === 'function'
				? opts.getLastInteractedMs
				: () => 0;
		const isPriorityPresenceRow = (row, nowMs) => {
			if (isOnline(row)) return true;
			return lastSeenAgeMs(row, nowMs) <= DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS;
		};
		const recencyDecayScore = (ms, nowMs, decayMs) => {
			const ts = Number(ms);
			if (!Number.isFinite(ts) || ts <= 0) return 0;
			const age = Math.max(0, nowMs - ts);
			return Math.exp(-age / decayMs);
		};
		const lastSeenAgeMs = (row, nowMs) => {
			const seenRaw = Number(getLastSeenMs(row));
			const seenMs = Number.isFinite(seenRaw) ? seenRaw : 0;
			if (seenMs <= 0) return Infinity;
			return Math.max(0, nowMs - seenMs);
		};
		const scoreRow = (row) => {
			const nowMs = Date.now();
			const online = isOnline(row);
			const recentlyActive = lastSeenAgeMs(row, nowMs) <= DM_PROMOTION_RECENT_ACTIVE_WINDOW_MS;
			const seenRaw = Number(getLastSeenMs(row));
			const seenMs = Number.isFinite(seenRaw) ? seenRaw : 0;
			const interactedRaw = Number(getLastInteractedMs(row));
			const interactedMs = Number.isFinite(interactedRaw) ? interactedRaw : 0;
			const seenScore = recencyDecayScore(seenMs, nowMs, DM_ORDER_LAST_SEEN_DECAY_MS);
			const interactedScore = recencyDecayScore(
				interactedMs,
				nowMs,
				DM_ORDER_LAST_INTERACTED_DECAY_MS
			);
			let score =
				seenScore * DM_ORDER_WEIGHT_LAST_SEEN +
				interactedScore * DM_ORDER_WEIGHT_LAST_INTERACTED;
			if (recentlyActive) {
				// Inside the 15-minute active window, presence should dominate over interaction recency.
				score += DM_ORDER_RECENT_ACTIVE_EXTREME_BUMP;
			}
			if (online) {
				score += DM_ORDER_ONLINE_BOOST;
			} else if (!recentlyActive) {
				// Strongly demote stale-offline rows so recently active users bubble up.
				score *= DM_ORDER_STALE_OFFLINE_MULTIPLIER;
			}
			return score;
		};
		const reorderVisibleWithPriorityPresenceFirst = (rows) => {
			const list = Array.isArray(rows) ? [...rows] : [];
			if (list.length === 0) return list;
			const vis = list.slice(0, cap);
			const restRows = list.slice(cap);
			const nowMs = Date.now();
			const pri = [];
			const other = [];
			for (let i = 0; i < vis.length; i += 1) {
				const row = vis[i];
				if (isPriorityPresenceRow(row, nowMs)) {
					pri.push({ row, i, score: scoreRow(row) });
				} else {
					other.push(row);
				}
			}
			pri.sort((a, b) => {
				if (a.score !== b.score) return b.score - a.score;
				return a.i - b.i;
			});
			return [...pri.map((x) => x.row), ...other, ...restRows];
		};
		if (raw.length <= cap) return reorderVisibleWithPriorityPresenceFirst(raw);

		const visible = raw.slice(0, cap);
		const rest = raw.slice(cap);
		const demotableVisibleRanked = [];
		for (let i = 0; i < visible.length; i += 1) {
			if (isOnline(visible[i])) continue;
			demotableVisibleRanked.push({ i, score: scoreRow(visible[i]) });
		}
		demotableVisibleRanked.sort((a, b) => {
			if (a.score !== b.score) return a.score - b.score;
			return a.i - b.i;
		});
		const demotableVisibleIdxs = demotableVisibleRanked.map((x) => x.i);
		if (demotableVisibleIdxs.length === 0) return [...raw];

		const promotableRestRanked = [];
		for (let i = 0; i < rest.length; i += 1) {
			const row = rest[i];
			const nowMs = Date.now();
			if (!isPriorityPresenceRow(row, nowMs)) continue;
			promotableRestRanked.push({ i, score: scoreRow(rest[i]) });
		}
		if (promotableRestRanked.length === 0) return [...raw];
		promotableRestRanked.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			return a.i - b.i;
		});
		const promotableRestIdxs = promotableRestRanked.map((x) => x.i);

		const swapCount = Math.min(demotableVisibleIdxs.length, promotableRestIdxs.length);
		if (swapCount <= 0) return [...raw];
		const demoteIdxSet = new Set(demotableVisibleIdxs.slice(0, swapCount));
		const promoteIdxSet = new Set(promotableRestIdxs.slice(0, swapCount));
		const promoted = [];
		for (let i = 0; i < rest.length; i += 1) {
			if (promoteIdxSet.has(i)) promoted.push(rest[i]);
		}
		const demoted = [];
		for (let i = 0; i < visible.length; i += 1) {
			if (demoteIdxSet.has(i)) demoted.push(visible[i]);
		}
		let promotedCursor = 0;
		const newVisible = visible.map((row, i) => {
			if (!demoteIdxSet.has(i)) return row;
			const next = promoted[promotedCursor];
			promotedCursor += 1;
			return next;
		});
		const restWithoutPromoted = [];
		for (let i = 0; i < rest.length; i += 1) {
			if (!promoteIdxSet.has(i)) restWithoutPromoted.push(rest[i]);
		}
		return reorderVisibleWithPriorityPresenceFirst([...newVisible, ...demoted, ...restWithoutPromoted]);
	}

	function dispatchChatUnreadRefresh() {
		try {
			document.dispatchEvent(new CustomEvent('chat-unread-refresh'));
		} catch {
			// ignore
		}
	}

	function formatHoverAgoFromMs(ms) {
		const n = Number(ms);
		if (!Number.isFinite(n) || n <= 0) return 'Never';
		const deltaMs = Date.now() - n;
		if (Number.isFinite(deltaMs)) {
			if (deltaMs < 45 * 1000) return 'just now';
			if (deltaMs < 2 * 60 * 1000) return '1m ago';
		}
		try {
			const iso = new Date(n).toISOString();
			const rel = typeof formatRelativeTime === 'function' ? formatRelativeTime(iso) : '';
			return rel || 'Just now';
		} catch {
			return 'Just now';
		}
	}

	/**
	 * Avoid churny sidebar row HTML: presence snapshots can move by seconds, which
	 * would otherwise force `innerHTML` differences and avatar node replacement.
	 * Quantize to minute buckets for hover metadata attrs.
	 */
	function quantizeSidebarHoverMs(ms) {
		const n = Number(ms);
		if (!Number.isFinite(n) || n <= 0) return 0;
		const minute = 60 * 1000;
		return Math.floor(n / minute) * minute;
	}

	function ensureChatSidebarDmHoverPopoverEl() {
		if (chatSidebarDmHoverPopoverEl?.isConnected) return chatSidebarDmHoverPopoverEl;
		const el = document.createElement('div');
		el.className = 'chat-page-sidebar-dm-hover-popover';
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		el.hidden = true;
		document.body.appendChild(el);
		chatSidebarDmHoverPopoverEl = el;
		return el;
	}

	function positionChatSidebarDmHoverPopover(anchorEl, popoverEl) {
		if (!(anchorEl instanceof HTMLElement) || !(popoverEl instanceof HTMLElement)) return;
		const titleRect = anchorEl.getBoundingClientRect();
		const row = anchorEl.closest('.chat-page-sidebar-row');
		const rowRect = row instanceof HTMLElement ? row.getBoundingClientRect() : titleRect;
		const gap = 12;
		const margin = 8;
		const maxWidth = Math.min(320, window.innerWidth - 16);
		popoverEl.style.maxWidth = `${maxWidth}px`;
		popoverEl.style.left = '0px';
		popoverEl.style.top = '0px';
		popoverEl.hidden = false;
		const popRect = popoverEl.getBoundingClientRect();
		// Anchor to full row right edge so the popover clears the DM gear (title span ends before it).
		let left = rowRect.right + gap;
		if (left + popRect.width > window.innerWidth - margin) {
			left = titleRect.left - popRect.width - gap;
		}
		left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
		let top = titleRect.top + titleRect.height / 2 - popRect.height / 2;
		top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));
		popoverEl.style.left = `${Math.round(left)}px`;
		popoverEl.style.top = `${Math.round(top)}px`;
	}

	function hideChatSidebarDmHoverPopover() {
		chatSidebarDmHoverActiveAnchor = null;
		if (chatSidebarDmHoverPopoverEl instanceof HTMLElement) {
			chatSidebarDmHoverPopoverEl.hidden = true;
		}
	}

	function showChatSidebarDmHoverPopover(anchorEl) {
		if (!(anchorEl instanceof HTMLElement)) return;
		const popover = ensureChatSidebarDmHoverPopoverEl();
		const interactedMs = Number(anchorEl.getAttribute('data-chat-dm-last-interacted-ms'));
		const seenMs = Number(anchorEl.getAttribute('data-chat-dm-last-seen-ms'));
		popover.innerHTML = '';
		const titleEl = document.createElement('p');
		titleEl.className = 'chat-page-sidebar-dm-hover-popover-title';
		titleEl.textContent = 'Pulse';
		const rowInteracted = document.createElement('p');
		rowInteracted.className = 'chat-page-sidebar-dm-hover-popover-row';
		rowInteracted.textContent = `Last interacted: ${formatHoverAgoFromMs(interactedMs)}`;
		const rowSeen = document.createElement('p');
		rowSeen.className = 'chat-page-sidebar-dm-hover-popover-row';
		rowSeen.textContent = `Last active: ${formatHoverAgoFromMs(seenMs)}`;
		popover.appendChild(titleEl);
		popover.appendChild(rowInteracted);
		popover.appendChild(rowSeen);
		chatSidebarDmHoverActiveAnchor = anchorEl;
		positionChatSidebarDmHoverPopover(anchorEl, popover);
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
		if (CHAT_TEMP_DISABLE_AUTO_SCROLL) {
			// TEMP: keep first paint pinned to latest instead of jumping to first unread.
			scrollChatMessagesToEnd('initial_load');
			return;
		}
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
	function scrollChatMessagesToEnd(reason = 'runtime') {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		if (CHAT_TEMP_DISABLE_AUTO_SCROLL && reason !== 'initial_load') {
			// TEMP: disable non-initial auto-scroll jumps.
			return;
		}
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
		if (reason === 'initial_load') {
			// TEMP: one-time settle snaps for late row growth (images/embeds/layout), without enabling auto-follow.
			const settleDelays = [120, 320];
			for (const ms of settleDelays) {
				window.setTimeout(() => {
					apply();
				}, ms);
			}
		}
	}

	/** Feed / explore / creations pseudo-channels: match main feed — newest at top, scroll down for more. */
	function scrollChatFeedPseudoChannelToTop() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		chatStickToBottom = false;
		teardownBottomDwellTimer();
		const apply = () => {
			messagesEl.scrollTop = 0;
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
	}

	/** Re-scroll after visual viewport changes only if the user was already following the thread. */
	function nudgeChatScrollIfStuckToBottom() {
		if (CHAT_TEMP_DISABLE_AUTO_SCROLL) {
			// TEMP: disable viewport-driven re-pinning.
			return;
		}
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
		if (CHAT_TEMP_DISABLE_AUTO_SCROLL) {
			// TEMP: keep scroll listeners/observers off so chat does not auto-follow updates.
			return;
		}
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
	const CHAT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

	/** Same extensions as server `EXT_NEEDS_WEB_TRANSCODE` — no reliable <img> preview in Chromium. */
	const CHAT_EXT_NO_BLOB_IMG_PREVIEW = new Set(['.heic', '.heif', '.jxl', '.tif', '.tiff']);

	function chatExtFromFileName(name) {
		const s = String(name || '');
		const i = s.lastIndexOf('.');
		if (i <= 0 || i >= s.length - 1) return '';
		return s.slice(i).toLowerCase();
	}

	function chatContentTypeNeedsBrowserSafeTranscode(contentType) {
		const t = String(contentType || '').toLowerCase();
		if (!t.startsWith('image/')) return false;
		if (t.includes('heic') || t.includes('heif')) return true;
		if (t === 'image/tiff' || t === 'image/tif' || t.includes('image/tiff')) return true;
		if (t === 'image/jxl' || t.includes('jpeg-xl')) return true;
		return false;
	}

	/** True when the file is treated as an image but a blob: URL is not useful for a thumbnail (matches server transcode list). */
	function chatImageFileSkipBlobPreview(file) {
		if (!(file instanceof File)) return false;
		if (CHAT_EXT_NO_BLOB_IMG_PREVIEW.has(chatExtFromFileName(file.name))) return true;
		return chatContentTypeNeedsBrowserSafeTranscode(file.type);
	}

	function chatAttachmentKindFromType(fileType) {
		const t = String(fileType || '').toLowerCase();
		if (t.startsWith('image/')) return 'image';
		if (t.startsWith('video/')) return 'video';
		return 'file';
	}

	/** Use <img> only when we have a URL the browser can show (blob preview or final generic_* URL). */
	function chatComposerUsesImageThumbnail(item, kindFromType) {
		if (kindFromType !== 'image') return false;
		if (item.status === 'ready' && item.urlPath) {
			return item.fileType !== '';
		}
		return Boolean(item.previewUrl);
	}

	function buildAttachmentMessageUrl(item) {
		const basePath = String(item?.urlPath || '').trim();
		if (!basePath) return '';
		const kind = chatAttachmentKindFromType(item?.fileType);
		if (kind === 'image') return basePath;
		try {
			const u = new URL(basePath, window.location.origin);
			// Preserve original Unicode filename for chat rendering; upload header uses a safe ASCII variant.
			const name = String(item?.fileName || '').trim().slice(0, 240);
			const size = Number(item?.fileSize);
			if (name) u.searchParams.set('name', name);
			if (Number.isFinite(size) && size >= 0) {
				u.searchParams.set('size', String(Math.floor(size)));
			}
			return `${u.pathname}${u.search}`;
		} catch {
			return basePath;
		}
	}

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
			if (key.includes('..') || !/^profile\/\d+\/(?:generic|misc)_[^/]+$/i.test(key)) return null;
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

			const kind = chatAttachmentKindFromType(item.fileType);
			if (chatComposerUsesImageThumbnail(item, kind)) {
				const img = document.createElement('img');
				img.className = 'chat-page-composer-attachment-preview';
				img.alt = '';
				if (item.status === 'ready' && item.urlPath) {
					img.src = item.urlPath;
				} else if (item.previewUrl) {
					img.src = item.previewUrl;
				}
				card.appendChild(img);
			} else {
				const panel = document.createElement('div');
				panel.className = 'chat-page-composer-attachment-preview chat-page-composer-attachment-preview--file';
				const name = String(item.fileName || '').trim();
				const fileNameEl = document.createElement('div');
				fileNameEl.className = 'chat-page-composer-attachment-file-name';
				fileNameEl.textContent = name || (kind === 'video' ? 'video' : 'file');
				if (name) panel.title = name;
				panel.appendChild(fileNameEl);
				card.appendChild(panel);
			}

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
			rm.setAttribute('aria-label', 'Remove attachment');
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

	async function addChatFiles(fileList) {
		if (!activeThreadId || activePseudoChannelSlug || sendInFlight) return;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (bodyInput instanceof HTMLTextAreaElement && bodyInput.disabled) return;
		const arr = Array.from(fileList || []).filter((f) => f instanceof File);
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
			console.error('[Chat page] upload module:', err);
			if (errStrip instanceof HTMLElement) {
				errStrip.hidden = false;
				errStrip.textContent = 'Could not load file upload.';
			}
			return;
		}

		for (const file of arr) {
			if (file.size > CHAT_MAX_UPLOAD_BYTES) {
				if (errStrip instanceof HTMLElement) {
					errStrip.hidden = false;
					errStrip.textContent = `"${file.name || 'File'}" is too large (max 10MB).`;
				}
				continue;
			}
			const id =
				typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const useBlobImgPreview =
				chatAttachmentKindFromType(file.type) === 'image' && !chatImageFileSkipBlobPreview(file);
			const previewUrl = useBlobImgPreview ? URL.createObjectURL(file) : '';
			chatPendingImages.push({
				id,
				previewUrl,
				status: 'uploading',
				fileType: file.type || '',
				fileName: file.name || '',
				fileSize: Number.isFinite(file.size) ? file.size : 0,
				file
			});
			renderChatAttachmentStrip();
			syncChatSendButton();

			void (async () => {
				try {
					const { url: urlPath, displayAsFile } = await mod.uploadChatFile(file);
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
					if (displayAsFile) {
						ent.fileType = '';
					}
					ent.status = 'ready';
					renderChatAttachmentStrip();
					syncChatSendButton();
				} catch (err) {
					console.error('[Chat page] file upload:', err);
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

	/** No "Message…" until thread is known and messages are not loading (avoids placeholder vs attach layout churn). Explore keeps a stable placeholder; load state is shown in the trailing control. */
	function syncChatMessagePlaceholder() {
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;
		if (activePseudoChannelSlug && activePseudoChannelSlug !== 'explore') return;
		if (bodyInput.hidden || bodyInput.disabled) return;
		if (activePseudoChannelSlug === 'explore') {
			bodyInput.placeholder = 'Search creations…';
			return;
		}
		const tid = activeThreadId;
		const hasThread = tid != null && Number.isFinite(Number(tid)) && Number(tid) > 0;
		if (!hasThread || loadingMessages) {
			bodyInput.placeholder = '';
			return;
		}
		const meta = (chatThreads || []).find((t) => Number(t.id) === Number(tid));
		const titleEl = root.querySelector('[data-chat-title]');
		const uiLabel = titleEl instanceof HTMLElement ? String(titleEl.textContent || '').trim() : '';
		const metaTitle = meta?.title && String(meta.title).trim() ? String(meta.title).trim() : '';
		const isChannel = meta?.type === 'channel';
		const channelSlug = isChannel ? String(meta?.channel_slug || '').trim().toLowerCase() : '';
		const pseudoLabel = channelSlug ? String(rosterMod.getSidebarPseudoChannelTitle(channelSlug) || '').trim() : '';
		let label = uiLabel || metaTitle || pseudoLabel;
		if (!label && isChannel && channelSlug) {
			label = `#${channelSlug}`;
		}
		if (!label || label.toLowerCase() === 'chat') {
			bodyInput.placeholder = 'Message…';
			return;
		}
		if (isChannel && !label.startsWith('#') && !pseudoLabel) {
			label = `#${label}`;
		}
		bodyInput.placeholder = `Message ${label}…`;
	}

	function syncExploreChannelBrowseUrl() {
		if (activePseudoChannelSlug !== 'explore') return;
		try {
			const url = new URL(window.location.href);
			const path = url.pathname.replace(/\/+$/, '') || '/';
			if (path !== '/chat/c/explore') return;
			url.searchParams.delete('s');
			const next = url.pathname + (url.search || '') + url.hash;
			const cur = window.location.pathname + window.location.search + window.location.hash;
			if (next !== cur) {
				history.replaceState({ prsnChat: true }, '', next);
			}
		} catch {
			// ignore
		}
	}

	function pushExploreChannelSearchToHistory(trimmed) {
		if (activePseudoChannelSlug !== 'explore') return;
		const t = String(trimmed || '').trim();
		if (!t) return;
		try {
			const url = new URL(window.location.href);
			const path = url.pathname.replace(/\/+$/, '') || '/';
			if (path !== '/chat/c/explore') return;
			url.searchParams.set('s', t);
			const next = url.pathname + (url.search || '') + url.hash;
			const cur = window.location.pathname + window.location.search + window.location.hash;
			if (next !== cur) {
				history.pushState({ prsnChat: true }, '', next);
			}
		} catch {
			// ignore
		}
	}

	function syncChatExploreComposerChrome() {
		const composerForm = root.querySelector('[data-chat-composer]');
		const clearBtn = root.querySelector('[data-chat-explore-clear-search]');
		const searchIconWrap = root.querySelector('[data-chat-explore-search-icon-wrap]');
		const spinner = root.querySelector('[data-chat-explore-clear-spinner]');
		const xIconWrap = root.querySelector('[data-chat-explore-x-icon-wrap]');
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (!(composerForm instanceof HTMLFormElement)) return;
		if (activePseudoChannelSlug === 'explore') {
			composerForm.dataset.chatComposerMode = 'explore';
			const trailingBusy = isExploreComposerLoadLocked();
			if (bodyInput instanceof HTMLTextAreaElement) {
				bodyInput.readOnly = trailingBusy;
				if (trailingBusy) {
					bodyInput.setAttribute('aria-busy', 'true');
				} else {
					bodyInput.removeAttribute('aria-busy');
				}
			}
			if (trailingBusy) {
				composerForm.dataset.chatExploreSearchLoading = '1';
			} else {
				delete composerForm.dataset.chatExploreSearchLoading;
			}
			if (clearBtn instanceof HTMLButtonElement && bodyInput instanceof HTMLTextAreaElement) {
				clearBtn.hidden = false;
				const trimmed = String(bodyInput.value || '').trim();
				const committed = String(exploreQueryRef.q || '').trim();
				if (trailingBusy) {
					clearBtn.disabled = true;
					clearBtn.setAttribute('aria-busy', 'true');
					clearBtn.setAttribute(
						'aria-label',
						exploreChannelSearchLoading ? 'Searching…' : 'Loading explore feed…'
					);
					if (searchIconWrap instanceof HTMLElement) searchIconWrap.hidden = true;
					if (spinner instanceof HTMLElement) spinner.hidden = false;
					if (xIconWrap instanceof HTMLElement) xIconWrap.hidden = true;
					return;
				}
				clearBtn.disabled = false;
				clearBtn.removeAttribute('aria-busy');
				if (spinner instanceof HTMLElement) spinner.hidden = true;
				const syncedWithResults = committed.length > 0 && trimmed === committed;
				if (syncedWithResults) {
					clearBtn.setAttribute('aria-label', 'Clear search and show explore feed');
					if (searchIconWrap instanceof HTMLElement) searchIconWrap.hidden = true;
					if (xIconWrap instanceof HTMLElement) xIconWrap.hidden = false;
				} else {
					const canSubmit = trimmed.length > 0 || committed.length > 0;
					clearBtn.setAttribute('aria-label', canSubmit ? 'Run search' : 'Search creations');
					if (searchIconWrap instanceof HTMLElement) searchIconWrap.hidden = false;
					if (xIconWrap instanceof HTMLElement) xIconWrap.hidden = true;
				}
			}
		} else {
			delete composerForm.dataset.chatComposerMode;
			delete composerForm.dataset.chatExploreSearchLoading;
			if (bodyInput instanceof HTMLTextAreaElement) {
				bodyInput.readOnly = false;
				bodyInput.removeAttribute('aria-busy');
			}
			if (clearBtn instanceof HTMLButtonElement) {
				clearBtn.hidden = true;
				clearBtn.disabled = false;
				clearBtn.removeAttribute('aria-busy');
				clearBtn.setAttribute('aria-label', 'Search creations');
			}
			if (searchIconWrap instanceof HTMLElement) searchIconWrap.hidden = false;
			if (spinner instanceof HTMLElement) spinner.hidden = true;
			if (xIconWrap instanceof HTMLElement) xIconWrap.hidden = true;
		}
	}

	function applyComposerState() {
		const composerForm = root.querySelector('[data-chat-composer]');
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const hint = root.querySelector('[data-chat-pseudo-composer-hint]');
		const shell = root.querySelector('[data-chat-composer] .chat-page-input-shell');
		const appHeader = document.querySelector('app-navigation');
		const appMobileNav = document.querySelector('app-navigation-mobile');
		const mobileChrome = mainColumn instanceof HTMLElement
			? mainColumn.querySelector('[data-chat-mobile-chrome]')
			: null;
		// Keep app mobile chrome visible across chat routes so header/footer do not disappear.
		const shouldShowAppMobileHeader = isChatPageMobileLayout();
		const shouldShowAppMobileFooter = isChatPageMobileLayout();
		const setMobileComposerOverlayClass = (on) => {
			if (!document.body) return;
			const shouldUseOverlay =
				Boolean(on) &&
				isChatPageMobileLayout() &&
				!shouldShowAppMobileHeader &&
				!shouldShowMobileSidebarFromLocation();
			document.body.classList.toggle('chat-page--mobile-composer-overlay', shouldUseOverlay);
		};
		try {
			document.documentElement.classList.toggle('chat-page--use-app-mobile-header', shouldShowAppMobileHeader);
		} catch {
			// ignore
		}
		if (appHeader instanceof HTMLElement) {
			appHeader.hidden = !shouldShowAppMobileHeader;
		}
		if (appMobileNav instanceof HTMLElement) {
			appMobileNav.hidden = !shouldShowAppMobileFooter;
		}
		if (mobileChrome instanceof HTMLElement) {
			mobileChrome.hidden = shouldShowAppMobileHeader;
		}

		if (!chatComposerVisible) {
			if (composerForm instanceof HTMLElement) {
				composerForm.hidden = true;
			}
			setMobileComposerOverlayClass(false);
			return;
		}
		if (
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'comments'
		) {
			if (composerForm instanceof HTMLFormElement) {
				delete composerForm.dataset.chatComposerMode;
			}
			clearChatPendingAttachments();
			if (hint instanceof HTMLElement) {
				hint.hidden = true;
			}
			if (composerForm instanceof HTMLElement) {
				composerForm.hidden = true;
			}
			setMobileComposerOverlayClass(false);
			syncChatAttachmentsVisibility();
			syncChatSendButton();
			syncChatMessagePlaceholder();
			syncChatExploreComposerChrome();
			return;
		}
		if (composerForm instanceof HTMLElement) {
			composerForm.hidden = false;
		}
		setMobileComposerOverlayClass(true);

		if (!(bodyInput instanceof HTMLTextAreaElement)) return;

		if (composerForm instanceof HTMLFormElement) {
			delete composerForm.dataset.chatComposerMode;
		}
		bodyInput.setAttribute('aria-label', 'Message text');
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
		}
		if (composerForm instanceof HTMLFormElement) {
			composerForm.setAttribute('aria-label', 'Send a message');
		}
		syncChatAttachmentsVisibility();
		syncChatSendButton();
		syncChatMessagePlaceholder();
		syncChatExploreComposerChrome();
	}

	chatApplyComposerStateRef = applyComposerState;

	function markThreadUiPending() {
		const titleEl = root.querySelector('[data-chat-title]');
		if (titleEl instanceof HTMLElement) {
			titleEl.innerHTML = '';
			titleEl.removeAttribute('data-chat-title-label');
			titleEl.setAttribute('data-chat-title-awaiting', '1');
			titleEl.setAttribute('aria-hidden', 'true');
		}
		activeHeaderMeta = null;
		if (mainColumn instanceof HTMLElement) {
			const mobileTitle = mainColumn.querySelector('[data-chat-mobile-chrome-title]');
			const mobileChannel = mobileTitle?.querySelector?.('[data-chat-mobile-chrome-channel]');
			const mobileCanvasWrap = mobileTitle?.querySelector?.('[data-chat-mobile-chrome-canvas-wrap]');
			const mobileCanvas = mobileTitle?.querySelector?.('[data-chat-mobile-chrome-canvas]');
			if (mobileChannel instanceof HTMLElement) mobileChannel.textContent = '';
			if (mobileCanvas instanceof HTMLElement) mobileCanvas.textContent = '';
			if (mobileCanvasWrap instanceof HTMLElement) mobileCanvasWrap.hidden = true;
			if (mobileTitle instanceof HTMLElement) mobileTitle.removeAttribute('aria-label');
		}
	}

	function syncChatBrowseViewBodyClass() {
		if (!document.body) return;
		const on =
			chatExploreCreationsBrowseView &&
			(activePseudoChannelSlug === 'explore' || activePseudoChannelSlug === 'creations');
		document.body.classList.toggle('chat-page--pseudo-browse-view', on);
	}

	syncChatBrowseViewBodyClassRef = syncChatBrowseViewBodyClass;

	function setMobileSidebarMode(open) {
		if (!document.body) return;
		const on = Boolean(open) && shouldShowMobileSidebarFromLocation();
		document.body.classList.toggle('chat-page--mobile-sidebar-open', on);
		try {
			if (on) {
				document.documentElement.classList.add('chat-page--use-app-mobile-header');
			} else {
				const shouldShowAppMobileHeader =
					isChatPageMobileLayout() &&
					shouldUseAppMobileHeaderForChatPath(window.location.pathname);
				document.documentElement.classList.toggle('chat-page--use-app-mobile-header', shouldShowAppMobileHeader);
			}
		} catch {
			// ignore
		}
		const appHeader = document.querySelector('app-navigation');
		const appMobileNav = document.querySelector('app-navigation-mobile');
		const mobileChrome = mainColumn instanceof HTMLElement
			? mainColumn.querySelector('[data-chat-mobile-chrome]')
			: null;
		if (appHeader instanceof HTMLElement) {
			appHeader.hidden = !on;
		}
		if (appMobileNav instanceof HTMLElement) {
			appMobileNav.hidden = !on;
		}
		if (mobileChrome instanceof HTMLElement) {
			mobileChrome.hidden = on;
		}
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

	/** #creations has no chat messages; load handle + avatar from GET /api/profile for feed cards. */
	async function resolveCreationsChannelAuthorHints() {
		const fallback = { ...getViewerChatProfileHints(), displayName: '' };
		try {
			const profileRes = await fetchJsonWithStatusDeduped(
				'/api/profile',
				{ credentials: 'include' },
				{ windowMs: 30000 }
			);
			if (!profileRes.ok || !profileRes.data?.profile) return fallback;
			const p = profileRes.data.profile;
			return {
				handleRaw:
					typeof p.user_name === 'string' && p.user_name.trim()
						? p.user_name.trim()
						: fallback.handleRaw,
				displayName:
					typeof p.display_name === 'string' && p.display_name.trim() ? p.display_name.trim() : '',
				avatarUrl:
					typeof p.avatar_url === 'string' && p.avatar_url.trim()
						? p.avatar_url.trim()
						: fallback.avatarUrl,
			};
		} catch {
			return fallback;
		}
	}

	function mapUserCreatedImageApiRowToFeedItem(img, viewerId, authorHints) {
		const id = img?.id != null ? Number(img.id) : NaN;
		const uid = viewerId != null ? Number(viewerId) : NaN;
		const title =
			typeof img?.title === 'string' && img.title.trim() ? img.title.trim() : 'Untitled';
		const summary = typeof img?.description === 'string' ? img.description : '';
		const url = typeof img?.url === 'string' ? img.url : null;
		const thumb = typeof img?.thumbnail_url === 'string' ? img.thumbnail_url : null;
		const handleRaw = authorHints?.handleRaw != null ? String(authorHints.handleRaw).trim() : '';
		const displayName = authorHints?.displayName != null ? String(authorHints.displayName).trim() : '';
		const avatarUrl = authorHints?.avatarUrl != null ? String(authorHints.avatarUrl).trim() : '';
		const statusRaw = img?.status;
		const status =
			statusRaw == null || statusRaw === ''
				? null
				: typeof statusRaw === 'string'
					? statusRaw.trim()
					: String(statusRaw).trim();
		return {
			created_image_id: Number.isFinite(id) ? id : null,
			id: Number.isFinite(id) ? id : null,
			title,
			summary,
			status,
			image_url: url,
			thumbnail_url: thumb,
			user_id: Number.isFinite(uid) ? uid : null,
			author_user_name: handleRaw,
			author_display_name: displayName,
			author_avatar_url: avatarUrl,
			created_at: img?.created_at ?? null,
			published: img?.published === true || img?.published === 1,
			published_at: img?.published_at ?? null,
			like_count: 0,
			comment_count: 0,
			viewer_liked: false,
			nsfw: !!img?.nsfw,
			media_type: typeof img?.media_type === 'string' ? img.media_type : 'image',
			video_url: typeof img?.video_url === 'string' ? img.video_url : null,
		};
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
				isFounder: chatViewerIsFounder,
				flairSize: 'sm'
			});
			while (avatarWrap.firstChild) metaLine.appendChild(avatarWrap.firstChild);
			const textSpan = document.createElement('span');
			textSpan.className = 'connect-chat-msg-meta-text';
			const nameSpan = document.createElement('span');
			nameSpan.className = `comment-author-name${chatViewerIsFounder ? ' founder-name' : ''}`;
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
		bindInlineVideoClickControls(row);
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

	function paintMobileChromeTitle() {
		const h1 =
			mainColumn instanceof HTMLElement ? mainColumn.querySelector('[data-chat-mobile-chrome-title]') : null;
		const chEl = h1?.querySelector?.('[data-chat-mobile-chrome-channel]');
		const wrap = h1?.querySelector?.('[data-chat-mobile-chrome-canvas-wrap]');
		const cvEl = h1?.querySelector?.('[data-chat-mobile-chrome-canvas]');
		if (!(h1 instanceof HTMLElement) || !(chEl instanceof HTMLElement)) return;
		const titleEl = root.querySelector('[data-chat-title]');
		const awaiting = titleEl?.getAttribute('data-chat-title-awaiting') === '1';
		const channelPart = awaiting ? '' : String(titleEl?.getAttribute('data-chat-title-label') || '').trim();
		chEl.innerHTML = channelPart
			? buildChatHeaderTitleInnerHtml(activeHeaderMeta, channelPart, { mobile: true })
			: '';
		if (wrap instanceof HTMLElement) {
			// Keep mobile header title stable to the channel name; pinned canvas is indicated
			// by the toggle button next to the caret.
			wrap.hidden = true;
			if (cvEl instanceof HTMLElement) cvEl.textContent = '';
		}
		if (channelPart) {
			h1.setAttribute('aria-label', channelPart);
		} else {
			h1.removeAttribute('aria-label');
		}
	}

	function tearDownChatGlobalUnreadBroadcast() {
		if (typeof chatGlobalUnreadBroadcastTeardown === 'function') {
			try {
				chatGlobalUnreadBroadcastTeardown();
			} catch {
				// ignore
			}
		}
		chatGlobalUnreadBroadcastTeardown = null;
		chatGlobalUnreadBroadcastBoundId = null;
	}

	async function maybeBindChatGlobalUnreadBroadcast(viewerId) {
		const id = Number(viewerId);
		if (!Number.isFinite(id) || id <= 0) {
			tearDownChatGlobalUnreadBroadcast();
			return;
		}
		if (chatGlobalUnreadBroadcastBoundId === id && typeof chatGlobalUnreadBroadcastTeardown === 'function') {
			return;
		}
		tearDownChatGlobalUnreadBroadcast();
		try {
			const mod = await import(`../shared/realtimeBroadcast.js${qs}`);
			chatGlobalUnreadBroadcastTeardown = await mod.subscribeUserBroadcast(id, () => {
				void loadChatGlobalUnreadSummary();
			});
			chatGlobalUnreadBroadcastBoundId = id;
		} catch (err) {
			console.warn('[chat] user realtime:', err);
		}
	}

	async function loadChatGlobalUnreadSummary() {
		const wasInitialized = chatGlobalUnreadInitialized;
		const prevUnread = Number.isFinite(chatGlobalUnreadTotal) ? chatGlobalUnreadTotal : 0;
		try {
			const res = await fetch('/api/chat/unread-summary', { credentials: 'include' });
			if (!res.ok) {
				chatGlobalUnreadTotal = 0;
				chatGlobalUnreadInitialized = true;
				tearDownChatGlobalUnreadBroadcast();
				applyChatGlobalUnreadChrome(0);
				return;
			}
			const data = await res.json().catch(() => ({}));
			const n = Number(data?.total_unread);
			chatGlobalUnreadTotal = Number.isFinite(n) ? Math.max(0, n) : 0;
			chatGlobalUnreadInitialized = true;
			const vid = data?.viewer_id != null && Number.isFinite(Number(data.viewer_id)) ? Number(data.viewer_id) : null;
			if (vid != null) {
				void maybeBindChatGlobalUnreadBroadcast(vid);
			}
			if (wasInitialized && chatGlobalUnreadTotal > prevUnread) {
				void playChatUnreadPing();
			}
			applyChatGlobalUnreadChrome(chatGlobalUnreadTotal);
		} catch {
			chatGlobalUnreadTotal = 0;
			chatGlobalUnreadInitialized = true;
			tearDownChatGlobalUnreadBroadcast();
			applyChatGlobalUnreadChrome(0);
		}
	}

	function onChatGlobalUnreadRefreshDoc() {
		void loadChatGlobalUnreadSummary();
	}

	function updateTitleFromMeta(meta) {
		const base = docTitleBase || 'parascene';
		const cs =
			meta?.type === 'channel' && meta?.channel_slug
				? String(meta.channel_slug).toLowerCase().trim()
				: '';
		const pseudoLabel = cs ? rosterMod.getSidebarPseudoChannelTitle(cs) : null;
		let label =
			pseudoLabel && String(pseudoLabel).trim()
				? String(pseudoLabel).trim()
				: '';
		if (!label) {
			label = (meta?.title && String(meta.title).trim())
				? String(meta.title).trim()
				: (cs ? `#${cs}` : 'Chat');
		}
		document.title = `${label} · ${base}`;
		applyChatGlobalUnreadChrome(chatGlobalUnreadTotal);
		const titleEl = root.querySelector('[data-chat-title]');
		activeHeaderMeta = meta || null;
		if (titleEl) {
			titleEl.setAttribute('data-chat-title-label', label);
			titleEl.innerHTML = buildChatHeaderTitleInnerHtml(meta, label, { mobile: false });
			if (String(label).trim()) {
				titleEl.removeAttribute('data-chat-title-awaiting');
				titleEl.removeAttribute('aria-hidden');
			}
		}
		paintMobileChromeTitle();
	}

	function buildChatHeaderAvatarHtml(meta, opts = {}) {
		const mobile = opts?.mobile === true;
		const sizeCls = mobile ? 'chat-page-header-avatar--mobile' : 'chat-page-header-avatar--desktop';
		if (meta?.type === 'dm') {
			const ou = meta?.other_user && typeof meta.other_user === 'object' ? meta.other_user : null;
			const avatarUrl = typeof ou?.avatar_url === 'string' ? ou.avatar_url.trim() : '';
			const displayName =
				(typeof ou?.display_name === 'string' && ou.display_name.trim()) ||
				(typeof ou?.user_name === 'string' && ou.user_name.trim()) ||
				(typeof meta?.title === 'string' && meta.title.trim().startsWith('@')
					? meta.title.trim().slice(1)
					: String(meta?.title || '').trim()) ||
				'User';
			const seed =
				(typeof ou?.user_name === 'string' && ou.user_name.trim()) ||
				(ou?.id != null ? String(ou.id) : '') ||
				displayName;
			const bg = escapeHtml(getAvatarColor(seed));
			if (avatarUrl) {
				return `<span class="chat-page-header-avatar ${sizeCls}" aria-hidden="true"><img class="chat-page-header-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async"></span>`;
			}
			const glyph = escapeHtml(String(displayName || 'U').trim().charAt(0).toUpperCase() || 'U');
			return `<span class="chat-page-header-avatar chat-page-header-avatar--fallback ${sizeCls}" style="background: ${bg};" data-chat-header-avatar-glyph="${glyph}" aria-hidden="true"></span>`;
		}
		const slugRaw = typeof meta?.channel_slug === 'string' ? meta.channel_slug.trim().toLowerCase() : '';
		if (slugRaw && rosterMod.SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slugRaw)) {
			const iconHtml = rosterMod.getPseudoStripRouteIconHtml(slugRaw, 'chat-page-header-route-icon');
			if (iconHtml) {
				return `<span class="chat-page-header-avatar chat-page-header-avatar--pseudo-strip ${sizeCls}" aria-hidden="true">${iconHtml}</span>`;
			}
		}
		const seed = slugRaw || String(meta?.title || 'channel').trim().toLowerCase() || 'channel';
		const bg = escapeHtml(getAvatarColor(seed));
		return `<span class="chat-page-header-avatar chat-page-header-avatar--channel ${sizeCls}" style="background: ${bg};" data-chat-header-avatar-glyph="#" aria-hidden="true"></span>`;
	}

	function buildChatHeaderTitleInnerHtml(meta, label, opts = {}) {
		const avatarHtml = buildChatHeaderAvatarHtml(meta, opts);
		return `${avatarHtml}<span class="chat-page-header-title-text">${escapeHtml(label)}</span>`;
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
						if (p && typeof p.catch === 'function') p.catch(() => { });
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

	function chatAttachmentPreviewKindFromHref(href) {
		try {
			const u = new URL(String(href || ''), window.location.origin);
			let name = String(u.searchParams.get('name') || '').trim();
			if (!name) {
				const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
				name = decodeURIComponent(seg);
			}
			const idx = name.lastIndexOf('.');
			const ext = idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
			if (['mp4', 'mov', 'm4v', 'webm', 'ogg', 'ogv'].includes(ext)) return 'video';
			if (['html', 'htm'].includes(ext)) return 'html';
			return null;
		} catch {
			return null;
		}
	}

	function chatAttachmentPreviewNameFromHref(href) {
		try {
			const u = new URL(String(href || ''), window.location.origin);
			let name = String(u.searchParams.get('name') || '').trim();
			if (!name) {
				const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
				name = decodeURIComponent(seg);
			}
			return name || 'video';
		} catch {
			return 'video';
		}
	}

	function openChatAttachmentPreviewLightbox(src, kind) {
		const url = String(src || '').trim();
		if (!url) return;
		closeReactionPicker();
		closeChatInlineImageLightbox();

		const overlay = document.createElement('div');
		overlay.className = 'chat-inline-image-lightbox';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', kind === 'video' ? 'Video' : 'Preview');

		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'chat-inline-image-lightbox-close';
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.textContent = '×';

		const frame = document.createElement('div');
		frame.className = 'chat-inline-image-lightbox-frame';

		if (kind === 'video') {
			const shell = document.createElement('div');
			shell.className = 'chat-inline-image-lightbox-video-shell';
			const bar = document.createElement('div');
			bar.className = 'connect-chat-creation-embed-media-hover-bar connect-chat-creation-embed-media-hover-bar--static';
			const main = document.createElement('div');
			main.className = 'connect-chat-creation-embed-hover-bar-main';
			const title = document.createElement('span');
			title.className = 'connect-chat-creation-embed-hover-bar-title';
			title.textContent = chatAttachmentPreviewNameFromHref(url);
			main.appendChild(title);
			const open = document.createElement('a');
			open.className = 'connect-chat-creation-embed-detail-link connect-chat-creation-embed-detail-link--hover-bar user-link creation-link';
			open.href = url;
			open.target = '_blank';
			open.rel = 'noopener noreferrer';
			open.setAttribute('aria-label', 'Open video');
			open.setAttribute('title', 'Open video');
			open.innerHTML = linkIcon2();
			bar.appendChild(main);
			bar.appendChild(open);
			const video = document.createElement('video');
			video.className = 'chat-inline-image-lightbox-video';
			video.controls = true;
			video.playsInline = true;
			video.loop = true;
			video.setAttribute('loop', '');
			video.preload = 'metadata';
			video.src = url;
			shell.appendChild(bar);
			shell.appendChild(video);
			frame.appendChild(shell);
		} else {
			const iframe = document.createElement('iframe');
			iframe.className = 'chat-inline-image-lightbox-iframe';
			iframe.setAttribute('sandbox', 'allow-scripts allow-downloads');
			iframe.setAttribute('referrerpolicy', 'no-referrer');
			iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark light"><style>html,body{margin:0;height:100%;background:#000;}@media (prefers-color-scheme: light){html,body{background:#fff;}}</style></head><body></body></html>';
			frame.appendChild(iframe);
			void (async () => {
				try {
					const res = await fetch(url, { credentials: 'include' });
					const html = await res.text();
					if (res.ok) iframe.srcdoc = html;
				} catch {
					// ignore
				}
			})();
		}

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
			chatViewerIsFounder = cached.viewerIsFounder === true;
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
		chatViewerIsFounder = Boolean(result.data?.viewer_is_founder);
		if (chatViewerId != null && Number.isFinite(chatViewerId)) {
			try {
				writeCachedChatThreads?.(chatViewerId, chatThreads, {
					viewerIsAdmin: chatViewerIsAdmin,
					viewerIsFounder: chatViewerIsFounder
				});
			} catch {
				// ignore
			}
		}
		return { fromCache: Boolean(cached), fromNetwork: true };
	}

	function normalizePathForCompare(p) {
		return rosterMod.normalizeChatNavPathForCompare(p);
	}

	function isChatHrefActive(href) {
		return rosterMod.isChatPseudoStripHrefActive(href);
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

	async function fetchPresenceOnlineSnapshot() {
		try {
			const res = await fetch('/api/presence/online', { credentials: 'include' });
			if (!res.ok) {
				return { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
			}
			const data = await res.json().catch(() => ({}));
			const users = Array.isArray(data.users) ? data.users : [];
			const onlineIds = new Set();
			const lastSeenMsByUserId = new Map();
			for (const u of users) {
				const id = Number(u.user_id);
				if (!Number.isFinite(id) || id <= 0) continue;
				onlineIds.add(id);
				const ms = Date.parse(String(u?.presence_last_seen_at || ''));
				if (Number.isFinite(ms)) {
					lastSeenMsByUserId.set(id, ms);
					dmLastSeenOnlineAtByUserId.set(id, ms);
				}
			}
			return { onlineIds, lastSeenMsByUserId };
		} catch {
			return { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
		}
	}

	async function fetchPresenceLastActiveSnapshot(userIds) {
		const ids = Array.isArray(userIds)
			? [...new Set(userIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))]
			: [];
		if (ids.length === 0) return new Map();
		try {
			const res = await fetch('/api/presence/last-active', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_ids: ids })
			});
			if (!res.ok) return new Map();
			const data = await res.json().catch(() => ({}));
			const users = Array.isArray(data.users) ? data.users : [];
			const out = new Map();
			for (const u of users) {
				const id = Number(u?.user_id);
				if (!Number.isFinite(id) || id <= 0) continue;
				const activeMs = Date.parse(String(u?.last_active_at || ''));
				const presenceMs = Date.parse(String(u?.presence_last_seen_at || ''));
				const a = Number.isFinite(activeMs) ? activeMs : 0;
				const p = Number.isFinite(presenceMs) ? presenceMs : 0;
				const best = Math.max(a, p);
				if (best > 0) out.set(id, best);
			}
			return out;
		} catch {
			return new Map();
		}
	}

	function collectDmOtherUserIdsForPresence(threads) {
		const list = Array.isArray(threads) ? threads : [];
		const ids = [];
		for (const t of list) {
			if (!t || t.type !== 'dm') continue;
			const oid = Number(rosterMod.getDmOtherUserId(t));
			if (!Number.isFinite(oid) || oid <= 0) continue;
			if (chatViewerId != null && Number.isFinite(Number(chatViewerId)) && Number(oid) === Number(chatViewerId)) {
				continue;
			}
			ids.push(oid);
		}
		return [...new Set(ids)];
	}

	/** For DM sidebar notes-to-self row (title + avatar when thread not created yet). */
	async function fetchChatViewerProfileMini() {
		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/profile',
				{ credentials: 'include' },
				{ windowMs: 2000 }
			);
			if (!result.ok) return null;
			const user = result.data;
			if (!user?.email) return null;
			const prof = user?.profile && typeof user.profile === 'object' ? user.profile : {};
			const display_name =
				typeof prof.display_name === 'string' && prof.display_name.trim()
					? prof.display_name.trim()
					: null;
			const user_name =
				typeof prof.user_name === 'string' && prof.user_name.trim()
					? prof.user_name.trim()
					: null;
			const avatar_url =
				typeof prof.avatar_url === 'string' && prof.avatar_url.trim()
					? prof.avatar_url.trim()
					: null;
			return { display_name, user_name, avatar_url };
		} catch {
			return null;
		}
	}

	/** Desktop sidebar footer: current user; opens same menu as header profile (open-profile). */
	async function syncChatSidebarViewerRow() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		const row = sidebar?.querySelector?.('[data-chat-sidebar-user-row]');
		const avatarEl = sidebar?.querySelector?.('[data-chat-sidebar-user-avatar]');
		const labelEl = sidebar?.querySelector?.('[data-chat-sidebar-user-label]');
		const btn = sidebar?.querySelector?.('[data-chat-sidebar-open-profile]');
		const notifyBtn = sidebar?.querySelector?.('[data-chat-sidebar-open-notifications]');
		const notifyIconEl = sidebar?.querySelector?.('[data-chat-sidebar-notify-icon]');
		const notifyBadgeEl = sidebar?.querySelector?.('[data-chat-sidebar-notify-badge]');
		const creditBtn = sidebar?.querySelector?.('[data-chat-sidebar-open-credits]');
		const creditIconEl = sidebar?.querySelector?.('[data-chat-sidebar-credit-icon]');
		const creditCountEl = sidebar?.querySelector?.('[data-chat-sidebar-credit-count]');
		if (!row || !avatarEl || !labelEl || !btn) return;
		if (notifyIconEl instanceof HTMLElement && !notifyIconEl.innerHTML.trim()) {
			notifyIconEl.innerHTML = notifyIcon('icon');
		}
		if (creditIconEl instanceof HTMLElement && !creditIconEl.innerHTML.trim()) {
			creditIconEl.innerHTML = creditIcon('icon');
		}

		function parseCreditsCount(value) {
			const count = Number(value);
			if (!Number.isFinite(count)) return 0;
			return Math.max(0, Math.round(count * 10) / 10);
		}

		function updateSidebarCreditsUI(value) {
			if (!(creditCountEl instanceof HTMLElement)) return;
			const normalized = parseCreditsCount(value);
			const wholePart = Math.floor(normalized);
			const decimalPart = normalized - wholePart;
			creditCountEl.textContent = decimalPart > 0 ? `${wholePart}+` : String(wholePart);
			if (creditBtn instanceof HTMLButtonElement) {
				creditBtn.setAttribute('aria-label', `Open credits (${creditCountEl.textContent})`);
			}
		}

		function updateSidebarNotificationsUI(count) {
			if (!(notifyBadgeEl instanceof HTMLElement)) return;
			const n = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
			if (n > 0) {
				notifyBadgeEl.textContent = n > 99 ? '99+' : String(n);
				notifyBadgeEl.classList.add('has-unread');
				if (notifyBtn instanceof HTMLButtonElement) {
					notifyBtn.setAttribute('aria-label', `${n} unread notifications`);
				}
				return;
			}
			notifyBadgeEl.textContent = '';
			notifyBadgeEl.classList.remove('has-unread');
			if (notifyBtn instanceof HTMLButtonElement) {
				notifyBtn.setAttribute('aria-label', 'Open notifications');
			}
		}

		async function loadSidebarNotificationsCount({ force = false } = {}) {
			try {
				const result = await fetchJsonWithStatusDeduped(
					'/api/notifications/unread-count',
					{ credentials: 'include' },
					{ windowMs: force ? 0 : 2000 }
				);
				if (!result.ok) {
					updateSidebarNotificationsUI(0);
					return;
				}
				updateSidebarNotificationsUI(result.data?.count || 0);
			} catch {
				updateSidebarNotificationsUI(0);
			}
		}

		const vid = chatViewerId;
		if (vid == null || !Number.isFinite(Number(vid))) {
			row.hidden = true;
			return;
		}

		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/profile',
				{ credentials: 'include' },
				{ windowMs: 2000 }
			);
			if (!result.ok) {
				row.hidden = true;
				return;
			}
			const user = result.data;
			if (!user?.email) {
				row.hidden = true;
				return;
			}
			const prof = user?.profile && typeof user.profile === 'object' ? user.profile : {};
			const displayName =
				(typeof prof.display_name === 'string' && prof.display_name.trim()) ||
				(typeof prof.user_name === 'string' && prof.user_name.trim()) ||
				'Account';
			const handle =
				(typeof prof.user_name === 'string' && prof.user_name.trim()) || String(vid);
			const avatarUrlRaw =
				typeof prof.avatar_url === 'string' && prof.avatar_url.trim()
					? prof.avatar_url.trim()
					: '';
			if (!chatSidebarViewerAvatarUrlPinned && avatarUrlRaw) {
				chatSidebarViewerAvatarUrlPinned = avatarUrlRaw;
			}
			const avatarUrl = chatSidebarViewerAvatarUrlPinned || avatarUrlRaw;
			const avatarHtml = renderCommentAvatarHtml({
				avatarUrl,
				displayName: displayName || handle,
				color: getAvatarColor(handle),
				href: '',
				isFounder: user?.plan === 'founder',
				flairSize: 'sm'
			});
			if (avatarEl.innerHTML !== avatarHtml) {
				avatarEl.innerHTML = avatarHtml;
			}
			labelEl.textContent = displayName;
			btn.setAttribute('aria-label', `Account: ${displayName}`);
			updateSidebarCreditsUI(user?.credits);
			void loadSidebarNotificationsCount();
			row.hidden = false;
			const notificationsUpdatedHandler = () => {
				void loadSidebarNotificationsCount({ force: true });
			};
			if (sidebar && !sidebar.dataset.notificationsBound) {
				sidebar.dataset.notificationsBound = '1';
				document.addEventListener('notifications-acknowledged', notificationsUpdatedHandler);
				document.addEventListener('credits-updated', (event) => {
					updateSidebarCreditsUI(event?.detail?.count);
				});
			}
		} catch {
			row.hidden = true;
		}
	}

	/** Joined servers + presence + profile for roster; start early so it can overlap `loadChatThreads` / messages. */
	let sidebarRosterPrefetchPack = null;
	function resetSidebarRosterPrefetch() {
		sidebarRosterPrefetchPack = null;
	}
	function ensureSidebarRosterPrefetchStarted() {
		if (!sidebarRosterPrefetchPack) {
			sidebarRosterPrefetchPack = {
				joined: fetchJoinedServersForChat(),
				presence: fetchPresenceOnlineSnapshot(),
				profileMini: fetchChatViewerProfileMini()
			};
		}
		return sidebarRosterPrefetchPack;
	}

	async function refreshChatSidebar(options = {}) {
		const skipThreads = options.skipThreadsFetch === true;
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;
		const chEl = sidebar.querySelector('[data-chat-sidebar-channels]');
		const dmEl = sidebar.querySelector('[data-chat-sidebar-users]');
		const svEl = sidebar.querySelector('[data-chat-sidebar-servers]');
		if (!chEl || !dmEl || !svEl) {
			await syncChatSidebarViewerRow();
			return;
		}

		// Phase 1: fast paint from cache (no extra fetches) if we have nothing rendered yet.
		if (!skipThreads && (chatThreads || []).length === 0) {
			try {
				await loadChatThreads({ allowCache: true, forceNetwork: false });
			} catch {
				// ignore: we'll handle on the network attempt below
			}
		}

		const deps = { renderCommentAvatarHtml, getAvatarColor };
		function captureSectionExpandedState(sectionEl) {
			if (!(sectionEl instanceof HTMLElement)) return false;
			const block = sectionEl.querySelector('[data-chat-sidebar-collapsible]');
			return block instanceof HTMLElement && block.classList.contains('is-expanded');
		}

		function applySectionExpandedState(sectionEl, expanded) {
			if (!expanded || !(sectionEl instanceof HTMLElement)) return;
			const block = sectionEl.querySelector('[data-chat-sidebar-collapsible]');
			if (!(block instanceof HTMLElement)) return;
			const rest = block.querySelector('.chat-page-sidebar-collapsible-rest');
			const moreBtn = block.querySelector('[data-chat-collapsible="more"]');
			const lessBtn = block.querySelector('[data-chat-collapsible="less"]');
			if (rest instanceof HTMLElement) rest.hidden = false;
			block.classList.add('is-expanded');
			moreBtn?.setAttribute('aria-expanded', 'true');
			lessBtn?.setAttribute('aria-expanded', 'true');
		}
		/**
		 * Same roster as Connect: merge threads + joined-server channel stubs, then split into
		 * sections for layout only (DMs / server-linked channels / other channels).
		 */
		const render = (threads, joined, presenceSnapshot, viewerProfile) => {
			const dmExpanded = captureSectionExpandedState(dmEl);
			const svExpanded = captureSectionExpandedState(svEl);
			const chExpanded = captureSectionExpandedState(chEl);
			const threadsArr = Array.isArray(threads) ? threads : [];
			const joinedArr = Array.isArray(joined) ? joined : [];
			const onlineIds = presenceSnapshot?.onlineIds instanceof Set ? presenceSnapshot.onlineIds : new Set();
			const lastSeenMsByUserId =
				presenceSnapshot?.lastSeenMsByUserId instanceof Map
					? presenceSnapshot.lastSeenMsByUserId
					: new Map();
			const lastActiveMsByUserId =
				presenceSnapshot?.lastActiveMsByUserId instanceof Map
					? presenceSnapshot.lastActiveMsByUserId
					: new Map();
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
			const dmsRaw = merged.filter((t) => t && t.type === 'dm').map((t) => {
				if (!t || t.type !== 'dm') return t;
				const ou = t.other_user && typeof t.other_user === 'object' ? t.other_user : null;
				const oid = rosterMod.getDmOtherUserId(t);
				const pinnedAvatarUrl = getPinnedSidebarDmAvatarUrl(oid, ou?.avatar_url);
				if (!ou) return t;
				const currentAvatar = typeof ou.avatar_url === 'string' ? ou.avatar_url.trim() : '';
				if (currentAvatar === pinnedAvatarUrl) return t;
				return {
					...t,
					other_user: {
						...ou,
						avatar_url: pinnedAvatarUrl || null
					}
				};
			});
			const dmsNorm = rosterMod.normalizeDmListWithSelfFirst(dmsRaw, chatViewerId, viewerProfile);
			const isDmOnlineForSidebar = (t) => {
				if (!t || t.type !== 'dm') return false;
				const selfDm = rosterMod.isSelfDmThread(t, chatViewerId);
				if (selfDm) return true;
				const oid = rosterMod.getDmOtherUserId(t);
				return isDmConsideredOnlineWithGrace(oid, onlineIds);
			};
			const dmLastActiveMsForSidebar = (t) => {
				if (!t || t.type !== 'dm') return 0;
				if (rosterMod.isSelfDmThread(t, chatViewerId)) return Date.now();
				const oid = rosterMod.getDmOtherUserId(t);
				const id = Number(oid);
				if (!Number.isFinite(id) || id <= 0) return 0;
				const fromLastActive = Number(lastActiveMsByUserId.get(id));
				if (Number.isFinite(fromLastActive) && fromLastActive > 0) return fromLastActive;
				const fromSnapshot = Number(lastSeenMsByUserId.get(id));
				if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) return fromSnapshot;
				const fromGrace = Number(dmLastSeenOnlineAtByUserId.get(id));
				if (Number.isFinite(fromGrace) && fromGrace > 0) return fromGrace;
				return 0;
			};
			const dmLastInteractedMsForSidebar = (t) => {
				if (!t || t.type !== 'dm') return 0;
				const createdAt = t?.last_message?.created_at;
				const ms = Date.parse(String(createdAt || ''));
				return Number.isFinite(ms) ? ms : 0;
			};
			const dmDomKeyForSidebarRow = (t) => {
				if (!t || t.type !== 'dm') return '';
				const stable = rosterMod.dmStablePinStorageKey(t);
				if (stable) return stable;
				const oid = Number(rosterMod.getDmOtherUserId(t));
				if (Number.isFinite(oid) && oid > 0) return `dm:${oid}`;
				const id = Number(t.id);
				if (Number.isFinite(id) && id > 0) return `thread:${id}`;
				return '';
			};
			const dmsPinned = rosterMod.sortDmsWithPinnedOrder(dmsNorm, chatViewerId);
			// Single explicit ordering point for sidebar DMs before HTML rendering.
			const dms = prioritizeOnlineDmsInVisibleWindow(dmsPinned, {
				visibleCap: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP,
				isOnline: isDmOnlineForSidebar,
					getLastSeenMs: dmLastActiveMsForSidebar,
				getLastInteractedMs: dmLastInteractedMsForSidebar
			});
			const channelRowsRaw = merged.filter((t) => t && t.type === 'channel');
			const serverChannelsRaw = channelRowsRaw.filter((t) => {
				const slug =
					typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
				if (slug && rosterMod.SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) return false;
				return Boolean(slug && joinedSlugs.has(slug));
			});
			const otherChannelsRaw = channelRowsRaw.filter((t) => {
				const slug =
					typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
				if (slug && rosterMod.SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) return false;
				return !slug || !joinedSlugs.has(slug);
			});
			const serverChannels = rosterMod.sortChannelRowsByLastActivity(serverChannelsRaw);
			const otherChannels = rosterMod.sortChannelRowsByLastActivity(otherChannelsRaw);

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

			function rowHtml(t, rowOpts) {
				const href = rosterMod.buildChatThreadUrl(t);
				const active = isChatHrefActive(href);
				const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
				const avatarHtml = rosterMod.buildChatThreadRowAvatarHtml(t, deps);
				const selfDm = rosterMod.isSelfDmThread(t, chatViewerId);
				let presenceClass = '';
				if (t.type === 'dm') {
					const online = isDmOnlineForSidebar(t);
					presenceClass = online ? 'is-online' : 'is-offline';
				}
				const activeClass = active ? ' is-active' : '';
				const pc = presenceClass ? ` ${presenceClass}` : '';
				const extraRow =
					rowOpts &&
						typeof rowOpts.extraAnchorClasses === 'string' &&
						rowOpts.extraAnchorClasses.trim()
						? ` ${rowOpts.extraAnchorClasses.trim()}`
						: '';
				const unc = Number(t.unread_count);
				const showUnread =
					!active && Number.isFinite(unc) && unc > 0;
				const unreadLabel = unc > 99 ? '99+' : String(unc);
				const unreadHtml = showUnread
					? `<span class="chat-page-sidebar-unread" aria-label="${unc} unread">${escapeHtml(unreadLabel)}</span>`
					: '';
				const youPill = selfDm
					? '<span class="chat-page-sidebar-you-pill" aria-label="This is you">you</span>'
					: '';
				const dmHoverMetaAttr =
					t.type === 'dm' && !selfDm
						? ` data-chat-dm-hover-meta="1" data-chat-dm-last-interacted-ms="${escapeHtml(
							String(quantizeSidebarHoverMs(dmLastInteractedMsForSidebar(t)))
						)}" data-chat-dm-last-seen-ms="${escapeHtml(String(quantizeSidebarHoverMs(dmLastActiveMsForSidebar(t))))}"`
						: '';
				const dataPseudoSlugAttr =
					rowOpts &&
						typeof rowOpts.pseudoSlug === 'string' &&
						rowOpts.pseudoSlug.trim()
						? ` data-chat-pseudo-slug="${escapeHtml(rowOpts.pseudoSlug.trim().toLowerCase())}"`
						: '';
				const dataHelpAttr = t?.type === 'sidebar_help' ? ' data-chat-sidebar-help="1"' : '';
				const dmDomKey = dmDomKeyForSidebarRow(t);
				const dataDmKeyAttr = dmDomKey ? ` data-chat-dm-key="${escapeHtml(dmDomKey)}"` : '';
				const pinKey =
					t.type === 'dm' && !selfDm ? rosterMod.dmStablePinStorageKey(t) : null;
				if (pinKey) {
					const ou = t.other_user;
					const oid =
						ou?.id != null ? Number(ou.id) : Number(rosterMod.getDmOtherUserId(t));
					const otherUserIdAttr =
						Number.isFinite(oid) && oid > 0 ? String(oid) : '';
					const profileHref =
						buildProfilePath({
							userName: typeof ou?.user_name === 'string' ? ou.user_name : undefined,
							userId: Number.isFinite(oid) && oid > 0 ? oid : undefined
						}) || (otherUserIdAttr ? `/user/${otherUserIdAttr}` : '/user');
					const profileHrefAttr = escapeHtml(profileHref);
					return `<div class="chat-page-sidebar-row chat-page-sidebar-row--dm-with-menu${activeClass}${pc}${extraRow}"${dataPseudoSlugAttr}${dataDmKeyAttr}>
					<a class="chat-page-sidebar-row-link" href="${escapeHtml(href)}">
					${avatarHtml}
					<div class="chat-page-sidebar-row-body">
						<div class="chat-page-sidebar-row-title-line">
							<span class="chat-page-sidebar-row-title"${dmHoverMetaAttr}>${escapeHtml(title)}</span>
							${youPill}
							${unreadHtml}
						</div>
					</div>
					</a>
					<button type="button" class="chat-page-sidebar-server-settings chat-page-sidebar-dm-menu-btn" data-chat-dm-menu="${escapeHtml(pinKey)}" data-chat-dm-profile-href="${profileHrefAttr}" data-chat-dm-other-user-id="${escapeHtml(otherUserIdAttr)}" aria-label="Direct message options" aria-haspopup="menu" aria-expanded="false">${chatSidebarServerGearSvg}</button>
				</div>`;
				}
				return `<a class="chat-page-sidebar-row${activeClass}${pc}${extraRow}" href="${escapeHtml(href)}"${dataPseudoSlugAttr}${dataHelpAttr}${dataDmKeyAttr}>
					${avatarHtml}
					<div class="chat-page-sidebar-row-body">
						<div class="chat-page-sidebar-row-title-line">
							<span class="chat-page-sidebar-row-title"${dmHoverMetaAttr}>${escapeHtml(title)}</span>
							${youPill}
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

			/**
			 * When SSR already rendered the pseudo strip (same rows/hrefs), update active/unread in place
			 * instead of replacing innerHTML — avoids a visible layout jump on first hydrate.
			 * Avatars are left as SSR’d; swapping identical markup caused a visible flash.
			 */
			function tryPatchPseudoStripInPlace(listEl, stripRows) {
				return rosterMod.tryPatchPseudoStripDomInPlace(listEl, stripRows, {
					normalizePathForCompare,
					isChatHrefActive
				});
			}

			/* Pseudo strip is built on first paint by SSR (`{{CHAT_SIDEBAR_PSEUDO_STRIP_LIST}}`).
			   Runtime pass updates active/unread state only; no list rebuilds here. */
			const pseudoListEl = sidebar.querySelector('[data-chat-sidebar-pseudo-list]');
			if (pseudoListEl) {
				const stripRows = rosterMod.getSidebarPseudoStripRowsMerged(channelRowsRaw);
				tryPatchPseudoStripInPlace(pseudoListEl, stripRows);
			}

			const dmHtml = rosterMod.buildChatSidebarDmListHtml(dms, rowHtml);
			const svHtml = rosterMod.buildCollapsibleChatSidebarListHtml(
				serverChannels,
				serverRowHtml,
				'<p class="chat-page-sidebar-empty">No servers joined yet.</p>'
			);
			const chHtml = rosterMod.buildCollapsibleChatSidebarListHtml(
				otherChannels,
				rowHtml,
				'<p class="chat-page-sidebar-empty">No channels yet.</p>'
			);
			const dmChanged = chatSidebarLastDmHtml !== dmHtml;
			const svChanged = chatSidebarLastServersHtml !== svHtml;
			const chChanged = chatSidebarLastChannelsHtml !== chHtml;
			if (dmChanged) {
				/** @type {Map<string, HTMLElement>} */
				const preservedDmAvatars = new Map();
				dmEl.querySelectorAll('[data-chat-dm-key]').forEach((row) => {
					if (!(row instanceof HTMLElement)) return;
					const key = String(row.getAttribute('data-chat-dm-key') || '').trim();
					if (!key) return;
					const avatar = row.querySelector(
						':scope > .comment-avatar, :scope > .chat-page-sidebar-channel-avatar, :scope > .chat-page-sidebar-row-link > .comment-avatar, :scope > .chat-page-sidebar-row-link > .chat-page-sidebar-channel-avatar'
					);
					if (avatar instanceof HTMLElement) preservedDmAvatars.set(key, avatar);
				});
				// Build off-DOM so image nodes in new HTML never connect unless actually needed.
				const tpl = document.createElement('template');
				tpl.innerHTML = dmHtml;
				tpl.content.querySelectorAll('[data-chat-dm-key]').forEach((row) => {
					if (!(row instanceof HTMLElement)) return;
					const key = String(row.getAttribute('data-chat-dm-key') || '').trim();
					if (!key) return;
					const preserved = preservedDmAvatars.get(key);
					if (!(preserved instanceof HTMLElement)) return;
					const avatarHost = row.querySelector(
						':scope > .comment-avatar, :scope > .chat-page-sidebar-channel-avatar, :scope > .chat-page-sidebar-row-link > .comment-avatar, :scope > .chat-page-sidebar-row-link > .chat-page-sidebar-channel-avatar'
					);
					if (avatarHost instanceof HTMLElement && avatarHost !== preserved) {
						avatarHost.replaceWith(preserved);
					}
				});
				dmEl.replaceChildren(tpl.content);
				chatSidebarLastDmHtml = dmHtml;
			}
			if (svChanged) {
				svEl.innerHTML = svHtml;
				chatSidebarLastServersHtml = svHtml;
			}
			if (chChanged) {
				chEl.innerHTML = chHtml;
				chatSidebarLastChannelsHtml = chHtml;
			}
			if (dmChanged) applySectionExpandedState(dmEl, dmExpanded);
			if (svChanged) applySectionExpandedState(svEl, svExpanded);
			if (chChanged) applySectionExpandedState(chEl, chExpanded);
		};

		/** Keep `.chat-page-sidebar-scroll` position stable when DMs / servers / channels lists re-render. */
		function runRender(threads, joined, presenceSnapshot, viewerProfile) {
			const scrollEl = sidebar.querySelector('.chat-page-sidebar-scroll');
			const prevTop = scrollEl ? scrollEl.scrollTop : 0;
			render(threads, joined, presenceSnapshot, viewerProfile);
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
			const pack = ensureSidebarRosterPrefetchStarted();
			const dmUserIds = collectDmOtherUserIdsForPresence(chatThreads || []);
			const [joined, presenceOnlineSnapshot, viewerProfile, lastActiveMsByUserId] = await Promise.all([
				pack.joined,
				pack.presence,
				pack.profileMini,
				fetchPresenceLastActiveSnapshot(dmUserIds)
			]);
			const presenceSnapshot = {
				...(presenceOnlineSnapshot || {}),
				lastActiveMsByUserId
			};
			runRender(chatThreads || [], joined, presenceSnapshot, viewerProfile);
			await syncChatSidebarViewerRow();
			return;
		}

		try {
			resetSidebarRosterPrefetch();
			const [_, joined, presenceOnlineSnapshot, viewerProfile] = await Promise.all([
				loadChatThreads({ allowCache: true, forceNetwork: true }),
				fetchJoinedServersForChat(),
				fetchPresenceOnlineSnapshot(),
				fetchChatViewerProfileMini()
			]);
			const dmUserIds = collectDmOtherUserIdsForPresence(chatThreads || []);
			const lastActiveMsByUserId = await fetchPresenceLastActiveSnapshot(dmUserIds);
			const presenceSnapshot = {
				...(presenceOnlineSnapshot || {}),
				lastActiveMsByUserId
			};
			runRender(chatThreads || [], joined, presenceSnapshot, viewerProfile);
			dispatchChatUnreadRefresh();
		} catch {
			// If network fails, keep cached render.
		}
		await syncChatSidebarViewerRow();
	}

	function setupChatSidebarClientNav() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;

		chatSidebarNavClickHandler = (e) => {
			hideChatSidebarDmHoverPopover();
			const collapsibleBtn = e.target?.closest?.('[data-chat-collapsible]');
			if (collapsibleBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				rosterMod.toggleChatSidebarCollapsibleList(collapsibleBtn);
				return;
			}
			const profileBtn = e.target?.closest?.('[data-chat-sidebar-open-profile]');
			if (profileBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent('open-profile'));
				return;
			}
			const notificationsBtn = e.target?.closest?.('[data-chat-sidebar-open-notifications]');
			if (notificationsBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent('open-notifications'));
				return;
			}
			const creditsBtn = e.target?.closest?.('[data-chat-sidebar-open-credits]');
			if (creditsBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent('open-credits'));
				return;
			}
			const dmGearBtn = e.target?.closest?.('.chat-page-sidebar-dm-menu-btn[data-chat-dm-menu]');
			if (dmGearBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				openDmSidebarGearMenu(dmGearBtn, {
					onAfterPinChange: () => void refreshChatSidebar({ skipThreadsFetch: true })
				});
				return;
			}
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
			setMobileSidebarMode(false);
			markThreadUiPending();
			history.pushState({ prsnChat: true }, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
			void openThreadForCurrentPath();
		};
		sidebar.addEventListener('click', chatSidebarNavClickHandler);
		chatSidebarDmHoverOverHandler = (e) => {
			const canHover = window.matchMedia?.('(hover: hover)')?.matches !== false;
			if (!canHover) return;
			const t = e.target?.closest?.('.chat-page-sidebar-row-title[data-chat-dm-hover-meta]');
			if (!(t instanceof HTMLElement)) return;
			if (chatSidebarDmHoverActiveAnchor === t && chatSidebarDmHoverPopoverEl && !chatSidebarDmHoverPopoverEl.hidden) {
				return;
			}
			showChatSidebarDmHoverPopover(t);
		};
		chatSidebarDmHoverOutHandler = (e) => {
			const t = e.target?.closest?.('.chat-page-sidebar-row-title[data-chat-dm-hover-meta]');
			if (!(t instanceof HTMLElement)) return;
			const toEl = e.relatedTarget instanceof Element ? e.relatedTarget : null;
			if (toEl && (t.contains(toEl) || chatSidebarDmHoverPopoverEl?.contains(toEl))) return;
			hideChatSidebarDmHoverPopover();
		};
		sidebar.addEventListener('mouseover', chatSidebarDmHoverOverHandler);
		sidebar.addEventListener('mouseout', chatSidebarDmHoverOutHandler);

		chatSidebarPopstateHandler = () => {
			void openThreadForCurrentPath();
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
				markThreadUiPending();
				history.pushState({ prsnChat: true }, '', path);
				void openThreadForCurrentPath();
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
		const latest = rows[0];
		if (latest) {
			latest.setAttribute('data-comments-channel-latest', '1');
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
		const canvasMeta = getChatCanvasMetaFromMessage(m);
		const safeBody = processUserText(m.body ?? '');
		const bubble = document.createElement('div');
		bubble.className = 'connect-chat-msg-bubble';
		if (canvasMeta) {
			bubble.classList.add('connect-chat-msg-bubble--canvas');
			const preview = processUserText(m.body ?? '');
			bubble.innerHTML = `<div class="connect-chat-canvas-inline"><div class="connect-chat-canvas-inline-title">${escapeHtml(canvasMeta.title)}</div><div class="connect-chat-canvas-inline-preview">${preview}</div></div>`;
		} else {
			bubble.innerHTML = safeBody;
		}
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
			const senderIsFounder = m.sender_plan === 'founder';
			const avatarWrap = document.createElement('div');
			avatarWrap.innerHTML = renderCommentAvatarHtml({
				avatarUrl: m.sender_avatar_url || '',
				displayName: displayForAvatar,
				color: getAvatarColor(handleRaw || String(senderId)),
				href: profileHref || undefined,
				isFounder: senderIsFounder,
				flairSize: 'sm'
			});
			while (avatarWrap.firstChild) {
				metaLine.appendChild(avatarWrap.firstChild);
			}
			const textSpan = document.createElement('span');
			textSpan.className = 'connect-chat-msg-meta-text';
			const nameSpan = document.createElement('span');
			nameSpan.className = `comment-author-name${senderIsFounder ? ' founder-name' : ''}`;
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
		pseudoColumnPager = null;
		disconnectCommentsChannelLoadObserver();
	}

	function disconnectFeedChannelLoadObserver() {
		if (feedChannelLoadMoreObserver) {
			try {
				feedChannelLoadMoreObserver.disconnect();
			} catch {
				// ignore
			}
			feedChannelLoadMoreObserver = null;
		}
	}

	function teardownFeedChannelLoadMore() {
		pseudoColumnPager = null;
		disconnectFeedChannelLoadObserver();
		if (feedChannelVideoObserver) {
			try {
				feedChannelVideoObserver.disconnect();
			} catch {
				// ignore
			}
			feedChannelVideoObserver = null;
		}
	}

	function teardownExploreChannelLoadMore() {
		pseudoColumnPager = null;
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
						pseudoColumnPager &&
						pseudoColumnPager.getHasMore() &&
						!pseudoColumnPager.isOlderBusy() &&
						!loadingMessages &&
						activePseudoChannelSlug === 'comments'
					) {
						void loadMoreCommentsChannelMessages();
					}
				}
			},
			/* Newest at top — sentinel at bottom; preload older rows before the user reaches the end. */
			{ root: messagesEl, rootMargin: '0px 0px 1400px 0px', threshold: 0 }
		);
		commentsChannelLoadMoreObserver.observe(sentinel);
	}

	async function loadMoreCommentsChannelMessages() {
		if (
			activePseudoChannelSlug !== 'comments' ||
			!pseudoColumnPager ||
			pseudoColumnPager.isOlderBusy() ||
			!pseudoColumnPager.getHasMore() ||
			loadingMessages
		) {
			return;
		}
		const messagesEl = root.querySelector('[data-chat-messages]');
		const col = pseudoColumnPager.getItems();
		if (!messagesEl || !Array.isArray(col) || col.length === 0) {
			return;
		}

		const sentinel = messagesEl.querySelector('[data-chat-comments-load-sentinel]');

		try {
			const r = await pseudoColumnPager.loadOlder();
			if (!r.ok) {
				return;
			}
			const mergedFiltered = Array.isArray(r.appended) ? r.appended : [];
			lastChatMessagesPayload = pseudoColumnPager.getItems();
			if (mergedFiltered.length === 0) {
				if (!pseudoColumnPager.getHasMore()) {
					disconnectCommentsChannelLoadObserver();
					sentinel?.remove();
				}
				return;
			}

			for (let i = 0; i < mergedFiltered.length; i++) {
				const row = createCommentsChannelPlainRow(mergedFiltered[i]);
				if (sentinel && sentinel.parentNode === messagesEl) {
					messagesEl.insertBefore(row, sentinel);
				} else {
					messagesEl.appendChild(row);
				}
			}

			hydrateUserTextLinks(messagesEl);
			if (typeof setupReactionTooltipTap === 'function') {
				setupReactionTooltipTap(messagesEl);
			}
			updateCommentsChannelLatestMarker(messagesEl);

			if (!pseudoColumnPager.getHasMore()) {
				disconnectCommentsChannelLoadObserver();
				sentinel?.remove();
			}
		} catch (err) {
			console.error('[Chat page] comments channel load more:', err);
		}
	}

	async function loadCommentsChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || loadingMessages) return;
		loadingMessages = true;
		syncChatMessagePlaceholder();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: 'feed',
				getItemKey: (m) => (Number.isFinite(Number(m?.id)) ? String(m.id) : ''),
				fetchPage: async ({ initial, items }) => {
					const commentsMod = await import(`../shared/comments.js${qs}`);
					if (initial) {
						const result = await commentsMod.fetchLatestComments({ limit: COMMENTS_CHANNEL_PAGE_SIZE });
						if (!result.ok) {
							const msg =
								result.data?.message ||
								result.data?.error ||
								'Failed to load comments';
							throw new Error(typeof msg === 'string' ? msg : 'Failed to load comments');
						}
						const raw = Array.isArray(result.data?.comments) ? result.data.comments : [];
						return {
							pageItems: raw.map(mapCommentRowToChatMessageShape),
							hasMore: result.data?.has_more === true,
						};
					}
					const oldest = Array.isArray(items) && items.length > 0 ? items[items.length - 1] : null;
					const beforeRaw = oldest?.created_at;
					const before =
						typeof beforeRaw === 'string' && beforeRaw.trim()
							? beforeRaw.trim()
							: beforeRaw != null
								? String(beforeRaw)
								: '';
					if (!before) {
						return { pageItems: [], hasMore: false };
					}
					const result = await commentsMod.fetchLatestComments({
						limit: COMMENTS_CHANNEL_PAGE_SIZE,
						before,
					});
					if (!result.ok) {
						return { pageItems: [], hasMore: false };
					}
					const raw = Array.isArray(result.data?.comments) ? result.data.comments : [];
					return {
						pageItems: raw.map(mapCommentRowToChatMessageShape),
						hasMore: result.data?.has_more === true,
					};
				},
			});
			const r = await pseudoColumnPager.loadInitial();
			if (!r.ok) {
				if (r.error instanceof Error) {
					throw r.error;
				}
				throw new Error(typeof r.reason === 'string' ? r.reason : 'Failed to load comments');
			}
			const messages = pseudoColumnPager.getItems();
			lastChatMessagesPayload = messages;
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';
			paintCommentsChannelPlainRows(messagesEl, messages, null);
			if (messages.length > 0 && pseudoColumnPager.getHasMore()) {
				const sentinel = document.createElement('div');
				sentinel.dataset.chatCommentsLoadSentinel = '1';
				sentinel.className = 'chat-page-comments-load-sentinel';
				sentinel.setAttribute('aria-hidden', 'true');
				sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
				messagesEl.appendChild(sentinel);
				setupCommentsChannelLoadMoreObserver(messagesEl);
			}
			scrollChatFeedPseudoChannelToTop();
		} catch (err) {
			console.error('[Chat page] comments channel:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load comments.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
			syncChatMessagePlaceholder();
			rebuildTopbarMenuDynamic();
		}
	}

	function setupFeedChannelVideoAutoplay(messagesEl, videoEl) {
		if (!(messagesEl instanceof HTMLElement) || !(videoEl instanceof HTMLVideoElement)) return;
		if (!('IntersectionObserver' in window)) {
			const src = videoEl.dataset.feedVideoSrc;
			if (src) {
				videoEl.src = src;
				try {
					videoEl.play();
				} catch {
					// ignore
				}
			}
			return;
		}
		if (!feedChannelVideoObserver) {
			feedChannelVideoObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const el = entry.target;
						if (!(el instanceof HTMLVideoElement)) continue;
						const src = el.dataset.feedVideoSrc || '';
						if (entry.isIntersecting) {
							if (!el.src && src) {
								el.src = src;
							}
							try {
								el.play();
								el.classList.add('is-active');
							} catch {
								// ignore autoplay errors
							}
						} else {
							try {
								el.pause();
							} catch {
								// ignore
							}
							el.classList.remove('is-active');
						}
					}
				},
				{ root: messagesEl, threshold: 0.5, rootMargin: '0px 0px 0px 0px' }
			);
		}
		feedChannelVideoObserver.observe(videoEl);
	}

	function setupFeedChannelLoadMoreObserver(messagesEl) {
		disconnectFeedChannelLoadObserver();
		const sentinel = messagesEl.querySelector('[data-chat-feed-load-sentinel]');
		if (!sentinel) return;
		feedChannelLoadMoreObserver = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (
						e.target === sentinel &&
						e.isIntersecting &&
						pseudoColumnPager &&
						pseudoColumnPager.getHasMore() &&
						!pseudoColumnPager.isOlderBusy() &&
						!loadingMessages &&
						(activePseudoChannelSlug === 'feed' ||
							activePseudoChannelSlug === 'explore' ||
							activePseudoChannelSlug === 'creations')
					) {
						if (activePseudoChannelSlug === 'feed') {
							void loadMoreFeedChannelMessages();
						} else if (activePseudoChannelSlug === 'explore') {
							void loadMoreExploreChannelMessages();
						} else if (activePseudoChannelSlug === 'creations') {
							void loadMoreCreationsChannelMessages();
						}
					}
				}
			},
			chatFeedLaneScrollMode === 'newest_first'
				? /* Match main feed: sentinel after cards; bottom margin preloads before the user reaches the end. */
				{ root: messagesEl, rootMargin: '0px 0px 1400px 0px', threshold: 0 }
				: /* Chat-style: sentinel above cards; top margin preloads while user is below older rows. */
				{ root: messagesEl, rootMargin: '1400px 0px 0px 0px', threshold: 0 }
		);
		feedChannelLoadMoreObserver.observe(sentinel);
	}

	function stopChatCreationsPseudoChannelPoll() {
		if (chatCreationsPollInterval != null) {
			clearInterval(chatCreationsPollInterval);
			chatCreationsPollInterval = null;
		}
	}

	/**
	 * Mirror the Creations route pending-token cleanup so chat `#creations` doesn't
	 * keep reloading forever from stale `sessionStorage.pendingCreations`.
	 * @param {object[]} creationsFromApi
	 */
	function pruneChatCreationsPendingSession(creationsFromApi) {
		const pending =
			typeof creationsPollMod.getPendingCreationsFromSession === 'function'
				? creationsPollMod.getPendingCreationsFromSession()
				: [];
		if (!Array.isArray(pending) || pending.length === 0) return;
		const creations = Array.isArray(creationsFromApi) ? creationsFromApi : [];
		const nowMs = Date.now();
		const PENDING_TTL_MS = 3000;
		const creationsByToken = new Map();
		for (const item of creations) {
			if (!item || typeof item !== 'object') continue;
			const rawMeta = item.meta;
			let meta = rawMeta && typeof rawMeta === 'object' ? rawMeta : null;
			if (!meta && typeof rawMeta === 'string') {
				try {
					meta = JSON.parse(rawMeta);
				} catch {
					meta = null;
				}
			}
			const token = meta && typeof meta.creation_token === 'string' ? meta.creation_token : null;
			if (token) creationsByToken.set(token, true);
		}
		const pendingWithinTtl = pending.filter((p) => {
			const createdAtRaw = typeof p?.created_at === 'string' ? p.created_at : '';
			const createdAtMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
			if (!Number.isFinite(createdAtMs)) return true;
			return nowMs - createdAtMs <= PENDING_TTL_MS;
		});
		const filtered = pendingWithinTtl.filter((p) => {
			const token = typeof p?.creation_token === 'string' ? p.creation_token : null;
			if (!token) return true;
			return !creationsByToken.has(token);
		});
		const oldPendingStr = JSON.stringify(pending);
		const newPendingStr = JSON.stringify(filtered);
		if (oldPendingStr === newPendingStr) return;
		try {
			sessionStorage.setItem('pendingCreations', newPendingStr);
		} catch {
			// ignore storage write errors
		}
		// Notify other views only when the value changed to avoid event loops.
		document.dispatchEvent(new CustomEvent('creations-pending-updated'));
	}

	async function chatCreationsPseudoChannelPollTick() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!(messagesEl instanceof HTMLElement) || activePseudoChannelSlug !== 'creations') {
			stopChatCreationsPseudoChannelPoll();
			return;
		}
		if (!creationsPollMod.shouldContinueCreationsPoll(messagesEl)) {
			stopChatCreationsPseudoChannelPoll();
			return;
		}
		if (loadingMessages) return;
		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/create/images',
				{ credentials: 'include' },
				{ windowMs: 300 }
			);
			if (!result.ok) return;
			const creations = Array.isArray(result.data?.images) ? result.data.images : [];
			pruneChatCreationsPendingSession(creations);
			const hasUpdates = creationsPollMod.computeCreationsPollHasListUpdates(creations, messagesEl);
			const hasPending = creationsPollMod.hasPendingCreationsReloadHint(messagesEl);
			const now = Date.now();
			const wouldReload = hasUpdates || hasPending;
			const throttleOk = hasUpdates || now - chatCreationsPollLastReloadAt >= 5000;
			if (wouldReload && throttleOk) {
				chatCreationsPollLastReloadAt = now;
				await loadCreationsChannelMessages({ forceFreshFirstPage: true });
			}
		} catch {
			// ignore
		}
	}

	function maybeStartChatCreationsPseudoChannelPoll() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!(messagesEl instanceof HTMLElement) || activePseudoChannelSlug !== 'creations') {
			stopChatCreationsPseudoChannelPoll();
			return;
		}
		if (!creationsPollMod.shouldContinueCreationsPoll(messagesEl)) {
			stopChatCreationsPseudoChannelPoll();
			return;
		}
		if (chatCreationsPollInterval != null) return;
		chatCreationsPollInterval = window.setInterval(() => {
			void chatCreationsPseudoChannelPollTick();
		}, 2000);
	}

	/**
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	async function loadMoreFeedLanePseudoChannelMessages(laneSlug) {
		if (
			activePseudoChannelSlug !== laneSlug ||
			!pseudoColumnPager ||
			pseudoColumnPager.isOlderBusy() ||
			!pseudoColumnPager.getHasMore() ||
			loadingMessages
		) {
			return;
		}
		const messagesEl = root.querySelector('[data-chat-messages]');
		const cards = messagesEl?.querySelector('[data-feed-channel-cards]');
		if (!(messagesEl instanceof HTMLElement) || !(cards instanceof HTMLElement)) {
			return;
		}
		const col = pseudoColumnPager.getItems();
		if (!Array.isArray(col) || col.length === 0) {
			return;
		}

		const anchor = cards.firstElementChild;
		function preserveScrollAfterPrepend(anchorTopBefore) {
			if (!(anchor instanceof Element) || !anchor.isConnected) return;
			const anchorTopAfter =
				anchor.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
			const d = anchorTopAfter - anchorTopBefore;
			if (Number.isFinite(d) && Math.abs(d) > 0.25) {
				messagesEl.scrollTop += d;
			}
		}

		let anchorTopBefore = 0;
		if (chatFeedLaneScrollMode === 'oldest_first' && anchor) {
			anchorTopBefore =
				anchor.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
		}

		try {
			const feedCardMod = await import(`../shared/feedCardBuild.js${qs}`);
			const { createFeedItemCard, feedItemToUser } = feedCardMod;
			const r = await pseudoColumnPager.loadOlder();
			if (!r.ok) {
				return;
			}
			const mergedFiltered =
				chatFeedLaneScrollMode === 'newest_first'
					? Array.isArray(r.appended) ? r.appended : []
					: Array.isArray(r.prepended) ? r.prepended : [];
			if (mergedFiltered.length === 0) {
				if (!pseudoColumnPager.getHasMore()) {
					disconnectFeedChannelLoadObserver();
				}
				return;
			}
			addPageUsers(mergedFiltered.map(feedItemToUser));

			if (chatFeedLaneScrollMode === 'newest_first') {
				const idxBase = cards.children.length;
				for (let i = 0; i < mergedFiltered.length; i++) {
					cards.appendChild(
						createFeedItemCard(
							mergedFiltered[i],
							idxBase + i,
							feedCardOptionsForPseudoLane(
								(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
								laneSlug
							)
						)
					);
				}
			} else if (anchor) {
				for (let i = 0; i < mergedFiltered.length; i++) {
					const row = createFeedItemCard(
						mergedFiltered[i],
						i,
						feedCardOptionsForPseudoLane(
							(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
							laneSlug
						)
					);
					cards.insertBefore(row, anchor);
				}
			} else {
				for (let i = 0; i < mergedFiltered.length; i++) {
					cards.appendChild(
						createFeedItemCard(
							mergedFiltered[i],
							i,
							feedCardOptionsForPseudoLane(
								(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
								laneSlug
							)
						)
					);
				}
			}

			if (!pseudoColumnPager.getHasMore()) {
				disconnectFeedChannelLoadObserver();
			}

			if (chatFeedLaneScrollMode === 'oldest_first') {
				void messagesEl.offsetHeight;
				preserveScrollAfterPrepend(anchorTopBefore);
				requestAnimationFrame(() => {
					preserveScrollAfterPrepend(anchorTopBefore);
					requestAnimationFrame(() => {
						preserveScrollAfterPrepend(anchorTopBefore);
					});
				});
			}
			if (laneSlug === 'creations') {
				maybeStartChatCreationsPseudoChannelPoll();
			}
		} catch (err) {
			const label =
				laneSlug === 'explore'
					? 'explore channel'
					: laneSlug === 'creations'
						? 'creations channel'
						: 'feed channel';
			console.error(`[Chat page] ${label} load more:`, err);
		}
	}

	async function loadMoreFeedChannelMessages() {
		await loadMoreFeedLanePseudoChannelMessages('feed');
	}

	async function loadMoreCreationsChannelMessages() {
		await loadMoreFeedLanePseudoChannelMessages('creations');
	}

	async function loadFeedChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || loadingMessages) return;
		loadingMessages = true;
		syncChatMessagePlaceholder();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			const feedCardMod = await import(`../shared/feedCardBuild.js${qs}`);
			const { createFeedItemCard, feedItemToUser, getHiddenFeedItems } = feedCardMod;

			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: feedLanePagerColumnOrder(),
				getItemKey: (it) => {
					if (it.type === 'tip' || it.type === 'blog_post') {
						return `${it.type}:${it.id ?? it.slug ?? it.title ?? ''}`;
					}
					return String(it.created_image_id || it.id || '');
				},
				fetchPage: async ({ initial, items }) => {
					const offset = initial ? 0 : items.length;
					const feed = await fetchJsonWithStatusDeduped(
						`/api/feed?limit=${FEED_CHANNEL_PAGE_SIZE}&offset=${offset}`,
						{ credentials: 'include' },
						{ windowMs: 30000 }
					);
					if (!feed.ok) {
						if (initial) {
							const msg = feed.data?.message || feed.data?.error || 'Failed to load feed';
							throw new Error(typeof msg === 'string' ? msg : 'Failed to load feed');
						}
						return { pageItems: [], hasMore: false };
					}
					let pageItems = Array.isArray(feed.data?.items) ? feed.data.items : [];
					const hiddenIds = getHiddenFeedItems();
					pageItems = pageItems.filter((item) => {
						if (item.type === 'tip' || item.type === 'blog_post') return true;
						const itemId = String(item.created_image_id || item.id);
						return !hiddenIds.includes(itemId);
					});
					return { pageItems, hasMore: Boolean(feed.data?.hasMore) };
				},
			});
			const r = await pseudoColumnPager.loadInitial();
			if (!r.ok) {
				if (r.error instanceof Error) {
					throw r.error;
				}
				throw new Error(typeof r.reason === 'string' ? r.reason : 'Failed to load feed');
			}
			const ordered = pseudoColumnPager.getItems();
			lastChatMessagesPayload = [];
			clearPageUsers();
			addPageUsers(ordered.map(feedItemToUser));
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';
			if (ordered.length === 0) {
				messagesEl.innerHTML = renderEmptyState({
					className: 'route-empty-image-grid',
					icon: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
					title: 'Your feed is empty',
					message:
						'Your feed shows creations from people you follow. Explore the community, follow a few creators, and your feed will start filling up.',
					buttonText: 'Explore creators',
					buttonHref: '/explore',
					buttonRoute: 'explore',
				});
				const button = messagesEl.querySelector('.route-empty-button[data-route="explore"]');
				if (button) {
					button.addEventListener('click', (e) => {
						e.preventDefault();
						const header = document.querySelector('app-navigation');
						if (header && typeof header.navigateToRoute === 'function') {
							header.navigateToRoute('explore');
							return;
						}
						window.location.href = '/explore';
					});
				}
				if (chatFeedLaneScrollMode === 'newest_first') {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const routeWrap = document.createElement('div');
			routeWrap.className = 'feed-route chat-feed-channel-route';
			const cards = document.createElement('div');
			cards.className = 'route-cards feed-cards';
			cards.setAttribute('data-feed-channel-cards', '1');
			for (let i = 0; i < ordered.length; i++) {
				cards.appendChild(
					createFeedItemCard(
						ordered[i],
						i,
						feedCardOptionsForPseudoLane(
							(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
							'feed'
						)
					)
				);
			}
			routeWrap.appendChild(cards);

			const sentinel = document.createElement('div');
			sentinel.dataset.chatFeedLoadSentinel = '1';
			sentinel.className = 'chat-page-feed-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			if (chatFeedLaneScrollMode === 'newest_first') {
				messagesEl.appendChild(routeWrap);
				messagesEl.appendChild(sentinel);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatFeedPseudoChannelToTop();
			} else {
				messagesEl.appendChild(sentinel);
				messagesEl.appendChild(routeWrap);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatMessagesToEnd();
			}
		} catch (err) {
			console.error('[Chat page] feed channel:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load feed.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
			syncChatMessagePlaceholder();
			rebuildTopbarMenuDynamic();
		}
	}

	function applyExploreCreationsBrowseViewClass(routeWrap) {
		if (!(routeWrap instanceof HTMLElement)) return;
		routeWrap.dataset.chatExploreCreationsLane = '1';
		routeWrap.classList.toggle('chat-feed-channel-route--browse-view', chatExploreCreationsBrowseView);
	}

	/**
	 * @param {(el: HTMLVideoElement) => void} setupFeedVideo
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	function feedCardOptionsForPseudoLane(setupFeedVideo, laneSlug) {
		const hide =
			chatExploreCreationsBrowseView && (laneSlug === 'explore' || laneSlug === 'creations');
		return {
			setupFeedVideo,
			hideFeedCardMetadata: hide,
			preferThumbnail: laneSlug === 'explore' || laneSlug === 'creations',
			creationsBulkChrome: laneSlug === 'creations',
		};
	}

	function insertChatCreationsPseudoBulkChrome(routeWrap, cardsEl) {
		if (!(routeWrap instanceof HTMLElement) || !(cardsEl instanceof HTMLElement)) return;
		const shell = document.createElement('div');
		shell.innerHTML = `
		<div class="creations-bulk-bar" data-creations-bulk-bar aria-hidden="true">
			<div class="creations-bulk-bar-inner">
				<span class="creations-bulk-bar-label">Bulk Actions</span>
				<div class="creations-bulk-actions">
					<button type="button" class="btn-secondary creations-bulk-queue-btn" data-creations-bulk-queue disabled>Queue for later</button>
					<button type="button" class="btn-secondary creations-bulk-delete-btn" data-creations-bulk-delete disabled>Delete</button>
				</div>
				<button type="button" class="creations-bulk-bar-close" data-creations-bulk-close aria-label="Close bulk actions">×</button>
			</div>
		</div>
		<div class="creations-bulk-delete-modal-overlay" data-creations-bulk-delete-modal aria-hidden="true">
			<div class="creations-bulk-delete-modal">
				<h3>Delete selected creations?</h3>
				<p class="creations-bulk-delete-modal-message" data-creations-bulk-delete-message></p>
				<p class="creations-bulk-delete-modal-error" data-creations-bulk-delete-error role="alert"></p>
				<div class="creations-bulk-delete-modal-footer">
					<button type="button" class="btn-secondary" data-creations-bulk-delete-cancel>Cancel</button>
					<button type="button" class="btn-danger creations-bulk-delete-confirm-btn" data-creations-bulk-delete-confirm>
						<span class="creations-bulk-delete-confirm-label">Delete</span>
						<span class="creations-bulk-delete-confirm-spinner" aria-hidden="true"></span>
					</button>
				</div>
			</div>
		</div>`;
		const bar = shell.querySelector('[data-creations-bulk-bar]');
		const modal = shell.querySelector('[data-creations-bulk-delete-modal]');
		if (bar instanceof HTMLElement) {
			routeWrap.insertBefore(bar, cardsEl);
		}
		if (modal instanceof HTMLElement) {
			routeWrap.appendChild(modal);
		}
	}

	function teardownChatCreationsPseudoBulkHostIfPresent(messagesEl) {
		if (!(messagesEl instanceof HTMLElement)) return;
		const h = messagesEl.querySelector('[data-chat-creations-bulk-host]');
		if (h instanceof HTMLElement) {
			h._chatBulkEsc?.abort();
			h._chatBulkCap?.abort();
		}
	}

	async function setupChatCreationsPseudoBulkRoute(routeWrap) {
		if (!(routeWrap instanceof HTMLElement)) return;
		routeWrap._chatBulkEsc?.abort();
		routeWrap._chatBulkCap?.abort();
		const cards = routeWrap.querySelector('[data-feed-channel-cards]');
		if (!(cards instanceof HTMLElement)) return;
		const mutateQueueMod = await import(`../shared/mutateQueue.js${qs}`);
		const { addToMutateQueue } = mutateQueueMod;

		const bar = routeWrap.querySelector('[data-creations-bulk-bar]');
		const bulkClose = routeWrap.querySelector('[data-creations-bulk-close]');
		const bulkDelete = routeWrap.querySelector('[data-creations-bulk-delete]');
		const bulkQueue = routeWrap.querySelector('[data-creations-bulk-queue]');
		const modalOverlay = routeWrap.querySelector('[data-creations-bulk-delete-modal]');
		const modalCancel = routeWrap.querySelector('[data-creations-bulk-delete-cancel]');
		const modalConfirm = routeWrap.querySelector('[data-creations-bulk-delete-confirm]');

		function queryBulkCards() {
			return Array.from(routeWrap.querySelectorAll('.feed-card[data-image-id]'));
		}

		function updateBulkBarSelection() {
			const deleteBtn = routeWrap.querySelector('[data-creations-bulk-delete]');
			const queueBtn = routeWrap.querySelector('[data-creations-bulk-queue]');
			if (!bar || !deleteBtn) return;
			const checked = routeWrap.querySelectorAll('[data-creations-bulk-checkbox]:checked').length;
			const hasSelection = checked > 0;
			const queueableCards = hasSelection
				? queryBulkCards().filter((card) => {
						const cb = card.querySelector('[data-creations-bulk-checkbox]:checked');
						const url = (card.dataset.imageUrl || '').trim();
						return cb && url;
					})
				: [];
			bar.classList.toggle('has-selection', hasSelection);
			deleteBtn.disabled = !hasSelection;
			if (queueBtn) queueBtn.disabled = queueableCards.length === 0;
		}

		function exitBulkMode() {
			routeWrap.classList.remove('is-bulk-mode');
			if (bar) bar.setAttribute('aria-hidden', 'true');
			for (const c of queryBulkCards()) {
				const cb = c.querySelector('[data-creations-bulk-checkbox]');
				if (cb instanceof HTMLInputElement) cb.checked = false;
			}
			updateBulkBarSelection();
		}

		function enterBulkMode() {
			routeWrap.classList.add('is-bulk-mode');
			if (bar) bar.removeAttribute('aria-hidden');
			for (const c of queryBulkCards()) {
				const cb = c.querySelector('[data-creations-bulk-checkbox]');
				if (cb instanceof HTMLInputElement) cb.checked = false;
			}
			updateBulkBarSelection();
		}

		routeWrap._enterChatCreationsBulk = enterBulkMode;
		routeWrap._exitChatCreationsBulk = exitBulkMode;

		const escAc = new AbortController();
		routeWrap._chatBulkEsc = escAc;
		document.addEventListener(
			'keydown',
			(e) => {
				if (e.key !== 'Escape') return;
				if (!routeWrap.classList.contains('is-bulk-mode')) return;
				if (!routeWrap.isConnected) return;
				e.preventDefault();
				exitBulkMode();
			},
			{ signal: escAc.signal }
		);

		const capAc = new AbortController();
		routeWrap._chatBulkCap = capAc;
		let longPressTimer = null;
		let longPressPointerId = null;
		let longPressCard = null;
		let longPressStartX = 0;
		let longPressStartY = 0;
		let suppressCardClickUntil = 0;

		function clearLongPressState() {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			longPressPointerId = null;
			longPressCard = null;
			longPressStartX = 0;
			longPressStartY = 0;
		}

		cards.addEventListener(
			'pointerdown',
			(e) => {
				if (!isChatPageMobileLayout()) return;
				if (routeWrap.classList.contains('is-bulk-mode')) return;
				if (e.pointerType === 'mouse') return;
				const card = e.target?.closest?.('.feed-card[data-image-id]');
				if (!(card instanceof HTMLElement)) return;
				if (e.target?.closest?.('a,button,input,textarea,select,label,[role="button"]')) return;
				clearLongPressState();
				longPressPointerId = e.pointerId;
				longPressCard = card;
				longPressStartX = Number(e.clientX) || 0;
				longPressStartY = Number(e.clientY) || 0;
				longPressTimer = setTimeout(() => {
					if (!(longPressCard instanceof HTMLElement)) return;
					enterBulkMode();
					const cb = longPressCard.querySelector('[data-creations-bulk-checkbox]');
					if (cb instanceof HTMLInputElement) cb.checked = true;
					updateBulkBarSelection();
					suppressCardClickUntil = Date.now() + 700;
					clearLongPressState();
				}, 420);
			},
			{ signal: capAc.signal }
		);
		cards.addEventListener(
			'pointermove',
			(e) => {
				if (longPressPointerId == null || e.pointerId !== longPressPointerId) return;
				const dx = Math.abs((Number(e.clientX) || 0) - longPressStartX);
				const dy = Math.abs((Number(e.clientY) || 0) - longPressStartY);
				if (dx > 10 || dy > 10) clearLongPressState();
			},
			{ signal: capAc.signal }
		);
		cards.addEventListener(
			'pointerup',
			(e) => {
				if (longPressPointerId == null || e.pointerId !== longPressPointerId) return;
				clearLongPressState();
			},
			{ signal: capAc.signal }
		);
		cards.addEventListener(
			'pointercancel',
			(e) => {
				if (longPressPointerId == null || e.pointerId !== longPressPointerId) return;
				clearLongPressState();
			},
			{ signal: capAc.signal }
		);
		cards.addEventListener(
			'click',
			(e) => {
				if (
					Date.now() < suppressCardClickUntil &&
					e.target?.closest?.('.feed-card[data-image-id]')
				) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				const overlay = e.target.closest('[data-creations-bulk-overlay]');
				if (!overlay) return;
				e.stopPropagation();
				if (e.target.matches('[data-creations-bulk-checkbox]')) return;
				e.preventDefault();
				const cb = overlay.querySelector('[data-creations-bulk-checkbox]');
				if (cb instanceof HTMLInputElement) {
					cb.checked = !cb.checked;
					updateBulkBarSelection();
				}
			},
			{ capture: true, signal: capAc.signal }
		);
		cards.addEventListener(
			'change',
			(e) => {
				if (e.target.matches('[data-creations-bulk-checkbox]')) updateBulkBarSelection();
			},
			{ signal: capAc.signal }
		);

		if (bulkClose) bulkClose.addEventListener('click', () => exitBulkMode(), { signal: capAc.signal });
		if (bulkDelete) {
			bulkDelete.addEventListener(
				'click',
				(e) => {
					e.preventDefault();
					openBulkDeleteModal();
				},
				{ signal: capAc.signal }
			);
		}
		if (bulkQueue) {
			bulkQueue.addEventListener(
				'click',
				(e) => {
					e.preventDefault();
					bulkQueueSelected();
				},
				{ signal: capAc.signal }
			);
		}

		function getBulkDeleteCounts() {
			let toDelete = 0;
			let published = 0;
			for (const card of queryBulkCards()) {
				const cb = card.querySelector('[data-creations-bulk-checkbox]:checked');
				if (!cb) continue;
				if (card.dataset.published === '1') published += 1;
				else toDelete += 1;
			}
			return { toDelete, published };
		}

		function openBulkDeleteModal() {
			const modal = routeWrap.querySelector('[data-creations-bulk-delete-modal]');
			const messageEl = routeWrap.querySelector('[data-creations-bulk-delete-message]');
			const errorEl = routeWrap.querySelector('[data-creations-bulk-delete-error]');
			const confirmBtn = routeWrap.querySelector('[data-creations-bulk-delete-confirm]');
			const { toDelete, published } = getBulkDeleteCounts();
			if (messageEl) {
				const parts = [];
				if (toDelete > 0) {
					parts.push(`${toDelete} item${toDelete === 1 ? '' : 's'} will be deleted.`);
				} else {
					parts.push('No items will be deleted.');
				}
				if (published > 0) {
					parts.push(
						`${published} published item${published === 1 ? '' : 's'} selected will not be deleted.`
					);
				}
				messageEl.textContent = parts.join(' ');
			}
			if (confirmBtn instanceof HTMLButtonElement) {
				confirmBtn.disabled = toDelete === 0;
				confirmBtn.classList.remove('is-loading');
			}
			if (errorEl) {
				errorEl.classList.remove('visible');
				errorEl.textContent = '';
			}
			if (modal) {
				modal.classList.add('open');
				modal.removeAttribute('aria-hidden');
				document.body.classList.add('modal-open');
			}
		}

		function closeBulkDeleteModal() {
			const modal = routeWrap.querySelector('[data-creations-bulk-delete-modal]');
			if (modal) {
				modal.classList.remove('open');
				modal.setAttribute('aria-hidden', 'true');
				document.body.classList.remove('modal-open');
			}
		}

		if (modalOverlay) {
			modalOverlay.addEventListener(
				'click',
				(e) => {
					if (e.target === modalOverlay) closeBulkDeleteModal();
				},
				{ signal: capAc.signal }
			);
		}
		if (modalCancel) modalCancel.addEventListener('click', () => closeBulkDeleteModal(), { signal: capAc.signal });
		if (modalConfirm) {
			modalConfirm.addEventListener('click', () => void confirmBulkDelete(), { signal: capAc.signal });
		}

		function bulkQueueSelected() {
			const selected = queryBulkCards().filter((card) => {
				const cb = card.querySelector('[data-creations-bulk-checkbox]:checked');
				const url = (card.dataset.imageUrl || '').trim();
				return cb && url;
			});
			if (selected.length === 0) return;
			const origin =
				typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
			for (const card of selected) {
				const id = card.dataset.imageId;
				let url = (card.dataset.imageUrl || '').trim();
				if (!url || !id) continue;
				if (!url.startsWith('http://') && !url.startsWith('https://') && origin) {
					url = origin + (url.startsWith('/') ? url : `/${url}`);
				}
				const published = card.dataset.published === '1';
				try {
					addToMutateQueue({ sourceId: Number(id), imageUrl: url, published });
				} catch {
					// ignore storage errors
				}
			}
			exitBulkMode();
		}

		async function confirmBulkDelete() {
			const confirmBtn = routeWrap.querySelector('[data-creations-bulk-delete-confirm]');
			const errorEl = routeWrap.querySelector('[data-creations-bulk-delete-error]');
			const selected = queryBulkCards().filter((card) => {
				const cb = card.querySelector('[data-creations-bulk-checkbox]:checked');
				return cb && card.dataset.published !== '1';
			});
			const idsToDelete = selected.map((c) => c.dataset.imageId).filter(Boolean);
			if (idsToDelete.length === 0) {
				closeBulkDeleteModal();
				return;
			}
			if (!(confirmBtn instanceof HTMLButtonElement)) return;
			confirmBtn.disabled = true;
			confirmBtn.classList.add('is-loading');
			if (errorEl) {
				errorEl.classList.remove('visible');
				errorEl.textContent = '';
			}
			let lastError = null;
			for (const id of idsToDelete) {
				try {
					const res = await fetch(`/api/create/images/${id}`, { method: 'DELETE', credentials: 'include' });
					if (!res.ok) {
						const data = await res.json().catch(() => ({}));
						lastError = data?.error || res.statusText || 'Delete failed';
						break;
					}
				} catch (err) {
					lastError = err?.message || 'Network error';
					break;
				}
			}
			if (lastError) {
				if (errorEl) {
					errorEl.textContent = lastError;
					errorEl.classList.add('visible');
				}
				confirmBtn.disabled = false;
				confirmBtn.classList.remove('is-loading');
				return;
			}
			try {
				await loadCreationsChannelMessages({ forceFreshFirstPage: true });
			} finally {
				closeBulkDeleteModal();
				exitBulkMode();
				const btn = routeWrap.querySelector('[data-creations-bulk-delete-confirm]');
				if (btn instanceof HTMLButtonElement && btn.isConnected) {
					btn.disabled = false;
					btn.classList.remove('is-loading');
				}
			}
		}
	}

	async function loadCreationsChannelMessages(options = {}) {
		const forceFreshFirstPage = options.forceFreshFirstPage === true;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		if (loadingMessages) return;
		stopChatCreationsPseudoChannelPoll();
		const viewerId = chatViewerId;
		if (!Number.isFinite(Number(viewerId)) || Number(viewerId) <= 0) {
			messagesEl.innerHTML = renderEmptyError('Sign in to see your creations.');
			stopChatCreationsPseudoChannelPoll();
			rebuildTopbarMenuDynamic();
			return;
		}
		loadingMessages = true;
		syncChatMessagePlaceholder();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			const feedCardMod = await import(`../shared/feedCardBuild.js${qs}`);
			const { createFeedItemCard, feedItemToUser } = feedCardMod;

			const creationsAuthorHints = await resolveCreationsChannelAuthorHints();

			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: feedLanePagerColumnOrder(),
				getItemKey: (it) => String(it.created_image_id || it.id || ''),
				fetchPage: async ({ initial, items }) => {
					const offset = initial ? 0 : items.length;
					const listDedupeOpts =
						forceFreshFirstPage && offset === 0
							? { windowMs: 0, dedupeKey: `chat-creations-list-p0-${Date.now()}` }
							: { windowMs: 30000 };
					const res = await fetchJsonWithStatusDeduped(
						`/api/create/images?limit=${CREATIONS_CHANNEL_PAGE_SIZE}&offset=${offset}`,
						{ credentials: 'include' },
						listDedupeOpts
					);
					if (!res.ok) {
						if (initial) {
							const msg = res.data?.message || res.data?.error || 'Failed to load creations';
							throw new Error(typeof msg === 'string' ? msg : 'Failed to load creations');
						}
						return { pageItems: [], hasMore: false };
					}
					const raw = Array.isArray(res.data?.images) ? res.data.images : [];
					const pageItems = raw.map((img) =>
						mapUserCreatedImageApiRowToFeedItem(img, viewerId, creationsAuthorHints)
					);
					return { pageItems, hasMore: Boolean(res.data?.has_more) };
				},
			});
			const r = await pseudoColumnPager.loadInitial();
			if (!r.ok) {
				if (r.error instanceof Error) {
					throw r.error;
				}
				throw new Error(typeof r.reason === 'string' ? r.reason : 'Failed to load creations');
			}
			const ordered = pseudoColumnPager.getItems();
			lastChatMessagesPayload = [];
			clearPageUsers();
			addPageUsers(ordered.map(feedItemToUser));
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';
			if (ordered.length === 0) {
				messagesEl.innerHTML = renderEmptyState({
					className: 'route-empty-image-grid',
					title: 'No creations yet',
					message: 'Start creating to see your work here.',
					buttonText: 'Get Started',
					buttonHref: '/create',
				});
				if (chatFeedLaneScrollMode === 'newest_first') {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const routeWrap = document.createElement('div');
			routeWrap.className = 'feed-route chat-feed-channel-route creations-route';
			routeWrap.dataset.chatCreationsBulkHost = '1';
			applyExploreCreationsBrowseViewClass(routeWrap);
			const cards = document.createElement('div');
			cards.className = 'route-cards feed-cards';
			cards.setAttribute('data-feed-channel-cards', '1');
			for (let i = 0; i < ordered.length; i++) {
				cards.appendChild(
					createFeedItemCard(
						ordered[i],
						i,
						feedCardOptionsForPseudoLane(
							(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
							'creations'
						)
					)
				);
			}
			routeWrap.appendChild(cards);
			insertChatCreationsPseudoBulkChrome(routeWrap, cards);
			await setupChatCreationsPseudoBulkRoute(routeWrap);

			const sentinel = document.createElement('div');
			sentinel.dataset.chatFeedLoadSentinel = '1';
			sentinel.className = 'chat-page-feed-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			if (chatFeedLaneScrollMode === 'newest_first') {
				messagesEl.appendChild(routeWrap);
				messagesEl.appendChild(sentinel);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatFeedPseudoChannelToTop();
			} else {
				messagesEl.appendChild(sentinel);
				messagesEl.appendChild(routeWrap);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatMessagesToEnd();
			}
		} catch (err) {
			console.error('[Chat page] creations channel:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load creations.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
			syncChatMessagePlaceholder();
			rebuildTopbarMenuDynamic();
			maybeStartChatCreationsPseudoChannelPoll();
		}
	}

	async function loadMoreExploreChannelMessages() {
		await loadMoreFeedLanePseudoChannelMessages('explore');
	}

	function mergeExploreSearchKeywordSemantic(keyword, semantic, preferSemanticFirst) {
		const k = 60;
		const keywordItems = Array.isArray(keyword) ? keyword : [];
		const semanticItems = Array.isArray(semantic) ? semantic : [];
		const keywordRank = new Map();
		keywordItems.forEach((item, i) => {
			const id = item?.created_image_id ?? item?.id;
			if (id != null) keywordRank.set(Number(id), i + 1);
		});
		const semanticRank = new Map();
		semanticItems.forEach((item, i) => {
			const id = item?.created_image_id ?? item?.id;
			if (id != null) semanticRank.set(Number(id), i + 1);
		});
		function scoreForItem(item) {
			const id = item?.created_image_id ?? item?.id;
			if (id == null) return null;
			const n = Number(id);
			const sk = keywordRank.has(n) ? 1 / (k + keywordRank.get(n)) : 0;
			const ss = semanticRank.has(n) ? 1 / (k + semanticRank.get(n)) : 0;
			return sk + ss;
		}
		if (keywordItems.length > 0 && semanticItems.length > 0) {
			const firstList = preferSemanticFirst ? semanticItems : keywordItems;
			const secondList = preferSemanticFirst ? keywordItems : semanticItems;
			const firstIds = new Set(firstList.map((i) => i?.created_image_id ?? i?.id).filter(Boolean));
			const appended = secondList.filter((i) => !firstIds.has(i?.created_image_id ?? i?.id));
			return [...firstList, ...appended].map((item) => {
				const s = scoreForItem(item);
				return s != null ? { ...item, searchScore: s } : item;
			});
		}
		if (keywordItems.length > 0) {
			return keywordItems.map((item, i) => ({ ...item, searchScore: 1 / (k + i + 1) }));
		}
		if (semanticItems.length > 0) {
			return semanticItems.map((item, i) => ({ ...item, searchScore: 1 / (k + i + 1) }));
		}
		return [];
	}

	async function fetchExploreSearchMergedForChat(trimmed) {
		const q = encodeURIComponent(trimmed);
		const keywordUrl = `/api/explore/search?q=${q}&limit=${EXPLORE_SEARCH_FETCH_LIMIT}`;
		const semanticUrl = `/api/explore/search/semantic?q=${q}&limit=${EXPLORE_SEARCH_FETCH_LIMIT}`;
		const opts = { credentials: 'include' };
		const [kwRes, semRes] = await Promise.all([
			fetch(keywordUrl, opts)
				.then((r) => r.json().then((data) => ({ ok: r.ok, data })).catch(() => ({ ok: false, data: null })))
				.catch(() => ({ ok: false, data: null })),
			fetch(semanticUrl, opts)
				.then((r) => r.json().then((data) => ({ ok: r.ok, data })).catch(() => ({ ok: false, data: null })))
				.catch(() => ({ ok: false, data: null })),
		]);
		const keywordItems = kwRes?.ok && Array.isArray(kwRes.data?.items) ? kwRes.data.items : [];
		const semanticItems = semRes?.ok && Array.isArray(semRes.data?.items) ? semRes.data.items : [];
		const preferSemanticFirst = semanticItems.length > 0 && keywordItems.length === 0;
		const merged = mergeExploreSearchKeywordSemantic(keywordItems, semanticItems, preferSemanticFirst);
		merged.sort((a, b) => {
			const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
			const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
			return ta - tb;
		});
		return merged;
	}

	async function loadExploreChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || loadingMessages) return;
		loadingMessages = true;
		exploreBrowseMessagesLoading = true;
		syncChatMessagePlaceholder();
		syncChatExploreComposerChrome();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		const qActive = String(exploreQueryRef.q || '').trim();
		try {
			const feedCardMod = await import(`../shared/feedCardBuild.js${qs}`);
			const { createFeedItemCard, feedItemToUser } = feedCardMod;

			if (qActive) {
				pseudoColumnPager = null;
				disconnectFeedChannelLoadObserver();
				exploreChannelSearchLoading = true;
				syncChatExploreComposerChrome();
				try {
					const merged = await fetchExploreSearchMergedForChat(qActive);
					pushExploreChannelSearchToHistory(qActive);
					lastChatMessagesPayload = [];
					clearPageUsers();
					addPageUsers(merged.map(feedItemToUser));
					teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
					teardownLatestMessageReadObserver();
					messagesEl.innerHTML = '';
					if (merged.length === 0) {
						messagesEl.innerHTML = renderEmptyState({
							className: 'route-empty-image-grid',
							title: 'No creations found',
						});
						if (chatFeedLaneScrollMode === 'newest_first') {
							scrollChatFeedPseudoChannelToTop();
						} else {
							scrollChatMessagesToEnd();
						}
						return;
					}
					const routeWrap = document.createElement('div');
					routeWrap.className = 'feed-route chat-feed-channel-route';
					applyExploreCreationsBrowseViewClass(routeWrap);
					const cards = document.createElement('div');
					cards.className = 'route-cards feed-cards';
					cards.setAttribute('data-feed-channel-cards', '1');
					for (let i = 0; i < merged.length; i++) {
						cards.appendChild(
							createFeedItemCard(
								merged[i],
								i,
								feedCardOptionsForPseudoLane(
									(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
									'explore'
								)
							)
						);
					}
					routeWrap.appendChild(cards);
					messagesEl.appendChild(routeWrap);
					if (chatFeedLaneScrollMode === 'newest_first') {
						scrollChatFeedPseudoChannelToTop();
					} else {
						scrollChatMessagesToEnd();
					}
					return;
				} finally {
					exploreChannelSearchLoading = false;
					syncChatExploreComposerChrome();
				}
			}

			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: feedLanePagerColumnOrder(),
				getItemKey: (it) => String(it.created_image_id || it.id || ''),
				fetchPage: async ({ initial, items }) => {
					const offset = initial ? 0 : items.length;
					const res = await fetchJsonWithStatusDeduped(
						`/api/explore?limit=${EXPLORE_CHANNEL_PAGE_SIZE}&offset=${offset}`,
						{ credentials: 'include' },
						{ windowMs: 30000 }
					);
					if (!res.ok) {
						if (initial) {
							const msg = res.data?.message || res.data?.error || 'Failed to load explore';
							throw new Error(typeof msg === 'string' ? msg : 'Failed to load explore');
						}
						return { pageItems: [], hasMore: false };
					}
					const pageItems = Array.isArray(res.data?.items) ? res.data.items : [];
					return { pageItems, hasMore: Boolean(res.data?.hasMore) };
				},
			});
			const r = await pseudoColumnPager.loadInitial();
			if (!r.ok) {
				if (r.error instanceof Error) {
					throw r.error;
				}
				throw new Error(typeof r.reason === 'string' ? r.reason : 'Failed to load explore');
			}
			const ordered = pseudoColumnPager.getItems();
			lastChatMessagesPayload = [];
			clearPageUsers();
			addPageUsers(ordered.map(feedItemToUser));
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';

			if (ordered.length === 0) {
				messagesEl.innerHTML = renderEmptyState({
					className: 'route-empty-image-grid',
					title: 'Nothing to explore yet',
					message: 'Published creations from the community will appear here.',
				});
				if (chatFeedLaneScrollMode === 'newest_first') {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const routeWrap = document.createElement('div');
			routeWrap.className = 'feed-route chat-feed-channel-route';
			applyExploreCreationsBrowseViewClass(routeWrap);
			const cards = document.createElement('div');
			cards.className = 'route-cards feed-cards';
			cards.setAttribute('data-feed-channel-cards', '1');
			for (let i = 0; i < ordered.length; i++) {
				cards.appendChild(
					createFeedItemCard(
						ordered[i],
						i,
						feedCardOptionsForPseudoLane(
							(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
							'explore'
						)
					)
				);
			}
			routeWrap.appendChild(cards);

			const sentinel = document.createElement('div');
			sentinel.dataset.chatFeedLoadSentinel = '1';
			sentinel.className = 'chat-page-feed-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			if (chatFeedLaneScrollMode === 'newest_first') {
				messagesEl.appendChild(routeWrap);
				messagesEl.appendChild(sentinel);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatFeedPseudoChannelToTop();
			} else {
				messagesEl.appendChild(sentinel);
				messagesEl.appendChild(routeWrap);
				if (pseudoColumnPager.getHasMore()) {
					setupFeedChannelLoadMoreObserver(messagesEl);
				}
				scrollChatMessagesToEnd();
			}
		} catch (err) {
			console.error('[Chat page] explore channel:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load explore.');
		} finally {
			messagesEl.removeAttribute('aria-busy');
			exploreBrowseMessagesLoading = false;
			loadingMessages = false;
			syncChatMessagePlaceholder();
			syncChatExploreComposerChrome();
			if (activePseudoChannelSlug === 'explore' && !String(exploreQueryRef.q || '').trim()) {
				syncExploreChannelBrowseUrl();
			}
			rebuildTopbarMenuDynamic();
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
		syncChatMessagePlaceholder();
		messagesEl.setAttribute('aria-busy', 'true');
		const prevVideoStates = captureChatVideoPlaybackStates(messagesEl);

		const viewerId = chatViewerId;
		try {
			await refreshChatCanvasesList();
			const res = await fetch(`/api/chat/threads/${threadId}/messages?limit=50`, {
				credentials: 'include'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.message || data.error || 'Failed to load messages');
			}
			const messages = Array.isArray(data.messages) ? data.messages : [];
			const messagesForUi = messages.filter((m) => !getChatCanvasMetaFromMessage(m));
			lastChatMessagesPayload = messagesForUi;
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			teardownLatestMessageReadObserver();
			messagesEl.innerHTML = '';

			const threadMeta = (chatThreads || []).find((t) => Number(t.id) === threadId);
			const lastReadBoundary =
				threadMeta?.last_read_message_id != null
					? Number(threadMeta.last_read_message_id)
					: null;

			// Compute the full visual "new" range so we can include the sender meta row even if the
			// first unread message is a group-continue (meta shown on the previous row).
			const unreadLogical = messagesForUi.map((m) => {
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
				const first = messagesForUi[visualStart];
				const prev = messagesForUi[visualStart - 1];
				const prevSender = prev?.sender_id != null ? Number(prev.sender_id) : null;
				const prevIsSelf = Number.isFinite(viewerId) && Number.isFinite(prevSender) && prevSender === viewerId;
				if (isChatMessageGroupContinue(prev, first) && !prevIsSelf) {
					// Include the meta-bearing row (the previous message in the run).
					visualStart = visualStart - 1;
				}
			}
			const hasVisualUnreadRange = visualStart >= 0 && visualEnd >= visualStart;

			paintMessageRowsForChat(messagesEl, messagesForUi, viewerId, threadId, {
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
			bindInlineVideoClickControls(messagesEl);
			for (const bubble of messagesEl.querySelectorAll('.connect-chat-msg-bubble')) {
				trimTrailingWhitespaceAfterChatEmbed(bubble);
			}
			for (const embed of messagesEl.querySelectorAll('.connect-chat-creation-embed')) {
				trimChatCreationEmbedWhitespace(embed);
			}
			restoreChatVideoPlaybackStates(messagesEl, prevVideoStates);
			setupReactionTooltipTap(messagesEl);
			// TEMP: always land at latest message on load; disable unread jump behavior for now.
			scrollChatMessagesToEnd('initial_load');
			window.setTimeout(() => {
				setupLatestMessageReadObserver();
			}, 550);
		} catch (err) {
			console.error('[Chat page] messages:', err);
			messagesEl.innerHTML = renderEmptyError(err?.message || 'Could not load messages.');
			chatCanvasesList = [];
			activeThreadPinnedCanvasId = null;
			rebuildTopbarMenuDynamic();
		} finally {
			messagesEl.removeAttribute('aria-busy');
			loadingMessages = false;
			syncChatMessagePlaceholder();
			rebuildTopbarMenuDynamic();
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
					window.location.href = '/chat#channels';
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
				bindInlineVideoClickControls(rowRestored);
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
		const fileLink = e.target?.closest?.('a.user-text-inline-file-link[href]');
		if (fileLink instanceof HTMLAnchorElement && fileLink.closest('.connect-chat-msg-bubble')) {
			if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
				const kind = chatAttachmentPreviewKindFromHref(fileLink.getAttribute('href') || fileLink.href);
				if (kind === 'video' || kind === 'html') {
					e.preventDefault();
					e.stopPropagation();
					openChatAttachmentPreviewLightbox(fileLink.href, kind);
					return;
				}
			}
		}

		const tagLink = e.target?.closest?.('a.mention-link[href^="/t/"]');
		if (tagLink instanceof HTMLAnchorElement && tagLink.closest('.connect-chat-msg-bubble')) {
			if (activePseudoChannelSlug) {
				return;
			}
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
				return;
			}
			const href = tagLink.getAttribute('href') || '';
			const m = href.match(/^\/t\/([^/?#]+)/i);
			if (!m) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const slug = decodeURIComponent(m[1]);
			void openChatHashtagDestination(slug);
			return;
		}

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
			closeChatMessageToolbar();
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
			closeChatMessageToolbar();
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
			closeChatMessageToolbar();
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
			closeChatMessageToolbar();
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

	async function commitExploreSearchImmediateFromComposer() {
		if (activePseudoChannelSlug !== 'explore') return;
		if (isExploreComposerLoadLocked()) return;
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;
		exploreQueryRef.q = String(bodyInput.value || '').trim();
		await loadExploreChannelMessages();
	}

	async function submitChatMessage() {
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;
		if (activePseudoChannelSlug === 'explore') {
			await commitExploreSearchImmediateFromComposer();
			return;
		}
		if (chatPendingImages.some((x) => x.status === 'uploading')) return;
		const text = String(bodyInput.value || '').trim();
		const paths = chatPendingImages
			.filter((x) => x.status === 'ready' && x.urlPath)
			.map((x) => buildAttachmentMessageUrl(x))
			.filter(Boolean);
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
		markThreadUiPending();

		if (parsed.kind === 'empty' || parsed.kind === 'invalid') {
			window.location.replace('/chat#channels');
			return;
		}

		optimisticSend = null;
		tearDownChatCanvasUi();
		clearChatPendingAttachments();
		activePseudoChannelSlug = null;
		if (parsed.kind === 'channel') {
			const slug = String(parsed.slug || '').trim().toLowerCase();
			if (slug === 'feed' || slug === 'explore' || slug === 'creations' || slug === 'comments') {
				activePseudoChannelSlug = slug;
			}
		}
		syncChatBrowseViewBodyClass();
		applyComposerState();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();

		if (messagesEl) {
			stopChatCreationsPseudoChannelPoll();
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
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
		const bodyInputRoute = root.querySelector('[data-chat-body-input]');
		if (bodyInputRoute instanceof HTMLTextAreaElement) {
			bodyInputRoute.placeholder = '';
		}

		try {
			tearDownVisibilityResync();
			tearDownRoomBroadcast();
			resetSidebarRosterPrefetch();
			ensureSidebarRosterPrefetchStarted();
			await loadChatThreads();

			if (parsed.kind === 'thread') {
				await ensureThreadMetaForList(parsed.threadId);
				await refreshChatSidebar({ skipThreadsFetch: true });
				activeThreadId = parsed.threadId;
				const meta = (chatThreads || []).find((t) => Number(t.id) === parsed.threadId);
				updateTitleFromMeta(meta);
				await loadMessages();
				await bindRoomBroadcast(activeThreadId);
				return;
			}

			await refreshChatSidebar({ skipThreadsFetch: true });

			if (parsed.kind === 'channel') {
				const slug = String(parsed.slug).toLowerCase().trim();
				if (slug === 'comments') {
					activePseudoChannelSlug = 'comments';
					activeThreadId = null;
					updateTitleFromMeta({
						type: 'channel',
						channel_slug: 'comments',
					});
					if (messagesEl) {
						messagesEl.removeAttribute('aria-busy');
					}
					await loadCommentsChannelMessages();
					return;
				}
				if (slug === 'feed') {
					activePseudoChannelSlug = 'feed';
					activeThreadId = null;
					updateTitleFromMeta({
						type: 'channel',
						channel_slug: 'feed',
					});
					if (messagesEl) {
						messagesEl.removeAttribute('aria-busy');
					}
					await loadFeedChannelMessages();
					return;
				}
				if (slug === 'creations') {
					activePseudoChannelSlug = 'creations';
					activeThreadId = null;
					updateTitleFromMeta({
						type: 'channel',
						channel_slug: 'creations',
					});
					if (messagesEl) {
						messagesEl.removeAttribute('aria-busy');
					}
					await loadCreationsChannelMessages();
					return;
				}
				if (slug === 'explore') {
					activePseudoChannelSlug = 'explore';
					activeThreadId = null;
					let exploreSearchFromUrl = '';
					try {
						exploreSearchFromUrl = String(
							new URLSearchParams(window.location.search).get('s') || ''
						).trim();
					} catch {
						exploreSearchFromUrl = '';
					}
					exploreQueryRef.q = exploreSearchFromUrl;
					const biExplore = root.querySelector('[data-chat-body-input]');
					if (biExplore instanceof HTMLTextAreaElement) {
						biExplore.value = exploreSearchFromUrl;
					}
					updateTitleFromMeta({
						type: 'channel',
						channel_slug: 'explore',
					});
					if (messagesEl) {
						messagesEl.removeAttribute('aria-busy');
					}
					await loadExploreChannelMessages();
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
				await refreshChatSidebar({ skipThreadsFetch: true });
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
				await refreshChatSidebar({ skipThreadsFetch: true });
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
			void refreshChatSidebar({ skipThreadsFetch: true });
			if (messagesEl) {
				messagesEl.innerHTML = '';
				messagesEl.removeAttribute('aria-busy');
			}
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = err?.message || 'Could not open this conversation.';
			}
		} finally {
			syncChatBrowseViewBodyClass();
			applyComposerState();
		}
	}

	function closeChatHashtagChoiceModal() {
		if (typeof chatHashtagChoiceModalCleanup === 'function') {
			chatHashtagChoiceModalCleanup();
			chatHashtagChoiceModalCleanup = null;
		}
	}

	function showChatHashtagChoiceModal(slug) {
		closeChatHashtagChoiceModal();
		const label = `#${slug}`;
		const overlay = document.createElement('div');
		overlay.className = 'chat-hashtag-nav-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-labelledby', 'chat-hashtag-nav-title');
		overlay.setAttribute('aria-describedby', 'chat-hashtag-nav-desc');

		const panel = document.createElement('div');
		panel.className = 'chat-hashtag-nav-dialog';

		const header = document.createElement('div');
		header.className = 'chat-hashtag-nav-header';

		const title = document.createElement('h2');
		title.id = 'chat-hashtag-nav-title';
		title.className = 'chat-hashtag-nav-title';
		title.textContent = label;

		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'chat-hashtag-nav-close';
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.title = 'Close (Esc)';
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', () => closeChatHashtagChoiceModal());

		header.appendChild(title);
		header.appendChild(closeBtn);

		const lead = document.createElement('div');
		lead.className = 'chat-hashtag-nav-lead';

		const illust = document.createElement('div');
		illust.className = 'chat-hashtag-nav-illustration';
		illust.innerHTML = helpIcon('chat-hashtag-nav-illustration-svg');

		const hint = document.createElement('p');
		hint.id = 'chat-hashtag-nav-desc';
		hint.className = 'chat-hashtag-nav-hint';
		hint.textContent = 'Where would you like to go?';

		lead.appendChild(illust);
		lead.appendChild(hint);

		const actions = document.createElement('div');
		actions.className = 'chat-hashtag-nav-actions';

		const btnChannel = document.createElement('button');
		btnChannel.type = 'button';
		btnChannel.className = 'btn-primary chat-hashtag-nav-btn chat-hashtag-nav-btn--channel';
		btnChannel.setAttribute('data-chat-hashtag-pick', 'channel');
		btnChannel.textContent = 'Channel';

		const btnTag = document.createElement('button');
		btnTag.type = 'button';
		btnTag.className = 'btn-secondary chat-hashtag-nav-btn chat-hashtag-nav-btn--tag';
		btnTag.setAttribute('data-chat-hashtag-pick', 'tag');
		btnTag.textContent = 'Tag page';

		actions.appendChild(btnTag);
		actions.appendChild(btnChannel);
		panel.appendChild(header);
		panel.appendChild(lead);
		panel.appendChild(actions);
		overlay.appendChild(panel);

		const onKeydown = (ev) => {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				closeChatHashtagChoiceModal();
			}
		};

		chatHashtagChoiceModalCleanup = () => {
			document.removeEventListener('keydown', onKeydown);
			if (overlay.parentNode) {
				overlay.parentNode.removeChild(overlay);
			}
			try {
				document.body.classList.remove('chat-hashtag-nav-open');
			} catch {
				// ignore
			}
		};

		document.addEventListener('keydown', onKeydown);
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay) {
				closeChatHashtagChoiceModal();
			}
		});
		btnChannel.addEventListener('click', async () => {
			closeChatHashtagChoiceModal();
			await navigateToChatChannelSlug(slug);
		});
		btnTag.addEventListener('click', () => {
			closeChatHashtagChoiceModal();
			window.location.href = `/t/${encodeURIComponent(slug)}`;
		});

		document.body.appendChild(overlay);
		try {
			document.body.classList.add('chat-hashtag-nav-open');
		} catch {
			// ignore
		}
		requestAnimationFrame(() => {
			try {
				btnChannel.focus({ preventScroll: true });
			} catch {
				btnChannel.focus();
			}
		});
	}

	async function navigateToChatChannelSlug(slug) {
		const path = `/chat/c/${encodeURIComponent(slug)}`;
		history.pushState({ prsnChat: true }, '', path);
		await openThreadForCurrentPath();
	}

	async function openChatHashtagDestination(slug) {
		const safe = String(slug || '')
			.trim()
			.toLowerCase();
		if (!safe) {
			return;
		}
		try {
			const res = await fetch(`/api/chat/hashtag-channel-exists/${encodeURIComponent(safe)}${qs}`, {
				credentials: 'include',
			});
			if (res.status === 401) {
				window.location.href = `/t/${encodeURIComponent(safe)}`;
				return;
			}
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				window.location.href = `/t/${encodeURIComponent(safe)}`;
				return;
			}
			if (data.channelExists === true) {
				showChatHashtagChoiceModal(safe);
				return;
			}
			window.location.href = `/t/${encodeURIComponent(safe)}`;
		} catch {
			window.location.href = `/t/${encodeURIComponent(safe)}`;
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
			void addChatFiles(files);
			fileInput.value = '';
		});
	}
	if (addImageInlineBtn instanceof HTMLButtonElement) {
		addImageInlineBtn.addEventListener('click', triggerChatImageFilePicker);
	}

	const exploreClearBtn = root.querySelector('[data-chat-explore-clear-search]');
	if (exploreClearBtn instanceof HTMLButtonElement) {
		exploreClearBtn.addEventListener('click', () => {
			if (activePseudoChannelSlug !== 'explore') return;
			if (isExploreComposerLoadLocked()) return;
			if (!(bodyInput instanceof HTMLTextAreaElement)) return;
			const trimmed = String(bodyInput.value || '').trim();
			const committed = String(exploreQueryRef.q || '').trim();
			const syncedWithResults = committed.length > 0 && trimmed === committed;
			if (syncedWithResults) {
				bodyInput.value = '';
				exploreQueryRef.q = '';
				syncChatExploreComposerChrome();
				void loadExploreChannelMessages();
				return;
			}
			if (trimmed.length > 0 || committed.length > 0) {
				void commitExploreSearchImmediateFromComposer();
				return;
			}
			try {
				bodyInput.focus({ preventScroll: true });
			} catch {
				bodyInput.focus();
			}
		});
	}

	if (bodyInput instanceof HTMLTextAreaElement) {
		attachAutoGrowTextarea(bodyInput);
		attachMentionSuggest(bodyInput);
		bodyInput.addEventListener('input', () => {
			syncChatSendButton();
			syncChatExploreComposerChrome();
		});
		bodyInput.addEventListener('paste', (ev) => {
			if (activePseudoChannelSlug || !activeThreadId || bodyInput.disabled) return;
			if (sendInFlight) return;
			const cd = ev.clipboardData;
			if (!cd) return;
			const imageFiles = [];
			for (const it of cd.items || []) {
				if (it.kind !== 'file') continue;
				const f = it.getAsFile();
				if (f) imageFiles.push(f);
			}
			if (imageFiles.length === 0 && cd.files && cd.files.length > 0) {
				for (const f of cd.files) {
					if (f) imageFiles.push(f);
				}
			}
			if (imageFiles.length === 0) return;
			ev.preventDefault();
			void addChatFiles(imageFiles);
		});
		bodyInput.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Enter' || ev.isComposing) return;
			if (activePseudoChannelSlug === 'explore') {
				if (ev.shiftKey) return;
				if (isExploreComposerLoadLocked()) {
					ev.preventDefault();
					return;
				}
				if (typeof isTriggeredSuggestPopupOpen === 'function' && isTriggeredSuggestPopupOpen(bodyInput)) {
					return;
				}
				ev.preventDefault();
				void commitExploreSearchImmediateFromComposer();
				return;
			}
			if (!ENTER_SENDS) return;
			if (ev.shiftKey) return;
			if (typeof isTriggeredSuggestPopupOpen === 'function' && isTriggeredSuggestPopupOpen(bodyInput)) {
				return;
			}
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
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		tearDownVisibilityResync();
		tearDownRoomBroadcast();
		closeReactionPicker();
		closeChatInlineImageLightbox();
		closeChatHashtagChoiceModal();
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
		if (sidebarNav && typeof chatSidebarDmHoverOverHandler === 'function') {
			sidebarNav.removeEventListener('mouseover', chatSidebarDmHoverOverHandler);
			chatSidebarDmHoverOverHandler = null;
		}
		if (sidebarNav && typeof chatSidebarDmHoverOutHandler === 'function') {
			sidebarNav.removeEventListener('mouseout', chatSidebarDmHoverOutHandler);
			chatSidebarDmHoverOutHandler = null;
		}
		if (sidebarNav && typeof chatSidebarSectionAddHandler === 'function') {
			sidebarNav.removeEventListener('click', chatSidebarSectionAddHandler);
			chatSidebarSectionAddHandler = null;
		}
		hideChatSidebarDmHoverPopover();
		if (chatSidebarDmHoverPopoverEl instanceof HTMLElement) {
			chatSidebarDmHoverPopoverEl.remove();
			chatSidebarDmHoverPopoverEl = null;
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
		if (chatGlobalUnreadPoll != null) {
			clearInterval(chatGlobalUnreadPoll);
			chatGlobalUnreadPoll = null;
		}
		document.removeEventListener('chat-unread-refresh', onChatGlobalUnreadRefreshDoc);
		tearDownChatGlobalUnreadBroadcast();
		try {
			restoreChatGlobalUnreadFavicon();
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
	const topbarMoreBtn = root.querySelector('[data-chat-more-button]');
	const topbarMenu = root.querySelector('[data-chat-topbar-menu]');
	let refreshInFlight = false;
	/** @type {null | ((e: MouseEvent) => void)} */
	let closeTopbarMenuOnOutsideClick = null;

	const closeTopbarMenu = () => {
		closeMobileChromeSheet();
		if (topbarMenu instanceof HTMLElement) {
			topbarMenu.style.display = 'none';
		}
		if (topbarMoreBtn instanceof HTMLButtonElement) {
			topbarMoreBtn.setAttribute('aria-expanded', 'false');
		}
		if (closeTopbarMenuOnOutsideClick) {
			document.removeEventListener('click', closeTopbarMenuOnOutsideClick);
			closeTopbarMenuOnOutsideClick = null;
		}
	};

	const runChatRefresh = () => {
		if (refreshInFlight) return;
		refreshInFlight = true;
		if (refreshBtn instanceof HTMLButtonElement) {
			refreshBtn.disabled = true;
		}
		void openThreadForCurrentPath().finally(() => {
			refreshInFlight = false;
			if (refreshBtn instanceof HTMLButtonElement) {
				refreshBtn.disabled = false;
			}
		});
	};

	if (topbarMoreBtn instanceof HTMLButtonElement && topbarMenu instanceof HTMLElement) {
		topbarMoreBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeMobileChromeSheet();
			const isOpen = topbarMenu.style.display !== 'none';
			if (isOpen) {
				closeTopbarMenu();
				return;
			}
			document.querySelectorAll('[data-feed-menu]').forEach((menuEl) => {
				if (menuEl instanceof HTMLElement && menuEl !== topbarMenu) {
					menuEl.style.display = 'none';
				}
			});
			topbarMenu.style.display = 'block';
			topbarMoreBtn.setAttribute('aria-expanded', 'true');
			void refreshChatCanvasesList();
			closeTopbarMenuOnOutsideClick = (outsideEvent) => {
				if (!(outsideEvent.target instanceof Node)) return;
				if (topbarMenu.contains(outsideEvent.target)) return;
				if (topbarMoreBtn.contains(outsideEvent.target)) return;
				closeTopbarMenu();
			};
			requestAnimationFrame(() => {
				if (closeTopbarMenuOnOutsideClick) {
					document.addEventListener('click', closeTopbarMenuOnOutsideClick);
				}
			});
		});
	}

	if (refreshBtn instanceof HTMLButtonElement) {
		refreshBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeTopbarMenu();
			closeMobileChromeSheet();
			runChatRefresh();
		});
	}

	function isActiveThreadCanvasEligible() {
		if (activePseudoChannelSlug) return false;
		const tid = activeThreadId;
		if (tid == null || !Number.isFinite(Number(tid))) return false;
		const t = (chatThreads || []).find((x) => Number(x.id) === Number(tid));
		if (!t || t.type !== 'channel') return false;
		const slug = String(t.channel_slug || '').toLowerCase().trim();
		if (!slug || CHAT_CANVAS_DISALLOWED_SLUGS.has(slug)) return false;
		return true;
	}

	function rebuildMobileChromeSheet() {
		const body =
			mainColumn instanceof HTMLElement ? mainColumn.querySelector('[data-chat-mobile-chrome-sheet-body]') : null;
		if (!(body instanceof HTMLElement)) return;
		body.replaceChildren();
		if (activePseudoChannelSlug === 'creations') {
			const bulkMb = document.createElement('button');
			bulkMb.type = 'button';
			bulkMb.className = 'feed-card-menu-item';
			bulkMb.dataset.chatCreationsBulkActions = '';
			bulkMb.setAttribute('role', 'menuitem');
			bulkMb.textContent = 'Bulk actions';
			body.appendChild(bulkMb);
			const divTop = document.createElement('div');
			divTop.className = 'chat-page-mobile-chrome-sheet-divider';
			divTop.setAttribute('aria-hidden', 'true');
			body.appendChild(divTop);
		}
		const channelLabel = root.querySelector('[data-chat-title]')?.textContent?.trim() || '';
		const ch = document.createElement('button');
		ch.type = 'button';
		ch.className = 'feed-card-menu-item';
		ch.dataset.chatMobileChromeOpenChannel = '';
		ch.setAttribute('role', 'menuitem');
		ch.textContent = channelLabel;
		if (!activeCanvasRow) ch.classList.add('chat-page-mobile-chrome-sheet-item--current');
		body.appendChild(ch);
		for (const c of chatCanvasesList) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'feed-card-menu-item';
			b.dataset.chatCanvasOpen = String(c.id);
			b.setAttribute('role', 'menuitem');
			b.textContent = c.title;
			if (activeCanvasRow && Number(activeCanvasRow.id) === Number(c.id)) {
				b.classList.add('chat-page-mobile-chrome-sheet-item--current');
			}
			body.appendChild(b);
		}
		const divider = document.createElement('div');
		divider.className = 'chat-page-mobile-chrome-sheet-divider';
		divider.setAttribute('aria-hidden', 'true');
		body.appendChild(divider);
		const refresh = document.createElement('button');
		refresh.type = 'button';
		refresh.className = 'feed-card-menu-item';
		refresh.dataset.chatMobileChromeRefresh = '';
		refresh.setAttribute('role', 'menuitem');
		refresh.textContent = 'Refresh';
		body.appendChild(refresh);
		if (isActiveThreadCanvasEligible() && chatViewerIsFounder) {
			const createBtn = document.createElement('button');
			createBtn.type = 'button';
			createBtn.className = 'feed-card-menu-item';
			createBtn.dataset.chatCanvasCreate = '';
			createBtn.setAttribute('role', 'menuitem');
			createBtn.textContent = 'Create canvas…';
			body.appendChild(createBtn);
		}
		if (activeCanvasRow && isActiveThreadCanvasEligible()) {
			const isOwner = Number(activeCanvasRow.sender_id) === Number(chatViewerId);
			if (isOwner) {
				const edit = document.createElement('button');
				edit.type = 'button';
				edit.className = 'feed-card-menu-item';
				edit.dataset.chatCanvasEdit = '';
				edit.setAttribute('role', 'menuitem');
				edit.textContent = 'Edit canvas';
				body.appendChild(edit);
			}
			if (!isChatPageMobileLayout()) {
				const pinId = activeThreadPinnedCanvasId;
				const isPinnedRow = Number.isFinite(pinId) && pinId === Number(activeCanvasRow.id);
				if (isOwner) {
					const pin = document.createElement('button');
					pin.type = 'button';
					pin.className = 'feed-card-menu-item';
					pin.dataset.chatCanvasPin = '';
					pin.setAttribute('role', 'menuitem');
					pin.textContent = 'Pin to channel';
					if (isPinnedRow) pin.hidden = true;
					body.appendChild(pin);
				}
				if (isPinnedRow && (isOwner || chatViewerIsAdmin)) {
					const unp = document.createElement('button');
					unp.type = 'button';
					unp.className = 'feed-card-menu-item';
					unp.dataset.chatCanvasUnpin = '';
					unp.setAttribute('role', 'menuitem');
					unp.textContent = 'Remove channel pin';
					body.appendChild(unp);
				}
			}
		}
	}

	function closeMobileChromeSheet() {
		const col = mainColumn instanceof HTMLElement ? mainColumn : null;
		const sheet = col?.querySelector('[data-chat-mobile-chrome-sheet]');
		const trig = col?.querySelector('[data-chat-mobile-chrome-sheet-trigger]');
		if (sheet instanceof HTMLElement) {
			sheet.hidden = true;
			sheet.setAttribute('aria-hidden', 'true');
		}
		if (trig instanceof HTMLButtonElement) {
			trig.setAttribute('aria-expanded', 'false');
		}
		if (typeof document !== 'undefined' && document.body) {
			document.body.classList.remove('chat-page--mobile-chrome-sheet-open');
		}
		if (mobileChromeEscapeKeyHandler) {
			document.removeEventListener('keydown', mobileChromeEscapeKeyHandler);
			mobileChromeEscapeKeyHandler = null;
		}
	}

	function openMobileChromeSheet() {
		void refreshChatCanvasesList();
		rebuildMobileChromeSheet();
		const col = mainColumn instanceof HTMLElement ? mainColumn : null;
		const sheet = col?.querySelector('[data-chat-mobile-chrome-sheet]');
		const trig = col?.querySelector('[data-chat-mobile-chrome-sheet-trigger]');
		if (sheet instanceof HTMLElement) {
			sheet.hidden = false;
			sheet.setAttribute('aria-hidden', 'false');
		}
		if (trig instanceof HTMLButtonElement) {
			trig.setAttribute('aria-expanded', 'true');
		}
		if (typeof document !== 'undefined' && document.body) {
			document.body.classList.add('chat-page--mobile-chrome-sheet-open');
		}
		if (mobileChromeEscapeKeyHandler) {
			document.removeEventListener('keydown', mobileChromeEscapeKeyHandler);
			mobileChromeEscapeKeyHandler = null;
		}
		mobileChromeEscapeKeyHandler = (ev) => {
			if (ev.key === 'Escape') closeMobileChromeSheet();
		};
		document.addEventListener('keydown', mobileChromeEscapeKeyHandler);
	}

	function getChatCanvasPanelEls() {
		return {
			panel: chatCanvasScope.querySelector('[data-chat-canvas-panel]'),
			titleView: chatCanvasScope.querySelector('[data-chat-canvas-title-view]'),
			titleInput: chatCanvasScope.querySelector('[data-chat-canvas-title-input]'),
			bodyView: chatCanvasScope.querySelector('[data-chat-canvas-body-view]'),
			bodyInput: chatCanvasScope.querySelector('[data-chat-canvas-body-input]'),
			editFooter: chatCanvasScope.querySelector('[data-chat-canvas-edit-footer]'),
			moreWrap: chatCanvasScope.querySelector('[data-chat-canvas-more-wrap]'),
			moreBtn: chatCanvasScope.querySelector('[data-chat-canvas-more]'),
			ownerMenu: chatCanvasScope.querySelector('[data-chat-canvas-owner-menu]')
		};
	}

	function setChatCanvasOpenBodyClass(on) {
		if (typeof document !== 'undefined' && document.body) {
			document.body.classList.toggle('chat-page--canvas-open', Boolean(on));
		}
		paintMobileChromeTitle();
	}

	function closeCanvasOwnerDropdown() {
		const { ownerMenu, moreBtn } = getChatCanvasPanelEls();
		if (ownerMenu instanceof HTMLElement) ownerMenu.style.display = 'none';
		if (moreBtn instanceof HTMLButtonElement) moreBtn.setAttribute('aria-expanded', 'false');
		if (chatCanvasOwnerMenuOutside) {
			document.removeEventListener('click', chatCanvasOwnerMenuOutside);
			chatCanvasOwnerMenuOutside = null;
		}
	}

	function exitCanvasEditUi({ revert } = {}) {
		const el = getChatCanvasPanelEls();
		const rev = revert === true;
		if (rev && activeCanvasRow) {
			if (el.titleInput instanceof HTMLInputElement) el.titleInput.value = chatCanvasEditSnapshot.title;
			if (el.bodyInput instanceof HTMLTextAreaElement) el.bodyInput.value = chatCanvasEditSnapshot.body;
		}
		if (el.titleView instanceof HTMLElement) el.titleView.hidden = false;
		if (el.titleInput instanceof HTMLElement) el.titleInput.hidden = true;
		if (el.bodyView instanceof HTMLElement) el.bodyView.hidden = false;
		if (el.bodyInput instanceof HTMLElement) el.bodyInput.hidden = true;
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = true;
		if (activeCanvasRow && Number(activeCanvasRow.sender_id) === Number(chatViewerId)) {
			if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = false;
		}
		if (activeCanvasRow) paintCanvasPanelReadOnly();
	}

	function paintCanvasPanelReadOnly() {
		const el = getChatCanvasPanelEls();
		if (!activeCanvasRow) return;
		if (el.titleView instanceof HTMLElement) el.titleView.textContent = activeCanvasRow.title;
		if (el.bodyView instanceof HTMLElement) {
			/** Prefer server-rendered markdown HTML from GET …/canvases (`body_html`); else linkify plain text. */
			const serverHtml =
				typeof activeCanvasRow.body_html === 'string' ? activeCanvasRow.body_html.trim() : '';
			if (serverHtml) {
				el.bodyView.innerHTML = serverHtml;
				el.bodyView.classList.add('chat-page-canvas-body--markdown');
			} else {
				el.bodyView.innerHTML = processUserText(activeCanvasRow.body || '');
				el.bodyView.classList.remove('chat-page-canvas-body--markdown');
			}
			hydrateUserTextLinks(el.bodyView);
			hydrateChatCreationEmbeds(el.bodyView);
			hydrateChatYoutubeEmbeds(el.bodyView);
		}
		const isOwner = Number(activeCanvasRow.sender_id) === Number(chatViewerId);
		if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = !isOwner;
		const pinBtn = chatCanvasScope.querySelector('[data-chat-canvas-pin]');
		const unpBtn = chatCanvasScope.querySelector('[data-chat-canvas-unpin]');
		const pinId = activeThreadPinnedCanvasId;
		const isPinnedRow = Number.isFinite(pinId) && pinId === Number(activeCanvasRow.id);
		if (pinBtn instanceof HTMLElement) {
			pinBtn.hidden = !isOwner || isPinnedRow;
		}
		if (unpBtn instanceof HTMLElement) {
			unpBtn.hidden = !isPinnedRow || (!isOwner && !chatViewerIsAdmin);
		}
		rebuildMobileChromeSheet();
		paintMobileChromeTitle();
	}

	function enterCanvasEditUi() {
		if (!activeCanvasRow) return;
		const el = getChatCanvasPanelEls();
		chatCanvasEditSnapshot = { title: activeCanvasRow.title, body: activeCanvasRow.body };
		closeCanvasOwnerDropdown();
		if (el.titleView instanceof HTMLElement) el.titleView.hidden = true;
		if (el.titleInput instanceof HTMLInputElement) {
			el.titleInput.hidden = false;
			el.titleInput.value = activeCanvasRow.title;
			el.titleInput.focus();
		}
		if (el.bodyView instanceof HTMLElement) el.bodyView.hidden = true;
		if (el.bodyInput instanceof HTMLTextAreaElement) {
			el.bodyInput.hidden = false;
			el.bodyInput.value = activeCanvasRow.body;
		}
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = false;
		if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = true;
	}

	const CHAT_OPEN_CANVAS_BY_THREAD_LS = 'prsn-chat-open-canvas-by-thread-v1';

	function readOpenCanvasByThreadMap() {
		try {
			const raw = window.localStorage?.getItem(CHAT_OPEN_CANVAS_BY_THREAD_LS);
			if (!raw) return {};
			const o = JSON.parse(raw);
			return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
		} catch {
			return {};
		}
	}

	function writeOpenCanvasByThreadMap(map) {
		try {
			window.localStorage.setItem(CHAT_OPEN_CANVAS_BY_THREAD_LS, JSON.stringify(map));
		} catch {
			// ignore quota / private mode
		}
	}

	function rememberOpenCanvasForActiveThread(canvasMessageId) {
		const tid = activeThreadId;
		if (tid == null || !Number.isFinite(Number(tid)) || Number(tid) <= 0) return;
		const mid = Number(canvasMessageId);
		if (!Number.isFinite(mid) || mid <= 0) return;
		const map = readOpenCanvasByThreadMap();
		map[String(tid)] = mid;
		writeOpenCanvasByThreadMap(map);
	}

	function forgetOpenCanvasForThread(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		const map = readOpenCanvasByThreadMap();
		if (map[String(tid)] == null) return;
		delete map[String(tid)];
		writeOpenCanvasByThreadMap(map);
	}

	function getStoredOpenCanvasIdForThread(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		const v = readOpenCanvasByThreadMap()[String(tid)];
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	function openChatCanvasPanel(row) {
		closeMobileChromeSheet();
		closeCanvasOwnerDropdown();
		activeCanvasRow = {
			id: Number(row.id),
			title: String(row.title || '').trim(),
			body: row.body != null ? String(row.body) : '',
			body_html: typeof row.body_html === 'string' ? row.body_html : null,
			sender_id: Number(row.sender_id)
		};
		const el = getChatCanvasPanelEls();
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = true;
		if (el.titleInput instanceof HTMLElement) el.titleInput.hidden = true;
		if (el.bodyInput instanceof HTMLElement) el.bodyInput.hidden = true;
		if (el.titleView instanceof HTMLElement) el.titleView.hidden = false;
		if (el.bodyView instanceof HTMLElement) el.bodyView.hidden = false;
		if (el.panel instanceof HTMLElement) el.panel.hidden = false;
		setChatCanvasOpenBodyClass(true);
		paintCanvasPanelReadOnly();
		syncTopbarPinnedCanvasButton();
		rememberOpenCanvasForActiveThread(activeCanvasRow.id);
	}

	closeChatCanvasPanel = ({ forgetOpenPreference = false } = {}) => {
		if (forgetOpenPreference && activeThreadId != null) {
			forgetOpenCanvasForThread(activeThreadId);
		}
		closeMobileChromeSheet();
		closeCanvasOwnerDropdown();
		activeCanvasRow = null;
		const el = getChatCanvasPanelEls();
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = true;
		if (el.titleInput instanceof HTMLElement) el.titleInput.hidden = true;
		if (el.bodyInput instanceof HTMLElement) el.bodyInput.hidden = true;
		if (el.titleView instanceof HTMLElement) {
			el.titleView.hidden = false;
			el.titleView.textContent = '';
		}
		if (el.bodyView instanceof HTMLElement) {
			el.bodyView.hidden = false;
			el.bodyView.innerHTML = '';
			el.bodyView.classList.remove('chat-page-canvas-body--markdown');
		}
		if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = true;
		if (el.panel instanceof HTMLElement) el.panel.hidden = true;
		setChatCanvasOpenBodyClass(false);
		syncTopbarPinnedCanvasButton();
	};

	/** Desktop: show pinned canvas name in the top bar; click opens the canvas panel (no auto-open). */
	function syncTopbarPinnedCanvasButton() {
		const desktopBtn = root.querySelector('[data-chat-topbar-pinned-canvas]');
		const mobileBtn = mainColumn instanceof HTMLElement
			? mainColumn.querySelector('[data-chat-mobile-pinned-canvas]')
			: null;
		const isMobile = isChatPageMobileLayout();

		const applyButtonState = (btn, { mobile = false } = {}) => {
			if (!(btn instanceof HTMLButtonElement)) return;
			btn.removeAttribute('data-chat-canvas-open');
			if ((mobile && !isMobile) || (!mobile && isMobile)) {
				btn.hidden = true;
				btn.textContent = '';
				btn.removeAttribute('aria-label');
				return;
			}
			if (!isActiveThreadCanvasEligible()) {
				btn.hidden = true;
				btn.textContent = '';
				btn.removeAttribute('aria-label');
				return;
			}
			const pinId = activeThreadPinnedCanvasId;
			if (!Number.isFinite(pinId) || pinId <= 0) {
				btn.hidden = true;
				btn.textContent = '';
				btn.removeAttribute('aria-label');
				return;
			}
			const row = chatCanvasesList.find((c) => Number(c.id) === pinId);
			if (!row) {
				btn.hidden = true;
				btn.textContent = '';
				btn.removeAttribute('aria-label');
				return;
			}
			const panelEl = getChatCanvasPanelEls().panel;
			const panelOpen = panelEl instanceof HTMLElement && !panelEl.hidden;
			const viewingPinnedInPanel =
				panelOpen &&
				activeCanvasRow != null &&
				Number(activeCanvasRow.id) === Number(pinId);
			if (viewingPinnedInPanel && !mobile) {
				btn.hidden = true;
				btn.textContent = '';
				btn.removeAttribute('aria-label');
				return;
			}
			const title = String(row.title || '').trim() || 'Canvas';
			btn.hidden = false;
			btn.textContent = title;
			btn.setAttribute('data-chat-canvas-open', String(row.id));
			btn.classList.toggle('is-active', viewingPinnedInPanel);
			btn.setAttribute(
				'aria-label',
				viewingPinnedInPanel ? `Return to channel from pinned canvas: ${title}` : `Open pinned canvas: ${title}`
			);
		};

		applyButtonState(desktopBtn, { mobile: false });
		applyButtonState(mobileBtn, { mobile: true });
	}

	rebuildTopbarMenuDynamic = () => {
		const dyn = root.querySelector('[data-chat-topbar-menu-dynamic]');
		if (!(dyn instanceof HTMLElement)) {
			rebuildMobileChromeSheet();
			syncTopbarPinnedCanvasButton();
			return;
		}
		dyn.replaceChildren();
		if (activePseudoChannelSlug === 'creations') {
			const bulkBtn = document.createElement('button');
			bulkBtn.type = 'button';
			bulkBtn.className = 'feed-card-menu-item';
			bulkBtn.dataset.chatCreationsBulkActions = '';
			bulkBtn.setAttribute('role', 'menuitem');
			bulkBtn.textContent = 'Bulk actions';
			dyn.appendChild(bulkBtn);
		}
		if (isActiveThreadCanvasEligible() && chatViewerIsFounder) {
			const createBtn = document.createElement('button');
			createBtn.type = 'button';
			createBtn.className = 'feed-card-menu-item';
			createBtn.dataset.chatCanvasCreate = '';
			createBtn.textContent = 'Create canvas…';
			dyn.appendChild(createBtn);
		}
		for (const c of chatCanvasesList) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'feed-card-menu-item';
			b.dataset.chatCanvasOpen = String(c.id);
			b.textContent = c.title;
			dyn.appendChild(b);
		}
		rebuildMobileChromeSheet();
		syncTopbarPinnedCanvasButton();
	};

	if (typeof window !== 'undefined') {
		const onPinnedCanvasBtnLayout = () => syncTopbarPinnedCanvasButton();
		window.addEventListener('resize', onPinnedCanvasBtnLayout, { passive: true });
		try {
			window.matchMedia('(max-width: 768px)').addEventListener('change', onPinnedCanvasBtnLayout);
		} catch {
			// ignore
		}
	}

	refreshChatCanvasesList = async () => {
		if (!isActiveThreadCanvasEligible()) {
			chatCanvasesList = [];
			activeThreadPinnedCanvasId = null;
			rebuildTopbarMenuDynamic();
			return;
		}
		const tid = activeThreadId;
		try {
			const res = await fetch(`/api/chat/threads/${tid}/canvases`, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			chatCanvasesList = res.ok && Array.isArray(data.canvases) ? data.canvases : [];
			const pinRaw = data?.pinned_message_id ?? data?.pinnedMessageId;
			const pinNum = pinRaw != null ? Number(pinRaw) : null;
			activeThreadPinnedCanvasId =
				Number.isFinite(pinNum) && pinNum > 0 ? pinNum : null;
		} catch {
			chatCanvasesList = [];
			activeThreadPinnedCanvasId = null;
		}
		rebuildTopbarMenuDynamic();
		if (activeCanvasRow) {
			const up = chatCanvasesList.find((x) => Number(x.id) === Number(activeCanvasRow.id));
			if (up) {
				activeCanvasRow = {
					id: Number(up.id),
					title: String(up.title || '').trim(),
					body: up.body != null ? String(up.body) : '',
					body_html: typeof up.body_html === 'string' ? up.body_html : null,
					sender_id: Number(up.sender_id)
				};
				const el = getChatCanvasPanelEls();
				const editing = el.editFooter instanceof HTMLElement && !el.editFooter.hidden;
				if (!editing) paintCanvasPanelReadOnly();
			} else {
				closeChatCanvasPanel({ forgetOpenPreference: true });
			}
		} else if (tid != null && Number.isFinite(Number(tid)) && Number(tid) > 0) {
			// Mobile should load the channel first; canvases are opened explicitly
			// via chevron menu (or desktop pinned-canvas button).
			if (isChatPageMobileLayout()) {
				syncTopbarPinnedCanvasButton();
				return;
			}
			const savedId = getStoredOpenCanvasIdForThread(tid);
			if (savedId != null) {
				const row = chatCanvasesList.find((c) => Number(c.id) === savedId);
				if (row) {
					openChatCanvasPanel(row);
				} else {
					forgetOpenCanvasForThread(tid);
				}
			}
		}
	};

	function closeChatCanvasCreateOverlay() {
		if (typeof chatCanvasCreateCleanup === 'function') {
			try {
				chatCanvasCreateCleanup();
			} catch {
				// ignore
			}
			chatCanvasCreateCleanup = null;
		}
	}

	function showChatCanvasCreateOverlay() {
		closeChatCanvasCreateOverlay();
		if (!isActiveThreadCanvasEligible() || !chatViewerIsFounder) return;
		const overlay = document.createElement('div');
		overlay.className = 'chat-canvas-create-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Create canvas');

		const panel = document.createElement('div');
		panel.className = 'chat-canvas-create-dialog';

		const titleIn = document.createElement('input');
		titleIn.type = 'text';
		titleIn.className = 'chat-canvas-create-title';
		titleIn.maxLength = 200;
		titleIn.placeholder = 'Canvas title';

		const bodyTa = document.createElement('textarea');
		bodyTa.className = 'chat-canvas-create-body';
		bodyTa.rows = 10;
		bodyTa.maxLength = 4000;
		bodyTa.placeholder = 'Canvas body';

		const actions = document.createElement('div');
		actions.className = 'chat-canvas-create-actions';
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.className = 'btn-secondary';
		cancel.textContent = 'Cancel';
		const create = document.createElement('button');
		create.type = 'button';
		create.className = 'btn-primary';
		create.textContent = 'Create';
		actions.appendChild(cancel);
		actions.appendChild(create);

		panel.appendChild(titleIn);
		panel.appendChild(bodyTa);
		panel.appendChild(actions);
		overlay.appendChild(panel);
		document.body.appendChild(overlay);

		const onKey = (ev) => {
			if (ev.key === 'Escape') closeChatCanvasCreateOverlay();
		};
		const tid = activeThreadId;
		const onCreate = async () => {
			const title = String(titleIn.value || '').trim();
			const body = String(bodyTa.value || '').trim();
			if (!title || !body) return;
			create.disabled = true;
			try {
				const res = await fetch(`/api/chat/threads/${tid}/canvases`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify({ title, body })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					const msg = data.message || data.error || 'Could not create canvas';
					window.alert(msg);
					create.disabled = false;
					return;
				}
				closeChatCanvasCreateOverlay();
				const msgRow = data.message;
				const id = msgRow?.id != null ? Number(msgRow.id) : null;
				await refreshChatCanvasesList();
				await loadMessages();
				if (Number.isFinite(id) && id > 0) {
					const row = chatCanvasesList.find((c) => Number(c.id) === id) || {
						id,
						title,
						body,
						sender_id: chatViewerId
					};
					openChatCanvasPanel(row);
				}
			} catch (err) {
				window.alert(err?.message || 'Could not create canvas');
				create.disabled = false;
			}
		};
		cancel.addEventListener('click', () => closeChatCanvasCreateOverlay());
		create.addEventListener('click', () => void onCreate());
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay) closeChatCanvasCreateOverlay();
		});
		document.addEventListener('keydown', onKey);
		chatCanvasCreateCleanup = () => {
			document.removeEventListener('keydown', onKey);
			overlay.remove();
		};
		titleIn.focus();
	}

	tearDownChatCanvasUi = () => {
		closeChatCanvasCreateOverlay();
		closeMobileChromeSheet();
		closeChatCanvasPanel();
		chatCanvasesList = [];
		activeThreadPinnedCanvasId = null;
		rebuildTopbarMenuDynamic();
	};

	canvasActionRoot.addEventListener('click', (e) => {
		const t = e.target;
		if (!(t instanceof Element)) return;
		const back = t.closest('[data-chat-mobile-chrome-back]');
		if (
			(back instanceof HTMLButtonElement || back instanceof HTMLAnchorElement) &&
			mainColumn instanceof HTMLElement &&
			mainColumn.contains(back)
		) {
			e.preventDefault();
			e.stopPropagation();
			const next = `/chat${window.location.search || ''}#channels`;
			const cur = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
			if (next !== cur) {
				history.pushState({ prsnChat: true }, '', next);
				try {
					window.dispatchEvent(new HashChangeEvent('hashchange'));
				} catch {
					window.dispatchEvent(new Event('hashchange'));
				}
			}
			setMobileSidebarMode(true);
			return;
		}
		const topbarBack = t.closest('.chat-page-topbar .chat-page-back');
		if (
			topbarBack instanceof HTMLAnchorElement &&
			mainColumn instanceof HTMLElement &&
			mainColumn.contains(topbarBack) &&
			isChatPageMobileLayout()
		) {
			e.preventDefault();
			e.stopPropagation();
			const next = `/chat${window.location.search || ''}#channels`;
			const cur = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
			if (next !== cur) {
				history.pushState({ prsnChat: true }, '', next);
				try {
					window.dispatchEvent(new HashChangeEvent('hashchange'));
				} catch {
					window.dispatchEvent(new Event('hashchange'));
				}
			}
			setMobileSidebarMode(true);
			return;
		}
		const sheetTrig = t.closest('[data-chat-mobile-chrome-sheet-trigger]');
		if (
			sheetTrig instanceof HTMLButtonElement &&
			mainColumn instanceof HTMLElement &&
			mainColumn.contains(sheetTrig)
		) {
			e.preventDefault();
			e.stopPropagation();
			const sheet = mainColumn.querySelector('[data-chat-mobile-chrome-sheet]');
			if (!(sheet instanceof HTMLElement)) return;
			const isHidden = sheet.hasAttribute('hidden');
			if (isHidden) {
				closeTopbarMenu();
				openMobileChromeSheet();
			} else {
				closeMobileChromeSheet();
			}
			return;
		}
		const mobilePinnedCanvasBtn = t.closest('[data-chat-mobile-pinned-canvas][data-chat-canvas-open]');
		if (mobilePinnedCanvasBtn instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const mid = Number(mobilePinnedCanvasBtn.getAttribute('data-chat-canvas-open'));
			if (Number.isFinite(mid) && mid > 0) {
				const panelEl = getChatCanvasPanelEls().panel;
				const panelOpen = panelEl instanceof HTMLElement && !panelEl.hidden;
				const isViewingThisPinned =
					panelOpen &&
					activeCanvasRow != null &&
					Number(activeCanvasRow.id) === mid;
				if (isViewingThisPinned) {
					closeChatCanvasPanel();
					return;
				}
				const row = chatCanvasesList.find((c) => Number(c.id) === mid);
				if (row) openChatCanvasPanel(row);
			}
			return;
		}
		if (t.closest('[data-chat-mobile-chrome-sheet-dismiss]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			return;
		}
		const creationsBulkTrig = t.closest('[data-chat-creations-bulk-actions]');
		if (creationsBulkTrig instanceof HTMLElement && mainColumn?.contains(creationsBulkTrig)) {
			e.preventDefault();
			closeTopbarMenu();
			closeMobileChromeSheet();
			const host = root.querySelector('[data-chat-creations-bulk-host]');
			if (host instanceof HTMLElement && typeof host._enterChatCreationsBulk === 'function') {
				host._enterChatCreationsBulk();
			}
			return;
		}
		if (t.closest('[data-chat-mobile-chrome-open-channel]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			closeTopbarMenu();
			closeChatCanvasPanel();
			return;
		}
		if (t.closest('[data-chat-mobile-chrome-refresh]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			closeTopbarMenu();
			runChatRefresh();
			return;
		}
		if (t.closest('[data-chat-canvas-create]')) {
			e.preventDefault();
			closeTopbarMenu();
			closeMobileChromeSheet();
			showChatCanvasCreateOverlay();
			return;
		}
		const openEl = t.closest('[data-chat-canvas-open]');
		if (openEl instanceof HTMLElement) {
			e.preventDefault();
			closeTopbarMenu();
			closeMobileChromeSheet();
			const id = Number(openEl.getAttribute('data-chat-canvas-open'));
			const row = chatCanvasesList.find((c) => Number(c.id) === id);
			if (row) openChatCanvasPanel(row);
			return;
		}
		if (t.closest('[data-chat-canvas-close]')) {
			e.preventDefault();
			closeChatCanvasPanel({ forgetOpenPreference: true });
			return;
		}
		if (t.closest('[data-chat-canvas-edit]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			closeCanvasOwnerDropdown();
			enterCanvasEditUi();
			return;
		}
		if (t.closest('[data-chat-canvas-cancel]')) {
			e.preventDefault();
			exitCanvasEditUi({ revert: true });
			paintCanvasPanelReadOnly();
			return;
		}
		if (t.closest('[data-chat-canvas-delete]')) {
			e.preventDefault();
			if (!activeCanvasRow) return;
			if (!window.confirm('Delete this canvas?')) return;
			const mid = Number(activeCanvasRow.id);
			void (async () => {
				try {
					const res = await fetch(`/api/chat/messages/${mid}`, {
						method: 'DELETE',
						credentials: 'include'
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						window.alert(data.message || data.error || 'Could not delete');
						return;
					}
					closeChatCanvasPanel({ forgetOpenPreference: true });
					await refreshChatCanvasesList();
					await loadMessages();
				} catch (err) {
					window.alert(err?.message || 'Could not delete');
				}
			})();
			return;
		}
		if (t.closest('[data-chat-canvas-pin]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			closeCanvasOwnerDropdown();
			if (!activeCanvasRow || activeThreadId == null) return;
			const mid = Number(activeCanvasRow.id);
			if (!Number.isFinite(mid) || mid <= 0) return;
			void (async () => {
				try {
					const res = await fetch(`/api/chat/threads/${activeThreadId}/pinned-canvas`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						body: JSON.stringify({ message_id: mid })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						window.alert(data.message || data.error || 'Could not pin canvas');
						return;
					}
					const p = data?.pinned_message_id ?? data?.pinnedMessageId;
					const pn = p != null ? Number(p) : mid;
					activeThreadPinnedCanvasId = Number.isFinite(pn) && pn > 0 ? pn : mid;
					paintCanvasPanelReadOnly();
					await refreshChatCanvasesList();
				} catch (err) {
					window.alert(err?.message || 'Could not pin canvas');
				}
			})();
			return;
		}
		if (t.closest('[data-chat-canvas-unpin]')) {
			e.preventDefault();
			closeMobileChromeSheet();
			closeCanvasOwnerDropdown();
			if (activeThreadId == null) return;
			void (async () => {
				try {
					const res = await fetch(`/api/chat/threads/${activeThreadId}/pinned-canvas`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						body: JSON.stringify({ message_id: null })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						window.alert(data.message || data.error || 'Could not remove pin');
						return;
					}
					activeThreadPinnedCanvasId = null;
					paintCanvasPanelReadOnly();
					await refreshChatCanvasesList();
				} catch (err) {
					window.alert(err?.message || 'Could not remove pin');
				}
			})();
			return;
		}
		if (t.closest('[data-chat-canvas-save]')) {
			e.preventDefault();
			if (!activeCanvasRow) return;
			const el = getChatCanvasPanelEls();
			if (!(el.titleInput instanceof HTMLInputElement) || !(el.bodyInput instanceof HTMLTextAreaElement)) return;
			const title = String(el.titleInput.value || '').trim();
			const body = String(el.bodyInput.value || '').trim();
			if (!title || !body) return;
			const mid = Number(activeCanvasRow.id);
			void (async () => {
				try {
					const res = await fetch(`/api/chat/messages/${mid}`, {
						method: 'PATCH',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						body: JSON.stringify({ title, body })
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						window.alert(data.message || data.error || 'Could not save');
						return;
					}
					const msgRow = data.message;
					if (msgRow) {
						const cm = getChatCanvasMetaFromMessage(msgRow);
						activeCanvasRow = {
							id: Number(msgRow.id),
							title: cm?.title || title,
							body: msgRow.body != null ? String(msgRow.body) : body,
							body_html: null,
							sender_id: Number(msgRow.sender_id)
						};
					}
					exitCanvasEditUi({ revert: false });
					paintCanvasPanelReadOnly();
					await refreshChatCanvasesList();
					await loadMessages();
				} catch (err) {
					window.alert(err?.message || 'Could not save');
				}
			})();
			return;
		}
	});

	const canvasMoreBtn = chatCanvasScope.querySelector('[data-chat-canvas-more]');
	const canvasOwnerMenu = chatCanvasScope.querySelector('[data-chat-canvas-owner-menu]');
	if (canvasMoreBtn instanceof HTMLButtonElement && canvasOwnerMenu instanceof HTMLElement) {
		canvasMoreBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			const isOpen = canvasOwnerMenu.style.display !== 'none';
			if (isOpen) {
				closeCanvasOwnerDropdown();
				return;
			}
			canvasOwnerMenu.style.display = 'block';
			canvasMoreBtn.setAttribute('aria-expanded', 'true');
			chatCanvasOwnerMenuOutside = (outsideEvent) => {
				if (!(outsideEvent.target instanceof Node)) return;
				if (canvasOwnerMenu.contains(outsideEvent.target)) return;
				if (canvasMoreBtn.contains(outsideEvent.target)) return;
				closeCanvasOwnerDropdown();
			};
			requestAnimationFrame(() => {
				if (chatCanvasOwnerMenuOutside) {
					document.addEventListener('click', chatCanvasOwnerMenuOutside);
				}
			});
		});
	}

	const CHAT_CANVAS_WIDTH_LS = 'prsn-chat-canvas-width-px';
	const CHAT_CANVAS_WIDTH_MIN = 260;
	const CHAT_CANVAS_WIDTH_MAX = 720;
	const CHAT_SIDEBAR_WIDTH_LS = 'prsn-chat-sidebar-width-px';
	const CHAT_SIDEBAR_WIDTH_MIN = 220;
	const CHAT_SIDEBAR_WIDTH_MAX = 460;
	const CHAT_THREAD_PANE_MIN = 420;

	const chatLayoutOuter = root.closest('.chat-page-layout');

	function readCssPxVar(varName) {
		try {
			const fromLayout =
				chatLayoutOuter instanceof HTMLElement
					? getComputedStyle(chatLayoutOuter).getPropertyValue(varName)
					: '';
			const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(varName);
			const raw = String(fromLayout || fromRoot || '').trim();
			if (!raw) return null;
			const n = Number(raw.replace(/px$/i, '').trim());
			return Number.isFinite(n) ? n : null;
		} catch {
			return null;
		}
	}

	function getChatCanvasWidthBounds() {
		const viewport = Math.max(0, window.innerWidth || 0);
		const sidebarWidth =
			readCssPxVar('--chat-sidebar-width') ?? CHAT_SIDEBAR_WIDTH_MIN;
		const maxByViewport = viewport - sidebarWidth - CHAT_THREAD_PANE_MIN;
		const dynamicMax = Math.min(CHAT_CANVAS_WIDTH_MAX, Math.floor(maxByViewport));
		const max = Math.max(CHAT_CANVAS_WIDTH_MIN, dynamicMax);
		return { min: CHAT_CANVAS_WIDTH_MIN, max };
	}

	function getChatSidebarWidthBounds() {
		const viewport = Math.max(0, window.innerWidth || 0);
		const canvasPanel = chatLayoutRoot?.querySelector?.('[data-chat-canvas-panel]');
		const canvasVisible = canvasPanel instanceof HTMLElement && !canvasPanel.hidden;
		const canvasWidth = canvasVisible
			? canvasPanel.getBoundingClientRect().width || (readCssPxVar('--chat-canvas-panel-width') ?? CHAT_CANVAS_WIDTH_MIN)
			: 0;
		const maxByViewport = viewport - canvasWidth - CHAT_THREAD_PANE_MIN;
		const dynamicMax = Math.min(CHAT_SIDEBAR_WIDTH_MAX, Math.floor(maxByViewport));
		const max = Math.max(CHAT_SIDEBAR_WIDTH_MIN, dynamicMax);
		return { min: CHAT_SIDEBAR_WIDTH_MIN, max };
	}

	function clampChatCanvasWidthPx(n) {
		const x = Number(n);
		if (!Number.isFinite(x)) return null;
		const bounds = getChatCanvasWidthBounds();
		return Math.min(bounds.max, Math.max(bounds.min, Math.round(x)));
	}

	function clampChatSidebarWidthPx(n) {
		const x = Number(n);
		if (!Number.isFinite(x)) return null;
		const bounds = getChatSidebarWidthBounds();
		return Math.min(bounds.max, Math.max(bounds.min, Math.round(x)));
	}

	function readStoredChatCanvasWidthPx() {
		try {
			const raw = window.localStorage.getItem(CHAT_CANVAS_WIDTH_LS);
			if (raw == null || raw === '') return null;
			return clampChatCanvasWidthPx(Number(raw));
		} catch {
			return null;
		}
	}

	function readStoredChatSidebarWidthPx() {
		try {
			const raw = window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_LS);
			if (raw == null || raw === '') return null;
			return clampChatSidebarWidthPx(Number(raw));
		} catch {
			return null;
		}
	}

	function applyChatCanvasPanelWidthPx(px) {
		if (!(chatLayoutRoot instanceof HTMLElement)) return;
		const v = clampChatCanvasWidthPx(px);
		if (v == null) {
			chatLayoutRoot.style.removeProperty('--chat-canvas-panel-width');
			document.documentElement.style.removeProperty('--chat-canvas-panel-width');
			return;
		}
		chatLayoutRoot.style.setProperty('--chat-canvas-panel-width', `${v}px`);
		document.documentElement.style.setProperty('--chat-canvas-panel-width', `${v}px`);
	}

	function applyChatSidebarWidthPx(px) {
		const host = chatLayoutOuter instanceof HTMLElement ? chatLayoutOuter : null;
		if (!host) return;
		const v = clampChatSidebarWidthPx(px);
		if (v == null) {
			host.style.removeProperty('--chat-sidebar-width');
			document.documentElement.style.removeProperty('--chat-sidebar-width');
			return;
		}
		host.style.setProperty('--chat-sidebar-width', `${v}px`);
		document.documentElement.style.setProperty('--chat-sidebar-width', `${v}px`);
	}

	if (chatLayoutOuter instanceof HTMLElement) {
		const storedSidebar = readStoredChatSidebarWidthPx();
		if (storedSidebar != null) applyChatSidebarWidthPx(storedSidebar);
		const sidebarResizeHandle = chatLayoutOuter.querySelector('[data-chat-sidebar-resize-handle]');
		const sidebarEl = chatLayoutOuter.querySelector('[data-chat-sidebar]');
		if (sidebarResizeHandle instanceof HTMLElement && sidebarEl instanceof HTMLElement) {
			let dragPointerId = null;
			let dragStartX = 0;
			let dragStartW = 0;
			const onMove = (ev) => {
				if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
				const next = dragStartW + (ev.clientX - dragStartX);
				applyChatSidebarWidthPx(next);
				const canvasPanel = chatLayoutRoot?.querySelector?.('[data-chat-canvas-panel]');
				if (canvasPanel instanceof HTMLElement && !canvasPanel.hidden) {
					applyChatCanvasPanelWidthPx(canvasPanel.getBoundingClientRect().width);
				}
			};
			const onUp = (ev) => {
				if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
				document.removeEventListener('pointermove', onMove);
				document.removeEventListener('pointerup', onUp);
				document.removeEventListener('pointercancel', onUp);
				try {
					if (
						dragPointerId != null &&
						typeof sidebarResizeHandle.hasPointerCapture === 'function' &&
						sidebarResizeHandle.hasPointerCapture(dragPointerId)
					) {
						sidebarResizeHandle.releasePointerCapture(dragPointerId);
					}
				} catch {
					// ignore
				}
				dragPointerId = null;
				const w = sidebarEl.getBoundingClientRect().width;
				const clamped = clampChatSidebarWidthPx(w);
				if (clamped != null) {
					try {
						window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_LS, String(clamped));
					} catch {
						// ignore
					}
					applyChatSidebarWidthPx(clamped);
				}
			};
			sidebarResizeHandle.addEventListener('pointerdown', (ev) => {
				ev.preventDefault();
				dragPointerId = ev.pointerId;
				dragStartX = ev.clientX;
				dragStartW = sidebarEl.getBoundingClientRect().width;
				try {
					if (typeof sidebarResizeHandle.setPointerCapture === 'function') {
						sidebarResizeHandle.setPointerCapture(ev.pointerId);
					}
				} catch {
					// ignore
				}
				document.addEventListener('pointermove', onMove);
				document.addEventListener('pointerup', onUp);
				document.addEventListener('pointercancel', onUp);
			});
			sidebarResizeHandle.addEventListener('keydown', (ev) => {
				if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
				ev.preventDefault();
				const cur = clampChatSidebarWidthPx(sidebarEl.getBoundingClientRect().width) ?? CHAT_SIDEBAR_WIDTH_MIN;
				const step = ev.shiftKey ? 24 : 8;
				const next = ev.key === 'ArrowLeft' ? cur - step : cur + step;
				applyChatSidebarWidthPx(next);
				const clamped = clampChatSidebarWidthPx(sidebarEl.getBoundingClientRect().width);
				if (clamped != null) {
					try {
						window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_LS, String(clamped));
					} catch {
						// ignore
					}
				}
			});
		}
	}

	if (chatLayoutRoot instanceof HTMLElement) {
		const stored = readStoredChatCanvasWidthPx();
		if (stored != null) applyChatCanvasPanelWidthPx(stored);
		const resizeHandle = chatLayoutRoot.querySelector('[data-chat-canvas-resize-handle]');
		if (resizeHandle instanceof HTMLElement) {
			let dragPointerId = null;
			let dragStartX = 0;
			let dragStartW = 0;
			const onMove = (ev) => {
				if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
				const next = dragStartW - (ev.clientX - dragStartX);
				applyChatCanvasPanelWidthPx(next);
			};
			const onUp = (ev) => {
				if (dragPointerId != null && ev.pointerId !== dragPointerId) return;
				document.removeEventListener('pointermove', onMove);
				document.removeEventListener('pointerup', onUp);
				document.removeEventListener('pointercancel', onUp);
				try {
					if (
						dragPointerId != null &&
						typeof resizeHandle.hasPointerCapture === 'function' &&
						resizeHandle.hasPointerCapture(dragPointerId)
					) {
						resizeHandle.releaseCapture(dragPointerId);
					}
				} catch {
					// ignore
				}
				dragPointerId = null;
				const panel = chatLayoutRoot.querySelector('[data-chat-canvas-panel]');
				if (panel instanceof HTMLElement && !panel.hidden) {
					const w = panel.getBoundingClientRect().width;
					const clamped = clampChatCanvasWidthPx(w);
					if (clamped != null) {
						try {
							window.localStorage.setItem(CHAT_CANVAS_WIDTH_LS, String(clamped));
						} catch {
							// ignore
						}
						applyChatCanvasPanelWidthPx(clamped);
					}
				}
			};
			resizeHandle.addEventListener('pointerdown', (ev) => {
				const panel = chatLayoutRoot.querySelector('[data-chat-canvas-panel]');
				if (!(panel instanceof HTMLElement) || panel.hidden) return;
				ev.preventDefault();
				dragPointerId = ev.pointerId;
				dragStartX = ev.clientX;
				dragStartW = panel.getBoundingClientRect().width;
				try {
					if (typeof resizeHandle.setPointerCapture === 'function') {
						resizeHandle.setPointerCapture(ev.pointerId);
					}
				} catch {
					// ignore
				}
				document.addEventListener('pointermove', onMove);
				document.addEventListener('pointerup', onUp);
				document.addEventListener('pointercancel', onUp);
			});
			resizeHandle.addEventListener('keydown', (ev) => {
				const panel = chatLayoutRoot.querySelector('[data-chat-canvas-panel]');
				if (!(panel instanceof HTMLElement) || panel.hidden) return;
				if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
				ev.preventDefault();
				const w0 = panel.getBoundingClientRect().width;
				const cur = clampChatCanvasWidthPx(w0) ?? CHAT_CANVAS_WIDTH_MIN;
				const step = ev.shiftKey ? 24 : 8;
				const next = ev.key === 'ArrowLeft' ? cur + step : cur - step;
				applyChatCanvasPanelWidthPx(next);
				const w1 = panel.getBoundingClientRect().width;
				const clamped = clampChatCanvasWidthPx(w1);
				if (clamped != null) {
					try {
						window.localStorage.setItem(CHAT_CANVAS_WIDTH_LS, String(clamped));
					} catch {
						// ignore
					}
				}
			});
		}
	}

	window.addEventListener('resize', () => {
		setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
		if (chatLayoutOuter instanceof HTMLElement) {
			const sidebar = chatLayoutOuter.querySelector('[data-chat-sidebar]');
			if (sidebar instanceof HTMLElement) {
				applyChatSidebarWidthPx(sidebar.getBoundingClientRect().width);
			}
		}
		if (chatLayoutRoot instanceof HTMLElement) {
			const panel = chatLayoutRoot.querySelector('[data-chat-canvas-panel]');
			if (panel instanceof HTMLElement && !panel.hidden) {
				applyChatCanvasPanelWidthPx(panel.getBoundingClientRect().width);
			}
		}
	});

	document.addEventListener('chat-unread-refresh', onChatGlobalUnreadRefreshDoc);
	window.addEventListener('hashchange', () => {
		setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
	});
	window.addEventListener('popstate', () => {
		setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
	});
	chatGlobalUnreadPoll = setInterval(() => void loadChatGlobalUnreadSummary(), 45000);
	void loadChatGlobalUnreadSummary();
	void hydrateAudibleNotificationsFromProfileOnce();
	enableLikeButtons(root);
	await openThreadForCurrentPath();
	setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
	dispatchChatUnreadRefresh();
	/** Presence/UI poll: keep roster status fresh without force-refetching all thread metadata. */
	chatSidebarPollTimer = setInterval(() => void refreshChatSidebar({ skipThreadsFetch: true }), 15000);
	chatSidebarServersHandler = () => void refreshChatSidebar();
	document.addEventListener('servers-updated', chatSidebarServersHandler);
	chatSidebarVisibilityHandler = () => {
		if (document.visibilityState !== 'visible') return;
		void refreshChatSidebar({ skipThreadsFetch: true });
	};
	document.addEventListener('visibilitychange', chatSidebarVisibilityHandler);
	document.addEventListener('creations-pending-updated', () => {
		if (activePseudoChannelSlug === 'creations') maybeStartChatCreationsPseudoChannelPoll();
	});
	setupChatSidebarClientNav();
	await setupChatSidebarSectionAdds();
}
