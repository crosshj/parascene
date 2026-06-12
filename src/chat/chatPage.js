/**
 * Standalone /chat/* thread UI (plain JS; not a custom element).
 * Source of truth for `initChatPage`: bundled via `src/rollup.config.mjs` (not served as `/pages/*.js`).
 */

import * as _cdDatetime from '../shared/datetime.js';
import * as _cdApi from '../shared/api.js';
import * as _cdChatThreadsCache from '../shared/chatThreadsCache.js';
import * as _cdChatSidebarSessionCache from '../shared/chatSidebarSessionCache.js';
import * as _cdAvatar from '../shared/avatar.js';
import * as _cdProfileLinks from '../shared/profileLinks.js';
import * as _cdCommentItem from '../shared/commentItem.js';
import * as _cdUserText from '../shared/userText.js';
import {
	bindChatInlineImageLightboxClickDelegation,
	chatAttachmentPreviewKindFromHref,
	closeChatInlineImageLightbox,
	closeChatInlineImageLightboxFromPopstateIfOpen,
	openChatAttachmentPreviewLightbox as openChatAttachmentPreviewLightboxShared,
	openChatInlineImageLightbox as openChatInlineImageLightboxShared,
} from '../shared/chatInlineImageLightbox.js';
import * as _cdEmptyState from '../shared/emptyState.js';
import * as _cdAutogrow from '../shared/autogrow.js';
import * as _cdTriggeredSuggest from '../shared/triggeredSuggest.js';
import * as _cdLikes from '../shared/likes.js';
import * as _cdComments from '../shared/comments.js';
import * as _cdReactionTooltipTap from '../shared/reactionTooltipTap.js';
import * as _cdConnectCommentCard from '../shared/connectCommentCard.js';
import * as _cdPseudoChannelColumnPager from '../shared/pseudoChannelColumnPager.js';
import * as _cdSkeleton from '../shared/skeleton.js';
import { createReplyIndicatorElement } from '../shared/replyIndicatorUi.js';
import { plainTextReplyPreview } from '../shared/plainTextReplyPreview.js';
import { CHAT_UPLOAD_MAX_BYTES, chatUploadMaxSizeLabel } from '../shared/chatUploadMaxBytes.js';
import { safeMediaPlay } from '../shared/safeMediaPlay.js';
import { bindMobileCreationsBulkLongPress } from '../shared/creationsBulkLongPress.js';
import {
	notificationChatHref,
	notificationCreationHref,
	notificationPrimaryClickable,
	notificationPrimaryHref
} from '../shared/notificationNav.js';
import { dismissChallengeVoteModalFromBrowserHistoryIfOpen as dismissChallengeVoteModalImpl } from './challenges/challengeVoteModal.js';
import {
	sendIcon,
	notifyIcon,
	creditIcon,
	REACTION_ORDER,
	REACTION_ICONS,
	smileIcon,
	gearIcon,
	statsBarsIcon,
	plusIcon,
	copyIcon,
	replyTurnIcon,
	pencilIcon,
	trashIcon,
	helpIcon,
	linkIcon2
} from '/icons/svg-strings.js';
import * as rosterMod from '../shared/chatSidebarRoster.js';
import { openDmSidebarGearMenu } from '/shared/chatDmSidebarGearMenu.js';
import { serverChannelTagFromServerName } from '../shared/serverChatTag.js';
import * as creationsPollMod from '/shared/creationsInFlightPoller.js';
import {
	applyChatGlobalUnreadChrome,
	restoreChatGlobalUnreadFavicon,
	CHAT_UNREAD_TITLE_PREFIX_RE
} from '/shared/chatGlobalUnreadChrome.js';
import { playChatUnreadPing } from '/shared/chatUnreadAudio.js';
import { hydrateChatAudibleNotificationsFromServer } from '/shared/chatAudibleNotificationsPref.js';
import { formatMentionsFailureForDialog, uploadChatFile } from '/shared/createSubmit.js';
import { subscribeUserBroadcast, subscribeRoomBroadcast } from '../shared/realtimeBroadcast.js';
import { initChatSidebarModals } from '../shared/components/modals/chatSidebarModals.js';
import {
	createFeedItemCard,
	feedItemToUser,
	getFeedGroupVideoPlayer,
	getHiddenFeedItems,
	isFeedRowVideoCreation,
	isChatFeedChallengePlaceholder,
	partitionChatFeedMobileAlternating
} from '../shared/feedCardBuild.js';
import {
	FEED_CHANNEL_PAGE_SIZE,
	getChatFeedItemKey,
	createChatFeedFetchPage
} from './feed/feedChannelData.js';
import {
	createChatFeedChannelElementsFromSegments,
	getChatFeedMobileSpotlightHtml,
	mountChatFeedLoadMoreSkeleton,
	removeChatFeedLoadMoreSkeleton,
} from './feed/feedChannelView.js';
import {
	createChatFeedChallengePlaceholderElement,
	loadDeferredChatFeedChallenge
} from './feed/feedChannelChallenge.js';
import { mountChatDoomScroll, teardownChatDoomScroll } from './feed/doomScrollMount.js';
import { openDoomCommentsPopover, tryConsumeDoomCommentsHistoryForCapture } from './doom/doomCommentsPopover.js';
import { addToMutateQueue } from '/shared/mutateQueue.js';
import { captureChallengeSubmitThread } from '/shared/challengeSubmitContext.js';
import * as challengesChannelModule from './challengesChannel.js';

(function installDoomCommentsSheetCapture() {
	function onHistoryCapture(ev) {
		if (tryConsumeDoomCommentsHistoryForCapture()) {
			ev.stopImmediatePropagation();
		}
	}
	window.addEventListener('popstate', onHistoryCapture, true);
	window.addEventListener('hashchange', onHistoryCapture, true);

	function onDoomCommentsRailClickCapture(ev) {
		if (!document.body?.classList?.contains('chat-page--doom-scroll')) return;
		const a = ev.target?.closest?.('[data-chat-doom-comments]');
		if (!(a instanceof HTMLAnchorElement)) return;
		ev.preventDefault();
		ev.stopImmediatePropagation();
		const countEl = a.querySelector('.chat-doom-rail-count');
		const commentCountLabel =
			countEl && typeof countEl.textContent === 'string' ? countEl.textContent.trim() : '';
		const detailHref = (a.getAttribute('href') || '').trim();
		openDoomCommentsPopover({ commentCountLabel, detailHref });
	}
	document.addEventListener('click', onDoomCommentsRailClickCapture, true);

	/**
	 * Doom slide bottom bar (`.chat-doom-bottom`: avatar + @handle + follow + caption) is a click
	 * surface for the creation detail. Inner anchors/buttons (username link, follow) still own
	 * their own clicks; everything else navigates to `/creations/:id`.
	 */
	function onDoomDetailBarClickCapture(ev) {
		if (!document.body?.classList?.contains('chat-page--doom-scroll')) return;
		const bar = ev.target?.closest?.('[data-chat-doom-detail]');
		if (!(bar instanceof HTMLElement)) return;
		const interactive = ev.target?.closest?.('a, button, input, textarea, select, [role="button"]');
		if (interactive && interactive !== bar && bar.contains(interactive)) return;
		const href = (bar.getAttribute('data-chat-doom-detail-href') || '').trim();
		if (!href) return;
		ev.preventDefault();
		ev.stopImmediatePropagation();
		window.location.href = href;
	}
	document.addEventListener('click', onDoomDetailBarClickCapture, true);
})();

/**
 * Set when `initChatPage` runs (binds the vote-modal dismiss impl from the static graph).
 * @type {null | (() => boolean)}
 */
let dismissChallengeVoteModalFromBrowserHistoryIfOpenRef = null;

function dismissChallengeVoteModalFromBrowserHistoryIfOpen() {
	const fn = dismissChallengeVoteModalFromBrowserHistoryIfOpenRef;
	return typeof fn === 'function' ? fn() : false;
}

const ENTER_SENDS = (() => {
	try {
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	} catch {
		return typeof window.innerWidth === 'number' && window.innerWidth >= 768;
	}
})();

/** Align with `public/pages/chat.css` mobile chrome / canvas rules (`max-width: 768px`). */
function isChatPageMobileLayout() {
	const isLikelyMobileUa = (() => {
		try {
			const ua = String(window.navigator?.userAgent || '').toLowerCase();
			return /android|iphone|ipod|ipad|mobile/.test(ua);
		} catch {
			return false;
		}
	})();
	const coarsePointer = (() => {
		try {
			return window.matchMedia('(pointer: coarse)').matches;
		} catch {
			return false;
		}
	})();
	try {
		if (window.matchMedia('(max-width: 768px)').matches) return true;
		// Real devices can report wider CSS widths than desktop emulation suggests.
		const vv = window.visualViewport;
		const vvWidth =
			vv && typeof vv.width === 'number' && Number.isFinite(vv.width) ? vv.width : NaN;
		const iw =
			typeof window.innerWidth === 'number' && Number.isFinite(window.innerWidth)
				? window.innerWidth
				: NaN;
		const width = Number.isFinite(vvWidth) ? vvWidth : iw;
		if (isLikelyMobileUa && coarsePointer && Number.isFinite(width) && width <= 900) return true;
		return false;
	} catch {
		const iw = typeof window.innerWidth === 'number' ? window.innerWidth : NaN;
		return Boolean(isLikelyMobileUa && coarsePointer && Number.isFinite(iw) && iw <= 900);
	}
}

/**
 * @param {object} item — feed creation row
 * @returns {boolean}
 */
function isDoomEligibleFeedVideoItem(item) {
	if (!item || typeof item !== 'object') return false;
	const t = item.type;
	if (t === 'tip' || t === 'blog_post' || t === 'engagement') return false;
	const videoUrl = typeof item.video_url === 'string' ? item.video_url.trim() : '';
	if (!videoUrl) return false;
	if (isFeedRowVideoCreation(item)) return true;
	const mt = typeof item.media_type === 'string' ? item.media_type.trim().toLowerCase() : '';
	return mt !== 'image';
}

function shouldUseAppMobileHeaderForChatPath(pathname) {
	const p = String(pathname || '').replace(/\/+$/, '') || '/';
	if (p === '/' || p === '/index.html' || p === '/feed' || p === '/explore' || p === '/creations') return true;
	if (!p.startsWith('/chat/c/')) return false;
	const segments = p.slice('/chat/c/'.length).split('/').filter(Boolean);
	const seg0 = segments[0] ? String(segments[0]).trim().toLowerCase() : '';
	const seg1 = segments[1] ? String(segments[1]).trim().toLowerCase() : '';
	if (seg0 === 'feed' && seg1 === 'doom') return false;
	const slug = seg0;
	if (!slug || slug === 'feedback') return false;
	return slug === 'feed' || slug === 'explore' || slug === 'creations';
}

function shouldShowMobileSidebarFromLocation() {
	const path = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
	return isChatPageMobileLayout() && path === '/chat' && window.location.hash === '#channels';
}

function shouldShowAppMobileChromeForCurrentChatView(activePseudoSlug) {
	if (!isChatPageMobileLayout()) return false;
	if (shouldShowMobileSidebarFromLocation()) return true;
	const slug = String(activePseudoSlug || '').trim().toLowerCase();
	if (slug) return slug === 'feed' || slug === 'explore' || slug === 'creations';
	return shouldUseAppMobileHeaderForChatPath(window.location.pathname);
}

/** `?chatSimulateSendFail=1` — next POST /messages returns failure so you can preview resend UI. */
function chatSimulateSendFail() {
	try {
		return new URLSearchParams(window.location.search).get('chatSimulateSendFail') === '1';
	} catch {
		return false;
	}
}

/** `?chatSimulateConversationLoadFail=1` — force thread message load failure for error-state UI testing. */
function chatSimulateConversationLoadFail() {
	try {
		return new URLSearchParams(window.location.search).get('chatSimulateConversationLoadFail') === '1';
	} catch {
		return false;
	}
}

function clearChatSimulateConversationLoadFailParam() {
	try {
		const url = new URL(window.location.href);
		if (!url.searchParams.has('chatSimulateConversationLoadFail')) return;
		url.searchParams.delete('chatSimulateConversationLoadFail');
		window.history.replaceState({}, '', url.toString());
	} catch {
		// ignore
	}
}

/** Hide repeated sender meta when the next message is same author within this window (ms). */
const CHAT_MESSAGE_GROUP_GAP_MS = 7 * 60 * 1000;

function parseChatMessageCreatedMs(m) {
	if (!m || m.created_at == null) return NaN;
	const t = Date.parse(String(m.created_at));
	return Number.isFinite(t) ? t : NaN;
}

function isChannelInviteSystemBoundaryMessage(m) {
	const meta = m?.meta;
	const systemEventRaw =
		meta && typeof meta === 'object' && !Array.isArray(meta) ? meta.system_event : null;
	const systemEvent =
		systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
			? systemEventRaw
			: null;
	if (String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent') return true;
	const bodyTextRaw = String(m?.body ?? '').trim();
	return (
		Boolean(bodyTextRaw) &&
		/^\s*@?[a-z0-9_]+\s+invited\s+@?[a-z0-9_]+(?:\s*,\s*@?[a-z0-9_]+)*\s+to the channel\s*$/i.test(
			bodyTextRaw
		)
	);
}

/**
 * Same sender as the row above and within the time window — one visual group (single meta row).
 */
function isChatMessageGroupContinue(prev, current) {
	if (prev == null || current == null) return false;
	if (isChannelInviteSystemBoundaryMessage(prev) || isChannelInviteSystemBoundaryMessage(current)) {
		return false;
	}
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
	if (isChannelInviteSystemBoundaryMessage(lastMessage)) return false;
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
let readSidebarRosterSessionCache;
let writeSidebarRosterSessionCache;
let clearSidebarRosterSessionCache;
let getAvatarColor;
let buildProfilePath;
let renderCommentAvatarHtml;
let processUserText;
let hydrateUserTextLinks;
let hydrateChatCreationEmbeds;
let hydrateYoutubeEmbeds;
let bindInlineVideoClickControls;
let hydrateRichUserTextEmbeds;
let renderEmptyState;
let renderPaneLoadError;
let attachAutoGrowTextarea;
let attachMentionSuggest;
let attachChatMentionSuggest;
let attachChatComposerSuggest;
let isTriggeredSuggestPopupOpen;
let addPageUsers;
let clearPageUsers;
let addPageHashtagTargets;
let clearPageHashtagTargets;
let enableLikeButtons;
let createPseudoColumnPager;
/** @type {((count?: number) => string) | undefined} */
let renderFeedCardsSkeleton;
/** @type {((count?: number) => string) | undefined} */
let renderGridSkeleton;
/** @type {((count?: number) => string) | undefined} */
let renderCommentRowsSkeleton;
/** @type {(() => string) | undefined} */
let renderChallengePaneSkeleton;
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

let _chatDepsLoaded = false;
/**
 * Binds `let` references to the static `import * as _cd…` graph at the top of this file.
 * Avoid adding more absolute `/shared/…` loads here via async loader patterns — Rollup can emit a late `var` and break init order.
 */
async function loadDeps() {
	if (_chatDepsLoaded) return;
	_chatDepsLoaded = true;
	formatRelativeTime = _cdDatetime.formatRelativeTime;
	fetchJsonWithStatusDeduped = _cdApi.fetchJsonWithStatusDeduped;
	readCachedChatThreads = _cdChatThreadsCache.readCachedChatThreads;
	writeCachedChatThreads = _cdChatThreadsCache.writeCachedChatThreads;
	clearCachedChatThreads = _cdChatThreadsCache.clearCachedChatThreads;
	isChatThreadsCacheStale = _cdChatThreadsCache.isChatThreadsCacheStale;
	readSidebarRosterSessionCache = _cdChatSidebarSessionCache.readSidebarRosterSessionCache;
	writeSidebarRosterSessionCache = _cdChatSidebarSessionCache.writeSidebarRosterSessionCache;
	clearSidebarRosterSessionCache = _cdChatSidebarSessionCache.clearSidebarRosterSessionCache;
	getAvatarColor = _cdAvatar.getAvatarColor;
	buildProfilePath = _cdProfileLinks.buildProfilePath;
	renderCommentAvatarHtml = _cdCommentItem.renderCommentAvatarHtml;
	processUserText = _cdUserText.processUserText;
	hydrateUserTextLinks = _cdUserText.hydrateUserTextLinks;
	hydrateChatCreationEmbeds = _cdUserText.hydrateChatCreationEmbeds;
	hydrateYoutubeEmbeds = _cdUserText.hydrateYoutubeEmbeds;
	bindInlineVideoClickControls = _cdUserText.bindInlineVideoClickControls;
	hydrateRichUserTextEmbeds = _cdUserText.hydrateRichUserTextEmbeds;
	renderEmptyState = _cdEmptyState.renderEmptyState;
	renderPaneLoadError = _cdEmptyState.renderPaneLoadError;
	attachAutoGrowTextarea = _cdAutogrow.attachAutoGrowTextarea;
	attachMentionSuggest = _cdTriggeredSuggest.attachMentionSuggest;
	attachChatMentionSuggest = _cdTriggeredSuggest.attachChatMentionSuggest;
	attachChatComposerSuggest = _cdTriggeredSuggest.attachChatComposerSuggest;
	isTriggeredSuggestPopupOpen = _cdTriggeredSuggest.isTriggeredSuggestPopupOpen;
	addPageUsers = _cdTriggeredSuggest.addPageUsers;
	clearPageUsers = _cdTriggeredSuggest.clearPageUsers;
	addPageHashtagTargets = _cdTriggeredSuggest.addPageHashtagTargets;
	clearPageHashtagTargets = _cdTriggeredSuggest.clearPageHashtagTargets;
	enableLikeButtons = _cdLikes.enableLikeButtons;
	toggleChatMessageReaction = _cdComments.toggleChatMessageReaction;
	setupReactionTooltipTap = _cdReactionTooltipTap.setupReactionTooltipTap;
	createConnectCommentRowElement = _cdConnectCommentCard.createConnectCommentRowElement;
	createPseudoColumnPager = _cdPseudoChannelColumnPager.createPseudoColumnPager;
	renderFeedCardsSkeleton = _cdSkeleton.renderFeedCardsSkeleton;
	renderGridSkeleton = _cdSkeleton.renderGridSkeleton;
	renderCommentRowsSkeleton = _cdSkeleton.renderCommentRowsSkeleton;
	renderChallengePaneSkeleton = _cdSkeleton.renderChallengePaneSkeleton;
}

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function renderChatSidebarListSkeleton(count = 5) {
	const n = Math.max(1, Math.min(10, Number(count) || 5));
	const widths = ['72%', '58%', '66%', '62%', '74%'];
	return Array.from(
		{ length: n },
		(_, i) => `<div class="chat-page-sidebar-row chat-page-sidebar-row--skeleton" aria-hidden="true">
			<span class="skeleton skeleton-circle chat-page-sidebar-skeleton-avatar"></span>
			<span class="chat-page-sidebar-row-body">
				<span class="skeleton skeleton-line chat-page-sidebar-skeleton-line" style="width: ${widths[i % widths.length]};"></span>
			</span>
		</div>`
	).join('');
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

/* `bindInlineVideoClickControls` and `hydrateChatYoutubeEmbeds` now live in
 * `/shared/userText.js` (`bindInlineVideoClickControls`, `hydrateYoutubeEmbeds`) and are
 * imported via the `hydrateRichUserTextEmbeds` aggregate. */

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
 * Same channel tag rules as API `normalizeTag`.
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

/**
 * @param {string} pathname
 * @returns {{ kind: 'empty' } | { kind: 'invalid' } | { kind: 'thread', threadId: number } | { kind: 'channel', slug: string } | { kind: 'doom_scroll', startCreationId: number } | { kind: 'dm', userId: number } | { kind: 'dm', userName: string } | { kind: 'dm', self: true }}
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
	if (p === '/challenges') {
		return { kind: 'channel', slug: 'challenges' };
	}
	const parts = p.split('/').filter(Boolean);
	if (parts[0] !== 'chat') return { kind: 'invalid' };
	if (parts.length === 1) return { kind: 'empty' };
	const seg = parts[1].toLowerCase();
	if (seg === 'notes' && parts.length === 2) {
		return { kind: 'dm', self: true };
	}
	if (seg === 'c' && parts.length >= 5) {
		const ch = String(parts[2]).toLowerCase();
		const sub = String(parts[3]).toLowerCase();
		if (ch === 'feed' && sub === 'doom') {
			const cid = Number.parseInt(String(parts[4]), 10);
			if (Number.isFinite(cid) && cid > 0) {
				return { kind: 'doom_scroll', startCreationId: cid };
			}
			return { kind: 'invalid' };
		}
	}
	if (seg === 'c' && parts[2]) {
		let slug = parts[2];
		try {
			slug = decodeURIComponent(slug);
		} catch {
			// keep raw
		}
		const channelSlug = String(slug).trim().toLowerCase();
		if (channelSlug === 'feed-beta') {
			return { kind: 'channel', slug: 'feed' };
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
 * Build a stable URL-safe display segment for optional chat thread name paths.
 * @param {string} raw
 * @returns {string}
 */
function toChatThreadNamePathSegment(raw) {
	const s = String(raw || '')
		.trim()
		.replace(/^#+/, '')
		.toLowerCase();
	if (!s) return '';
	return s
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

/**
 * Canonical thread URL: `/chat/t/:threadId` with optional display segment.
 * @param {number} threadId
 * @param {{ title?: unknown, channel_slug?: unknown } | null | undefined} meta
 * @returns {string}
 */
function buildCanonicalChatThreadPath(threadId, meta) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return '/chat';
	let label = '';
	if (meta && typeof meta === 'object') {
		if (typeof meta.title === 'string' && meta.title.trim()) {
			label = meta.title.trim();
		} else if (typeof meta.channel_slug === 'string' && meta.channel_slug.trim()) {
			label = meta.channel_slug.trim();
		}
	}
	const seg = toChatThreadNamePathSegment(label);
	const base = `/chat/t/${encodeURIComponent(String(tid))}`;
	return seg ? `${base}/${encodeURIComponent(seg)}` : base;
}

/**
 * Whether this thread meta describes a private channel.
 * @param {{ type?: unknown, visibility?: unknown } | null | undefined} meta
 * @returns {boolean}
 */
function isPrivateChannelMeta(meta) {
	return (
		meta &&
		typeof meta === 'object' &&
		meta.type === 'channel' &&
		String(meta.visibility || '').trim().toLowerCase() === 'private'
	);
}

/**
 * Route model:
 * - private channels: `/chat/t/:id/:name`
 * - public channels: `/chat/c/:slug`
 * - everything else: `/chat/t/:id`
 * @param {number} threadId
 * @param {{ type?: unknown, visibility?: unknown, channel_slug?: unknown, title?: unknown } | null | undefined} meta
 * @returns {string}
 */
function buildPreferredChatThreadPath(threadId, meta) {
	if (isPrivateChannelMeta(meta)) {
		return buildCanonicalChatThreadPath(threadId, meta);
	}
	if (meta && typeof meta === 'object' && meta.type === 'channel') {
		const slug = typeof meta.channel_slug === 'string' ? meta.channel_slug.trim() : '';
		if (slug) return `/chat/c/${encodeURIComponent(slug)}`;
	}
	const tid = Number(threadId);
	if (Number.isFinite(tid) && tid > 0) {
		return `/chat/t/${encodeURIComponent(String(tid))}`;
	}
	return '/chat';
}

/** Slugs where canvases are disabled in the client (pseudo-column channels). `#feedback` is allowed; keep aligned with `CANVAS_DISALLOWED_CHANNEL_SLUGS` in api_routes/chat.js */
const CHAT_CANVAS_DISALLOWED_SLUGS = new Set(['comments', 'feed', 'explore', 'creations', 'challenges']);

/** Bottom spacing for canvas read view; must match `CANVAS_BODY_HTML_SUFFIX` in `api_routes/utils/canvasBodyHtml.js` when `body_html` is omitted. */
const CANVAS_BODY_HTML_SUFFIX = '<br><br><br>';

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

	dismissChallengeVoteModalFromBrowserHistoryIfOpenRef = dismissChallengeVoteModalImpl;

	const v = getAssetVersionParam();
	const qs = getImportQuery(v);
	const chatSidebarServerGearSvg = gearIcon('chat-page-sidebar-server-settings-icon');

	async function hydrateAudibleNotificationsFromProfileOnce() {
		try {
			const profileR = await fetchJsonWithStatusDeduped(
				'/api/profile',
				{ credentials: 'include' },
				{ windowMs: 2000 }
			);
			if (profileR.ok && profileR.data) {
				hydrateChatAudibleNotificationsFromServer(profileR.data.audibleNotifications);
			}
		} catch {
			// ignore
		}
	}

	document.addEventListener('user-updated', () => {
		void hydrateAudibleNotificationsFromProfileOnce();
	});

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
	const docTitleBase = typeof document !== 'undefined'
		? String(document.title || 'parascene').replace(CHAT_UNREAD_TITLE_PREFIX_RE, '').trim()
		: 'parascene';
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
	/** @type {null | (() => void)} */
	let privateChannelMembersOverlayCleanup = null;
	let tearDownChatCanvasUi = () => { };
	let chatThreads = [];
	const chatPrivateKeyByThreadId = new Map();
	const CHAT_PRIVATE_PROBE_TEXT = 'PARASCENE_CHANNEL_OK_V1';
	const CHAT_PRIVATE_MSG_PREFIX = 'enc:v1:';
	let chatJoinedServers = [];
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
	/** @type {null | (() => void)} */
	let feedChannelLoadMoreFallbackCleanup = null;
	/** Edge-trigger for feed lane preload target (card or sentinel). */
	let feedChannelSentinelWasIntersecting = false;
	/** One-shot gate per preload-band entry; re-armed when leaving the band or after append nudge. */
	let feedChannelLoadLatchArmed = true;
	let feedChannelScrollWasNearLoadEdge = false;
	/** Start loading older feed rows when this many `.feed-card` items remain below the reader. */
	const FEED_LANE_PRELOAD_CARDS_FROM_END = 5;
	const FEED_LANE_COUNTABLE_CARD_SELECTOR = '.feed-card';
	/** @type {IntersectionObserver | null} */
	let feedChannelVideoObserver = null;
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
	/** Bumped whenever a new load targets `[data-chat-messages]` so in-flight async work can bail before clobbering a newer navigation. */
	let chatMessagesPaneEpoch = 0;
	function bumpChatMessagesPaneEpoch() {
		return ++chatMessagesPaneEpoch;
	}
	function isStaleChatPane(paneEpoch) {
		return paneEpoch !== chatMessagesPaneEpoch;
	}
	/** Depth: thread DM/channel message list (not pseudo channels). */
	let threadMessagesLoadDepth = 0;
	let loadingThreadMessages = false;
	function enterThreadMessagesLoad() {
		threadMessagesLoadDepth += 1;
		loadingThreadMessages = true;
	}
	function exitThreadMessagesLoad() {
		threadMessagesLoadDepth = Math.max(0, threadMessagesLoadDepth - 1);
		loadingThreadMessages = threadMessagesLoadDepth > 0;
		syncChatMessagePlaceholder();
	}
	/** Depth: pseudo-channel panes (#comments / #feed / #explore / #creations). */
	let pseudoChannelLoadDepth = 0;
	let loadingPseudoChannelMessages = false;
	function enterPseudoChannelLoad() {
		pseudoChannelLoadDepth += 1;
		loadingPseudoChannelMessages = true;
		syncChatMessagePlaceholder();
	}
	function exitPseudoChannelLoad() {
		pseudoChannelLoadDepth = Math.max(0, pseudoChannelLoadDepth - 1);
		loadingPseudoChannelMessages = pseudoChannelLoadDepth > 0;
		syncChatMessagePlaceholder();
	}
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
	let chatMessagesSyncInFlight = false;
	let chatComposerReferencedMessageId = null;
	let activeMessageEditId = null;
	let activeMessageEditSaving = false;
	let activeMessageEditMinHeightPx = 0;
	let chatThreadLoadFailed = false;
	/** @type {null | (() => void)} */
	let roomBroadcastTeardown = null;
	/** @type {null | (() => void)} */
	let challengesPaneTeardown = null;
	/** @type {null | (() => void)} */
	let challengesOrganizerSidebarTeardown = null;
	/** Challenge channel: viewer may open organizer sidebar (see `isChallengeChannelAdmin`). */
	let chatChallengesOrganizerEligible = false;
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
	let chatSidebarLastViewerSyncAt = 0;
	let lastPresenceOnlineSnapshot = null;
	let lastPresenceOnlineSnapshotAt = 0;
	const PRESENCE_ONLINE_SNAPSHOT_TTL_MS = 15000;
	let lastPresenceLastActiveCache = null;
	let lastPresenceLastActiveCacheAt = 0;
	let lastPresenceLastActiveCacheKey = '';
	const PRESENCE_LAST_ACTIVE_SNAPSHOT_TTL_MS = 15000;
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
	/** @type {null | (() => void)} */
	let chatInlineImageLightboxClickUnbind = null;
	/** @type {null | (() => void)} */
	let chatHashtagChoiceModalCleanup = null;
	/** @type {HTMLElement | null} */
	let chatSidebarDmHoverPopoverEl = null;
	/** @type {HTMLElement | null} */
	let chatSidebarDmHoverActiveAnchor = null;
	/** @type {HTMLElement | null} */
	let chatSidebarNotificationsMenuEl = null;
	/** @type {null | ((e: MouseEvent) => void)} */
	let chatSidebarNotificationsOutsideClickHandler = null;
	/** @type {Array<object>} */
	let chatSidebarNotificationsPreviewCache = [];
	let chatSidebarNotificationsPreviewLoadedAt = 0;
	let chatSidebarNotificationsPreviewLoading = false;

	let lastMarkReadSentId = null;
	let lastReadThreadIdForMark = null;
	/** @type {IntersectionObserver | null} */
	let latestMessageReadObserver = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let bottomDwellTimer = null;
	let bottomDwellThreadId = null;

	const CHAT_BOTTOM_THRESHOLD_PX = 56;
	// Keep runtime bottom-follow enabled so late media sizing does not leave first load off-bottom.
	const CHAT_TEMP_DISABLE_AUTO_SCROLL = false;
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

	function getSidebarThreadLastMessageId(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		const row = (chatThreads || []).find((t) => Number(t.id) === tid);
		if (!row) return null;
		const fromLastMessage = Number(row?.last_message?.id);
		if (Number.isFinite(fromLastMessage) && fromLastMessage > 0) return fromLastMessage;
		return null;
	}

	async function markThreadReadByMessageId(threadId, messageId) {
		const tid = Number(threadId);
		const mid = Number(messageId);
		if (!Number.isFinite(tid) || tid <= 0) return false;
		if (!Number.isFinite(mid) || mid <= 0) return false;
		try {
			const res = await fetch(`/api/chat/threads/${tid}/read`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
				body: JSON.stringify({ last_read_message_id: mid })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) return false;
			const lr = data?.last_read_message_id != null ? Number(data.last_read_message_id) : mid;
			if (Number.isFinite(lr) && lr > 0) {
				patchChatThreadRow(tid, { last_read_message_id: lr, unread_count: 0 });
			} else {
				patchChatThreadRow(tid, { unread_count: 0 });
			}
			return true;
		} catch {
			return false;
		}
	}

	async function markSidebarThreadRead(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		let mid = getSidebarThreadLastMessageId(tid);
		if (!Number.isFinite(mid) || mid <= 0) {
			try {
				await loadChatThreads({ forceNetwork: true });
			} catch {
				// ignore
			}
			mid = getSidebarThreadLastMessageId(tid);
		}
		if (!Number.isFinite(mid) || mid <= 0) {
			patchChatThreadRow(tid, { unread_count: 0 });
			dispatchChatUnreadRefresh();
			void refreshChatSidebar({ skipThreadsFetch: true });
			return;
		}
		const ok = await markThreadReadByMessageId(tid, mid);
		if (!ok) return;
		if (Number(activeThreadId) === tid) {
			fadeOutUnreadHighlightsInDom();
		}
		dispatchChatUnreadRefresh();
		void refreshChatSidebar({ skipThreadsFetch: true });
	}

	async function leaveChannelFromSidebar(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		const ok = window.confirm('Leave this channel?');
		if (!ok) return;
		const wasActive = Number(activeThreadId) === tid;
		try {
			const res = await fetch(`/api/chat/threads/${tid}/leave`, {
				method: 'POST',
				credentials: 'include',
				headers: { Accept: 'application/json' }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data?.message || data?.error || `Could not leave channel (${res.status})`);
			}
			await loadChatThreads({ forceNetwork: true });
			await refreshChatSidebar({ skipThreadsFetch: true });
			if (wasActive) {
				history.pushState({ prsnChat: true }, '', '/chat/c/feed');
				await openThreadForCurrentPath();
			}
		} catch (err) {
			const errEl = root.querySelector('[data-chat-error]');
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = err?.message || 'Could not leave channel.';
			}
		}
	}

	function openServerDetailsFromSidebarButton(settingsBtn) {
		if (!(settingsBtn instanceof HTMLButtonElement)) return;
		const sid = Number(settingsBtn.getAttribute('data-chat-server-settings'));
		if (!Number.isFinite(sid) || sid <= 0) return;
		const canManage = settingsBtn.getAttribute('data-chat-server-can-manage') === '1';
		const modal = document.querySelector('app-modal-server');
		if (modal && typeof modal.open === 'function') {
			modal.open({ mode: canManage ? 'edit' : 'view', serverId: sid });
		}
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
		if (!threadId) return;
		const messages = lastChatMessagesPayload;
		if (!Array.isArray(messages) || messages.length === 0) return;
		const last = messages[messages.length - 1];
		const mid = Number(last?.id);
		if (!Number.isFinite(mid) || mid <= 0) return;
		if (lastMarkReadSentId === mid) return;
		lastMarkReadSentId = mid;
		const ok = await markThreadReadByMessageId(threadId, mid);
		if (!ok) {
			lastMarkReadSentId = null;
			return;
		}
		try {
			fadeOutUnreadHighlightsInDom();
			dispatchChatUnreadRefresh();
			void refreshChatSidebar({ skipThreadsFetch: true });
		} catch {
			// ignore
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
			if (shouldUseViewportScrollForChatMessages()) {
				window.scrollTo(0, 0);
			}
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
	}

	function shouldUseViewportScrollForChatMessages() {
		if (!isChatPageMobileLayout()) return false;
		if (!document.body.classList.contains('chat-page--viewport-scroll')) return false;
		/* Must match `chat.css` `@media (max-width: 768px)` viewport-scroll rules. */
		try {
			return window.matchMedia('(max-width: 768px)').matches;
		} catch {
			return true;
		}
	}

	/**
	 * Pseudo channels are rendered as top-anchored browse lanes.
	 * Keep this true for feed/explore/creations/comments/challenges so first paint is always at top.
	 * @param {'feed' | 'explore' | 'creations' | 'comments' | 'challenges'} laneSlug
	 */
	function isNewestFirstBrowseLane(laneSlug) {
		if (
			laneSlug === 'feed' ||
			laneSlug === 'explore' ||
			laneSlug === 'creations' ||
			laneSlug === 'comments' ||
			laneSlug === 'challenges'
		) {
			return true;
		}
		return chatFeedLaneScrollMode === 'newest_first';
	}

	/** After painting a skeleton into `[data-chat-messages]`, snap scroll and prevent scroll until content loads. */
	function resetAndLockChatMessagesScrollForSkeleton(messagesEl, channelSlug) {
		if (!(messagesEl instanceof HTMLElement)) return;
		const slug = String(channelSlug || '').trim().toLowerCase();
		const pseudoLane =
			slug === 'feed' ||
			slug === 'explore' ||
			slug === 'creations' ||
			slug === 'comments' ||
			slug === 'challenges';
		const toEnd = pseudoLane ? false : chatFeedLaneScrollMode === 'oldest_first';
		// Keep early viewport/resize nudges from forcing browse-lane skeletons to bottom.
		chatStickToBottom = toEnd;
		if (!toEnd) {
			teardownBottomDwellTimer();
		}
		const apply = () => {
			messagesEl.scrollTop = toEnd ? messagesEl.scrollHeight : 0;
			if (shouldUseViewportScrollForChatMessages() && pseudoLane) {
				window.scrollTo(0, toEnd ? document.documentElement.scrollHeight : 0);
			}
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
		messagesEl.dataset.chatMessagesScrollLock = '1';
		if (shouldUseViewportScrollForChatMessages() && pseudoLane) {
			document.documentElement.dataset.chatViewportScrollLock = '1';
			document.body.dataset.chatViewportScrollLock = '1';
		}
	}

	function unlockChatMessagesPaneScroll(messagesEl) {
		if (!(messagesEl instanceof HTMLElement)) return;
		if (messagesEl.dataset.chatMessagesScrollLock === '1') {
			delete messagesEl.dataset.chatMessagesScrollLock;
		}
		delete document.documentElement.dataset.chatViewportScrollLock;
		delete document.body.dataset.chatViewportScrollLock;
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
		if (messagesEl.dataset.chatMessagesScrollLock === '1') return;
		if (
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'feed_doom' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'comments' ||
			activePseudoChannelSlug === 'challenges'
		) {
			return;
		}
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
	const CHAT_COMPOSER_DRAFTS_KEY = 'chat-composer-drafts-v1';
	const CHAT_GEN_POLL_INTERVAL_MS = 2400;
	const CHAT_GEN_PREVIEW_PLACEHOLDER =
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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

	/** Use <video> thumbnail when we have a blob preview or uploaded URL. */
	function chatComposerUsesVideoThumbnail(item, kindFromType) {
		if (kindFromType !== 'video') return false;
		if (item.status === 'ready' && item.urlPath) return true;
		return Boolean(item.previewUrl);
	}

	function chatAttachmentVideoPreviewSrc(item) {
		if (item?.status === 'ready' && item?.urlPath) {
			return buildAttachmentMessageUrl(item) || String(item.urlPath || '').trim();
		}
		return String(item?.previewUrl || '').trim();
	}

	function chatAttachmentPreviewSrc(item) {
		const thumb = String(item?.thumbnailUrl || '').trim();
		if (thumb) return thumb;
		const preview = String(item?.previewUrl || '').trim();
		if (preview) return preview;
		if (item?.status === 'ready' && item?.urlPath) {
			const path = String(item.urlPath || '').trim();
			if (/^\/creations\/\d+\/?$/i.test(path)) return '';
			return path;
		}
		return '';
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

	function buildChatGenCreationToken() {
		const ts = Date.now().toString(36);
		const rand = Math.random().toString(36).slice(2, 10);
		return `crt_${ts}_${rand}`;
	}

	function readChatComposerDrafts() {
		try {
			const raw = sessionStorage.getItem(CHAT_COMPOSER_DRAFTS_KEY);
			const list = JSON.parse(raw || '[]');
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	}

	function writeChatComposerDrafts() {
		try {
			const list = chatPendingImages
				.filter((item) => {
					if (!item || typeof item !== 'object') return false;
					if (item.status === 'uploading' && item.source !== 'gen') return false;
					return true;
				})
				.map((item) => ({
					id: String(item.id || ''),
					status: String(item.status || ''),
					fileType: String(item.fileType || ''),
					fileName: String(item.fileName || ''),
					fileSize: Number.isFinite(Number(item.fileSize)) ? Number(item.fileSize) : 0,
					urlPath: String(item.urlPath || ''),
					thumbnailUrl: String(item.thumbnailUrl || ''),
					fullImageUrl: String(item.fullImageUrl || ''),
					errorMessage: String(item.errorMessage || ''),
					source: String(item.source || ''),
					generationId: Number.isFinite(Number(item.generationId)) ? Number(item.generationId) : null
				}))
				.filter((item) => item.id);
			sessionStorage.setItem(CHAT_COMPOSER_DRAFTS_KEY, JSON.stringify(list));
		} catch {
			// ignore
		}
	}

	function restoreChatComposerDraftsFromSession() {
		const saved = readChatComposerDrafts();
		if (!Array.isArray(saved) || saved.length === 0) return;
		chatPendingImages = saved.map((item) => ({
			id: item.id,
			status: item.status || 'error',
			fileType: item.fileType || '',
			fileName: item.fileName || '',
			fileSize: Number.isFinite(Number(item.fileSize)) ? Number(item.fileSize) : 0,
			urlPath: item.urlPath || '',
			thumbnailUrl: item.thumbnailUrl || '',
			fullImageUrl: item.fullImageUrl || '',
			errorMessage: item.errorMessage || '',
			source: item.source || '',
			generationId:
				item.generationId != null && Number.isFinite(Number(item.generationId))
					? Number(item.generationId)
					: null
		}));
	}

	const chatGenPollTimersByAttachmentId = new Map();

	function stopChatGenPoll(attachmentId) {
		const key = String(attachmentId || '');
		if (!key) return;
		const timer = chatGenPollTimersByAttachmentId.get(key);
		if (timer != null) {
			clearInterval(timer);
			chatGenPollTimersByAttachmentId.delete(key);
		}
	}

	function stopAllChatGenPolls() {
		for (const timer of chatGenPollTimersByAttachmentId.values()) {
			clearInterval(timer);
		}
		chatGenPollTimersByAttachmentId.clear();
	}

	async function pollChatGenAttachmentOnce(attachmentId) {
		const idKey = String(attachmentId || '');
		if (!idKey) return;
		const entry = chatPendingImages.find((x) => String(x.id) === idKey);
		if (!entry || !Number.isFinite(Number(entry.generationId)) || Number(entry.generationId) <= 0) {
			stopChatGenPoll(idKey);
			return;
		}
		try {
			const result = await fetchJsonWithStatusDeduped(
				`/api/create/images/${Number(entry.generationId)}`,
				{ credentials: 'include' },
				{ windowMs: 0 }
			);
			if (!result?.ok || !result.data) return;
			const data = result.data;
			const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
			if (status === 'creating' || status === 'pending' || status === 'queued' || status === 'processing') {
				return;
			}
			if (status === 'completed') {
				entry.status = 'ready';
				entry.urlPath = `/creations/${Number(entry.generationId)}`;
				entry.fileType = 'image/png';
				entry.fileName = 'creation.png';
				entry.thumbnailUrl =
					typeof data.thumbnail_url === 'string' && data.thumbnail_url.trim()
						? data.thumbnail_url.trim()
						: typeof data.url === 'string'
							? data.url.trim()
							: '';
				entry.fullImageUrl =
					typeof data.url === 'string' && data.url.trim() ? data.url.trim() : '';
				entry.errorMessage = '';
				renderChatAttachmentStrip();
				syncChatSendButton();
				writeChatComposerDrafts();
				stopChatGenPoll(idKey);
				return;
			}
			entry.status = 'error';
			entry.errorMessage = typeof data?.error === 'string' ? data.error : 'Generation failed';
			renderChatAttachmentStrip();
			syncChatSendButton();
			writeChatComposerDrafts();
			stopChatGenPoll(idKey);
		} catch {
			// keep polling on transient failure
		}
	}

	function startChatGenPoll(attachmentId) {
		const idKey = String(attachmentId || '');
		if (!idKey) return;
		if (chatGenPollTimersByAttachmentId.has(idKey)) return;
		const timer = setInterval(() => {
			void pollChatGenAttachmentOnce(idKey);
		}, CHAT_GEN_POLL_INTERVAL_MS);
		chatGenPollTimersByAttachmentId.set(idKey, timer);
		void pollChatGenAttachmentOnce(idKey);
	}

	function resumeChatGenPollsFromDrafts() {
		for (const item of chatPendingImages) {
			if (item?.source !== 'gen') continue;
			if (!Number.isFinite(Number(item.generationId)) || Number(item.generationId) <= 0) continue;
			if (item.status === 'ready' || item.status === 'error') continue;
			item.status = 'uploading';
			startChatGenPoll(item.id);
		}
	}

	function extractMentionsForGen(prompt) {
		const text = typeof prompt === 'string' ? prompt : '';
		if (!text) return [];
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text)) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	}

	function extractStyleKeyFromGenPrompt(prompt) {
		const tokens = String(prompt || '').match(/\$[a-z0-9_-]+/gi) || [];
		if (tokens.length === 0) return { styleKey: '', promptWithoutStyle: String(prompt || '').trim() };
		const last = String(tokens[tokens.length - 1] || '').replace(/^\$/, '').trim().toLowerCase();
		const promptWithoutStyle = String(prompt || '')
			.replace(/\$[a-z0-9_-]+/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return { styleKey: last === 'none' ? '' : last, promptWithoutStyle };
	}

	async function validateMentionsForGen(prompt) {
		const mentions = extractMentionsForGen(prompt);
		if (mentions.length === 0) return { ok: true, mentions, data: null };
		const res = await fetch('/api/create/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ args: { prompt } })
		});
		const data = await res.json().catch(() => ({}));
		return { ok: res.ok, mentions, data };
	}

	async function runChatGenFromPrompt(promptText) {
		const fullPrompt = String(promptText || '').trim();
		if (!fullPrompt) throw new Error('Usage: /gen <prompt>');
		const { styleKey, promptWithoutStyle } = extractStyleKeyFromGenPrompt(fullPrompt);
		if (!promptWithoutStyle) throw new Error('Usage: /gen <prompt>');
		const mentionsResult = await validateMentionsForGen(promptWithoutStyle);
		let hydrateMentions = false;
		if (!mentionsResult.ok) {
			let message = 'Mentions could not be validated. Submit anyway?';
			try {
				if (typeof formatMentionsFailureForDialog === 'function') {
					message = `${formatMentionsFailureForDialog(mentionsResult.data)}\n\nSubmit anyway?`;
				}
			} catch {
				// ignore
			}
			if (!window.confirm(message)) {
				throw new Error('Cancelled /gen.');
			}
		} else if (mentionsResult.mentions.length > 0) {
			hydrateMentions = true;
		}
		const args = {
			prompt: promptWithoutStyle,
			model: 'xai/grok-imagine-image'
		};
		const body = {
			server_id: 1,
			method: 'replicate',
			args,
			creation_token: buildChatGenCreationToken(),
			...(hydrateMentions ? { hydrate_mentions: true } : {}),
			...(styleKey ? { style_key: styleKey } : {})
		};
		const res = await fetch('/api/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data?.error || data?.message || 'Failed to start /gen.');
		}
		const creationId = Number(data?.id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			throw new Error('Generation started but no creation id returned.');
		}
		return creationId;
	}

	function addOptimisticGenAttachment() {
		const attachmentId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		chatPendingImages.push({
			id: attachmentId,
			status: 'uploading',
			fileType: 'image/png',
			fileName: 'creation.png',
			fileSize: 0,
			source: 'gen',
			generationId: null,
			urlPath: '',
			thumbnailUrl: '',
			fullImageUrl: '',
			previewUrl: CHAT_GEN_PREVIEW_PLACEHOLDER
		});
		renderChatAttachmentStrip();
		syncChatSendButton();
		writeChatComposerDrafts();
		return attachmentId;
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
		stopAllChatGenPolls();
		renderChatAttachmentStrip();
		syncChatSendButton();
		writeChatComposerDrafts();
		if (!skipServer) {
			for (const u of urlsToDelete) {
				void deleteChatMiscGenericOnServer(u);
			}
		}
	}

	function clearSentReadyChatAttachments() {
		const sentReady = chatPendingImages.filter((e) => e?.status === 'ready' && e?.urlPath);
		if (sentReady.length === 0) return;
		for (const entry of sentReady) {
			revokeChatAttachmentPreview(entry);
		}
		chatPendingImages = chatPendingImages.filter((e) => !(e?.status === 'ready' && e?.urlPath));
		renderChatAttachmentStrip();
		syncChatSendButton();
		writeChatComposerDrafts();
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
				const previewSrc = chatAttachmentPreviewSrc(item);
				if (previewSrc) {
					img.src = previewSrc;
					if (item.status !== 'uploading') {
						img.classList.add('chat-page-composer-attachment-preview--clickable');
						img.addEventListener('click', (e) => {
							e.preventDefault();
							e.stopPropagation();
							const fullSrc =
								typeof item.fullImageUrl === 'string' && item.fullImageUrl.trim()
									? item.fullImageUrl.trim()
									: previewSrc;
							openChatInlineImageLightbox(previewSrc || fullSrc, {
								sourceImg: img,
							});
						});
					}
				}
				card.appendChild(img);
			} else if (chatComposerUsesVideoThumbnail(item, kind)) {
				const panel = document.createElement('div');
				panel.className =
					'chat-page-composer-attachment-preview chat-page-composer-attachment-preview--video';
				const previewSrc = chatAttachmentVideoPreviewSrc(item);
				if (previewSrc) {
					const video = document.createElement('video');
					video.className = 'chat-page-composer-attachment-video';
					video.muted = true;
					video.playsInline = true;
					video.preload = 'metadata';
					video.setAttribute('aria-hidden', 'true');
					video.src = previewSrc;
					panel.appendChild(video);
					const play = document.createElement('span');
					play.className = 'chat-page-composer-attachment-play';
					play.setAttribute('aria-hidden', 'true');
					panel.appendChild(play);
					if (item.status !== 'uploading') {
						panel.classList.add('chat-page-composer-attachment-preview--clickable');
						panel.title = 'Play video';
						panel.addEventListener('click', (e) => {
							e.preventDefault();
							e.stopPropagation();
							openChatAttachmentPreviewLightbox(previewSrc, 'video', {
								sourceVideo: video,
							});
						});
					}
				}
				card.appendChild(panel);
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
			rm.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				void removeChatAttachment(item.id);
			});
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
		stopChatGenPoll(entry.id);
		chatPendingImages.splice(idx, 1);
		renderChatAttachmentStrip();
		syncChatSendButton();
		writeChatComposerDrafts();
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

		for (const file of arr) {
			if (file.size > CHAT_UPLOAD_MAX_BYTES) {
				if (errStrip instanceof HTMLElement) {
					errStrip.hidden = false;
					errStrip.textContent = `"${file.name || 'File'}" is too large (max ${chatUploadMaxSizeLabel()}).`;
				}
				continue;
			}
			const id =
				typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const fileKind = chatAttachmentKindFromType(file.type);
			const useBlobImgPreview =
				fileKind === 'image' && !chatImageFileSkipBlobPreview(file);
			const useBlobVideoPreview = fileKind === 'video';
			const previewUrl =
				useBlobImgPreview || useBlobVideoPreview ? URL.createObjectURL(file) : '';
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
			writeChatComposerDrafts();

			void (async () => {
				try {
					const { url: urlPath, displayAsFile } = await uploadChatFile(file);
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
					writeChatComposerDrafts();
				} catch (err) {
					console.error('[Chat page] file upload:', err);
					const ent = chatPendingImages.find((e) => e.id === id);
					if (!ent) return;
					ent.status = 'error';
					ent.errorMessage = err?.message || 'Upload failed';
					renderChatAttachmentStrip();
					syncChatSendButton();
					writeChatComposerDrafts();
				}
			})();
		}
	}

	function syncChatSendButton() {
		const sendBtn = root.querySelector('[data-chat-send]');
		const inp = root.querySelector('[data-chat-body-input]');
		if (!(sendBtn instanceof HTMLButtonElement) || !(inp instanceof HTMLTextAreaElement)) return;
		const shell = root.querySelector('[data-chat-composer] .chat-page-input-shell');
		if (shell instanceof HTMLElement) {
			const max = Number(inp.maxLength);
			const atLimit = Number.isFinite(max) && max > 0 && String(inp.value || '').length >= max;
			shell.classList.toggle('is-at-limit', atLimit);
		}
		if (activePseudoChannelSlug) {
			sendBtn.hidden = true;
			sendBtn.disabled = false;
			return;
		}
		const textLen = String(inp.value || '').trim().length;
		const readyCount = chatPendingImages.filter((x) => x.status === 'ready' && x.urlPath).length;
		const hasOutgoing = textLen > 0 || readyCount > 0;
		const uploadingNonGen = chatPendingImages.some(
			(x) => x.status === 'uploading' && x.source !== 'gen'
		);
		sendBtn.hidden = !hasOutgoing;
		sendBtn.disabled = uploadingNonGen || sendInFlight;
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
		if (!hasThread || loadingThreadMessages || loadingPseudoChannelMessages) {
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

	function getExploreChannelSearchFromUrl() {
		try {
			return String(new URLSearchParams(window.location.search).get('s') || '').trim();
		} catch {
			return '';
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

	function clearChatComposerReplyTarget() {
		chatComposerReferencedMessageId = null;
		syncChatComposerReplyStripUi();
	}

	function chatComposerReplyTargetAuthorLabel(referencedMid, srcMsg) {
		const viewerId = chatViewerId;
		const sid = srcMsg?.sender_id != null ? Number(srcMsg.sender_id) : NaN;
		const handleRaw =
			srcMsg && srcMsg.sender_user_name != null ? String(srcMsg.sender_user_name).trim() : '';
		const isSelf = Number.isFinite(viewerId) && Number.isFinite(sid) && sid === viewerId;
		if (handleRaw) return `@${handleRaw}`;
		if (isSelf) return 'You';
		const mid = Number(referencedMid);
		return Number.isFinite(sid) ? `User ${sid}` : Number.isFinite(mid) ? `Message ${mid}` : 'Message';
	}

	function syncChatComposerReplyStripUi() {
		const wrap = root.querySelector('[data-chat-composer-reply]');
		const messagesEl = root.querySelector('[data-chat-messages]');

		function clearReplyTargetHighlight() {
			if (!messagesEl) return;
			for (const el of messagesEl.querySelectorAll('.connect-chat-msg.connect-chat-msg--reply-target')) {
				el.classList.remove('connect-chat-msg--reply-target');
			}
		}

		if (!(wrap instanceof HTMLElement)) {
			clearReplyTargetHighlight();
			return;
		}

		while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
		const mid = Number(chatComposerReferencedMessageId);
		if (!Number.isFinite(mid) || mid <= 0 || activePseudoChannelSlug) {
			wrap.hidden = true;
			clearReplyTargetHighlight();
			return;
		}

		clearReplyTargetHighlight();

		const src = lastChatMessagesPayload.find((x) => Number(x.id) === mid);
		const authorLabel = src ? chatComposerReplyTargetAuthorLabel(mid, src) : 'User';

		wrap.hidden = false;
		const rowStrip = document.createElement('div');
		rowStrip.className = 'chat-page-composer-reply-strip';

		const textCol = document.createElement('span');
		textCol.className = 'chat-page-composer-reply-text';
		textCol.appendChild(document.createTextNode('Replying to '));
		const nameEl = document.createElement('strong');
		nameEl.className = 'chat-page-composer-reply-name';
		nameEl.textContent = authorLabel;
		textCol.appendChild(nameEl);

		const xBtn = document.createElement('button');
		xBtn.type = 'button';
		xBtn.className = 'chat-page-composer-reply-dismiss';
		xBtn.setAttribute('aria-label', 'Cancel reply');
		xBtn.innerHTML =
			'<svg class="chat-page-composer-reply-dismiss-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
		xBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			clearChatComposerReplyTarget();
			const inp = root.querySelector('[data-chat-body-input]');
			if (inp instanceof HTMLTextAreaElement) inp.focus({ preventScroll: true });
		});

		rowStrip.appendChild(textCol);
		rowStrip.appendChild(xBtn);
		wrap.appendChild(rowStrip);

		const target = messagesEl?.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (target) target.classList.add('connect-chat-msg--reply-target');
	}

	let chatCreateComposerApi = null;

	function isOverlayCreateComposerPseudoChannel() {
		return (
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'comments' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'challenges'
		);
	}

	/** Doom scroll lane: full-screen video — no bottom composer. */
	function isFeedDoomLaneHideBottomComposers() {
		return activePseudoChannelSlug === 'feed_doom';
	}

	/** Pseudo lanes on mobile: no overlay create composer (use /create from nav). */
	function isMobilePseudoChannelHideBottomComposers() {
		return isChatPageMobileLayout() && isOverlayCreateComposerPseudoChannel();
	}

	function shouldHideBottomComposers() {
		return isFeedDoomLaneHideBottomComposers() || isMobilePseudoChannelHideBottomComposers();
	}

	/** Full create composer overlay — desktop/tablet pseudo channels only. */
	function shouldShowChatCreateComposerOverlay() {
		if (!isOverlayCreateComposerPseudoChannel()) return false;
		if (isChatPageMobileLayout()) return false;
		return true;
	}

	function refreshChatCreateComposerModelsIfVisible() {
		if (!chatCreateComposerApi?.refreshModelOptions) return;
		const createComposerEl = root.querySelector('[data-chat-create-composer]');
		if (createComposerEl instanceof HTMLElement && !createComposerEl.hidden) {
			void chatCreateComposerApi.refreshModelOptions();
		}
	}

	async function mountChatCreateComposer() {
		if (chatCreateComposerApi) return;
		const createComposerHost = root.querySelector('[data-create-composer-host]');
		if (!(createComposerHost instanceof HTMLElement)) return;
		try {
			const v =
				document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() ||
				'';
			const qs = v ? `?v=${encodeURIComponent(v)}` : '';
			const { mountCreateComposer } = await import(`/shared/createComposer.js${qs}`);
			chatCreateComposerApi = mountCreateComposer(createComposerHost, {
				refreshAutoGrowTextareas: _cdAutogrow.refreshAutoGrowTextareas,
				navigate: 'creations',
				attachPromptSuggest: _cdTriggeredSuggest.attachCreateComposerSuggest,
			});
		} catch (err) {
			console.error('[Chat page] create composer mount failed:', err);
		}
	}

	function setFeedOverlayCreateComposerVisible(visible) {
		const createComposerEl = root.querySelector('[data-chat-create-composer]');
		if (createComposerEl instanceof HTMLElement) {
			createComposerEl.hidden = !visible;
		}
		if (visible) {
			refreshChatCreateComposerModelsIfVisible();
		}
		if (!document.body) return;
		const shouldUseOverlay = Boolean(visible) && !shouldShowMobileSidebarFromLocation();
		document.body.classList.toggle('chat-page--create-composer-overlay', shouldUseOverlay);
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
		const isMobileSidebarOpen = Boolean(document.body?.classList.contains('chat-page--mobile-sidebar-open'));
		const shouldShowAppMobileChrome =
			isMobileSidebarOpen || shouldShowAppMobileChromeForCurrentChatView(activePseudoChannelSlug);
		const shouldShowAppMobileHeader = shouldShowAppMobileChrome;
		const shouldShowAppMobileFooter = shouldShowAppMobileChrome;
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
			if (shouldShowAppMobileHeader) appHeader.removeAttribute('hidden');
		}
		if (appMobileNav instanceof HTMLElement) {
			appMobileNav.hidden = !shouldShowAppMobileFooter;
			if (shouldShowAppMobileFooter) appMobileNav.removeAttribute('hidden');
		}
		if (mobileChrome instanceof HTMLElement) {
			mobileChrome.hidden =
				shouldShowAppMobileHeader || activePseudoChannelSlug === 'feed_doom';
		}
		const isMobileCanvasOpen =
			isChatPageMobileLayout() &&
			Boolean(typeof document !== 'undefined' && document.body?.classList.contains('chat-page--canvas-open'));

		if (isMobileCanvasOpen) {
			if (composerForm instanceof HTMLElement) {
				composerForm.hidden = true;
			}
			setMobileComposerOverlayClass(false);
			setFeedOverlayCreateComposerVisible(false);
			clearChatComposerReplyTarget();
			return;
		}

		if (!chatComposerVisible) {
			if (composerForm instanceof HTMLElement) {
				composerForm.hidden = true;
			}
			setMobileComposerOverlayClass(false);
			setFeedOverlayCreateComposerVisible(false);
			clearChatComposerReplyTarget();
			return;
		}
		if (!activePseudoChannelSlug && activeThreadId && chatThreadLoadFailed) {
			if (composerForm instanceof HTMLElement) {
				composerForm.hidden = true;
			}
			setMobileComposerOverlayClass(false);
			setFeedOverlayCreateComposerVisible(false);
			clearChatComposerReplyTarget();
			return;
		}
		if (shouldShowChatCreateComposerOverlay()) {
			clearChatComposerReplyTarget();
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
			setFeedOverlayCreateComposerVisible(true);
			syncChatAttachmentsVisibility();
			syncChatSendButton();
			syncChatMessagePlaceholder();
			syncChatExploreComposerChrome();
			return;
		}
		setFeedOverlayCreateComposerVisible(false);
		if (shouldHideBottomComposers()) {
			clearChatComposerReplyTarget();
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
		syncChatComposerReplyStripUi();
	}

	chatApplyComposerStateRef = applyComposerState;

	function markThreadUiPending() {
		clearChatComposerReplyTarget();
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
		const viewportScrollMode =
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'feed_doom' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'challenges';
		document.body.classList.toggle('chat-page--viewport-scroll', viewportScrollMode);
		try {
			document.documentElement.classList.toggle('chat-page--viewport-scroll', viewportScrollMode);
		} catch {
			// ignore
		}
	}

	syncChatBrowseViewBodyClassRef = syncChatBrowseViewBodyClass;

	function setMobileSidebarMode(open) {
		if (!document.body) return;
		const on = Boolean(open);
		const shouldShowAppMobileChrome =
			on || shouldShowAppMobileChromeForCurrentChatView(activePseudoChannelSlug);
		document.body.classList.toggle('chat-page--mobile-sidebar-open', on);
		const viewportScrollMode =
			on ||
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'feed_doom' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'challenges';
		document.body.classList.toggle('chat-page--viewport-scroll', viewportScrollMode);
		try {
			document.documentElement.classList.toggle('chat-page--viewport-scroll', viewportScrollMode);
			document.documentElement.classList.toggle(
				'chat-page--use-app-mobile-header',
				shouldShowAppMobileChrome
			);
		} catch {
			// ignore
		}
		const appHeader = document.querySelector('app-navigation');
		const appMobileNav = document.querySelector('app-navigation-mobile');
		const mobileChrome = mainColumn instanceof HTMLElement
			? mainColumn.querySelector('[data-chat-mobile-chrome]')
			: null;
		if (appHeader instanceof HTMLElement) {
			appHeader.hidden = !shouldShowAppMobileChrome;
			if (shouldShowAppMobileChrome) appHeader.removeAttribute('hidden');
		}
		if (appMobileNav instanceof HTMLElement) {
			appMobileNav.hidden = !shouldShowAppMobileChrome;
			if (shouldShowAppMobileChrome) appMobileNav.removeAttribute('hidden');
		}
		if (mobileChrome instanceof HTMLElement) {
			mobileChrome.hidden =
				shouldShowAppMobileChrome || activePseudoChannelSlug === 'feed_doom';
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

	function mapPendingCreationToFeedItem(pending, viewerId, authorHints) {
		const rawId = pending?.id;
		const numId = Number(rawId);
		const hasServerId =
			Number.isFinite(numId) && numId > 0 && !String(rawId).startsWith('pending-');
		const statusRaw = pending?.status || 'creating';
		const status =
			typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : 'creating';
		const handleRaw = authorHints?.handleRaw != null ? String(authorHints.handleRaw).trim() : '';
		const displayName =
			authorHints?.displayName != null ? String(authorHints.displayName).trim() : '';
		const avatarUrl = authorHints?.avatarUrl != null ? String(authorHints.avatarUrl).trim() : '';
		const uid = viewerId != null ? Number(viewerId) : NaN;
		return {
			created_image_id: hasServerId ? numId : null,
			id: hasServerId ? numId : rawId,
			title: 'Creating...',
			summary: '',
			status: status === 'pending' ? 'pending' : 'creating',
			image_url: null,
			thumbnail_url: null,
			user_id: Number.isFinite(uid) ? uid : null,
			author_user_name: handleRaw,
			author_display_name: displayName,
			author_avatar_url: avatarUrl,
			created_at: pending?.created_at ?? new Date().toISOString(),
			published: false,
			published_at: null,
			like_count: 0,
			comment_count: 0,
			viewer_liked: false,
			nsfw: false,
			is_moderated_error: false,
			media_type: 'image',
			video_url: null,
			meta:
				typeof pending?.creation_token === 'string' && pending.creation_token.trim()
					? { creation_token: pending.creation_token.trim() }
					: null,
		};
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
			is_moderated_error: img?.is_moderated_error === true,
			media_type: typeof img?.media_type === 'string' ? img.media_type : 'image',
			video_url: typeof img?.video_url === 'string' ? img.video_url : null,
			meta: img?.meta && typeof img.meta === 'object' ? img.meta : null,
		};
	}

	function buildOptimisticReplyPostOptsFrom(opt) {
		const refMid = Number(opt?.referencedMessageId);
		if (!Number.isFinite(refMid) || refMid <= 0) return {};
		return {
			referencedMessageId: refMid,
			replyPreview: typeof opt.replyPreview === 'string' ? opt.replyPreview : ''
		};
	}

	function buildOptimisticSendRecord({ tempId, body, threadId, status, errorMessage, sendOpts }) {
		const rec = { tempId, body, threadId, status };
		if (typeof errorMessage === 'string' && errorMessage) {
			rec.errorMessage = errorMessage;
		}
		const refMid = Number(sendOpts?.referencedMessageId);
		if (Number.isFinite(refMid) && refMid > 0) {
			rec.referencedMessageId = refMid;
			rec.replyPreview = typeof sendOpts?.replyPreview === 'string' ? sendOpts.replyPreview : '';
		}
		return rec;
	}

	function optimisticReplyMetaShapeForIndicator(opt) {
		const refMid = Number(opt?.referencedMessageId);
		if (!Number.isFinite(refMid) || refMid <= 0) return null;
		const replySrc = lastChatMessagesPayload.find((x) => Number(x.id) === refMid);
		if (!replySrc || typeof replySrc !== 'object') return null;
		const storedPreview = typeof opt.replyPreview === 'string' ? opt.replyPreview.trim() : '';
		const preview =
			storedPreview ||
			plainTextReplyPreview(replySrc.body != null ? String(replySrc.body) : '');
		return {
			referenced_id: refMid,
			preview_text: preview,
			sender_user_name:
				replySrc.sender_user_name != null
					? String(replySrc.sender_user_name).trim().slice(0, 64)
					: '',
			sender_id: replySrc.sender_id != null ? Number(replySrc.sender_id) : NaN,
			sender_avatar_url:
				replySrc.sender_avatar_url != null
					? String(replySrc.sender_avatar_url).trim().slice(0, 4096)
					: '',
			sender_plan: replySrc.sender_plan
		};
	}

	function mountOptimisticRow(messagesEl, opt, sameSenderAsPrev, viewerId) {
		const row = document.createElement('div');
		const pending = opt.status === 'pending';
		row.className = `connect-chat-msg is-self${sameSenderAsPrev ? ' is-group-continue' : ''}${pending ? ' is-optimistic-pending' : ' is-optimistic-failed'}`;
		row.setAttribute('data-chat-optimistic-id', opt.tempId);
		const inner = document.createElement('div');
		inner.className = 'connect-chat-msg-inner';
		const rs = optimisticReplyMetaShapeForIndicator(opt);
		if (rs) {
			try {
				inner.appendChild(
					createReplyIndicatorElement(rs, true, { kind: 'chat', omitAvatar: true })
				);
			} catch {
				// ignore malformed optimistic reply preview
			}
		}
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
		bubble.innerHTML = processUserText(opt.body ?? '', { messageMarkdown: true });
		normalizeChatBubbleInlineImageSpacing(bubble);
		inner.appendChild(bubble);

		row.appendChild(inner);
		messagesEl.appendChild(row);
		row.setAttribute('data-chat-latest', '1');
		hydrateRichUserTextEmbeds(row);
		for (const b of row.querySelectorAll('.connect-chat-msg-bubble')) {
			trimTrailingWhitespaceAfterChatEmbed(b);
		}
		for (const embed of row.querySelectorAll('.connect-chat-creation-embed')) {
			trimChatCreationEmbedWhitespace(embed);
		}
	}

	async function postChatMessage(threadId, body, sendOpts = {}) {
		if (chatSimulateSendFail()) {
			await new Promise((r) => setTimeout(r, 400));
			return {
				ok: false,
				error: 'Simulated failure (remove ?chatSimulateSendFail=1 from the URL to send for real)'
			};
		}
		let wireBody = String(body || '');
		const meta = (await ensureThreadMetaById(threadId)) || chatPrivateThreadMetaById(threadId);
		if (isPrivateChannelThreadMeta(meta)) {
			const k = await fetchPrivateThreadKey(threadId);
			if (!k) {
				return { ok: false, error: 'Missing private key for this channel' };
			}
			const enc = await encryptPrivateText(wireBody, k);
			wireBody = `${CHAT_PRIVATE_MSG_PREFIX}${enc}`;
		}
		const refMid = Number(sendOpts.referencedMessageId);
		const hasRef = Number.isFinite(refMid) && refMid > 0;
		const payload = {
			body: wireBody,
			...(hasRef
				? {
						referenced_message_id: refMid,
						reply_preview: typeof sendOpts.replyPreview === 'string' ? sendOpts.replyPreview.slice(0, 400) : ''
					}
				: {})
		};
		const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { ok: false, error: data.message || data.error || 'Could not send' };
		}
		const message = await decryptMessageForActiveThread(data?.message || null, threadId);
		return { ok: true, message };
	}

	async function patchChatMessage(messageId, payload = {}) {
		if (chatSimulateSendFail()) {
			await new Promise((r) => setTimeout(r, 400));
			return {
				ok: false,
				error: 'Simulated failure (remove ?chatSimulateSendFail=1 from the URL to send for real)'
			};
		}
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) {
			return { ok: false, error: 'Invalid message id' };
		}
		const outPayload = { ...(payload && typeof payload === 'object' ? payload : {}) };
		const threadId = Number(activeThreadId);
		const meta = (await ensureThreadMetaById(threadId)) || chatPrivateThreadMetaById(threadId);
		if (isPrivateChannelThreadMeta(meta) && Object.prototype.hasOwnProperty.call(outPayload, 'body')) {
			let wireBody = String(outPayload.body || '');
			const k = await fetchPrivateThreadKey(threadId);
			if (!k) return { ok: false, error: 'Missing private key for this channel' };
			const enc = await encryptPrivateText(wireBody, k);
			wireBody = `${CHAT_PRIVATE_MSG_PREFIX}${enc}`;
			outPayload.body = wireBody;
		}
		const res = await fetch(`/api/chat/messages/${mid}`, {
			method: 'PATCH',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(outPayload)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { ok: false, error: data.message || data.error || 'Could not update message' };
		}
		const message = await decryptMessageForActiveThread(data?.message || null, threadId);
		return { ok: true, message };
	}

	async function patchChatMessageBody(messageId, body) {
		return patchChatMessage(messageId, { body });
	}

	async function decryptMessageForActiveThread(message, threadId) {
		if (!message || typeof message !== 'object') return null;
		const meta = (await ensureThreadMetaById(threadId)) || chatPrivateThreadMetaById(threadId);
		if (!isPrivateChannelThreadMeta(meta)) return message;
		if (message?.private_decrypted === true) return message;
		const body = String(message?.body || '');
		if (!body.startsWith(CHAT_PRIVATE_MSG_PREFIX)) {
			return { ...message, body: '[Encrypted message]' };
		}
		const k = await fetchPrivateThreadKey(threadId);
		if (!k) {
			return { ...message, body: '[Encrypted message]' };
		}
		const dec = await decryptPrivateText(body.slice(CHAT_PRIVATE_MSG_PREFIX.length), k);
		return { ...message, body: dec != null ? dec : '[Encrypted message]' };
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

	function finishAfterSendSuccess(threadId) {
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

	function removeOptimisticSendRows(messagesEl) {
		if (!messagesEl) return;
		for (const el of messagesEl.querySelectorAll('[data-chat-optimistic-id]')) {
			el.remove();
		}
	}

	function decorateAppendedChatRows(messagesEl, rows) {
		for (const row of rows) {
			try {
				hydrateRichUserTextEmbeds(row);
			} catch {
				// ignore
			}
			for (const b of row.querySelectorAll('.connect-chat-msg-bubble')) {
				trimTrailingWhitespaceAfterChatEmbed(b);
			}
			for (const embed of row.querySelectorAll('.connect-chat-creation-embed')) {
				trimChatCreationEmbedWhitespace(embed);
			}
		}
		setupReactionTooltipTap(messagesEl);
	}

	function appendChatMessagesToDom(messagesEl, allMessages, startIdx) {
		const viewerId = Number.isFinite(Number(chatViewerId)) ? Number(chatViewerId) : null;
		const rowFlags = {
			effectiveUnread: false,
			vStart: -1,
			vEnd: -1,
			showAdminDelete: chatViewerIsAdmin && !activePseudoChannelSlug,
			showHoverBar: !activePseudoChannelSlug,
		};
		let insertAfter = null;
		if (startIdx > 0) {
			for (let j = startIdx - 1; j >= 0; j--) {
				const beforeId = Number(allMessages[j]?.id);
				if (!Number.isFinite(beforeId) || beforeId <= 0) continue;
				const anchor = messagesEl.querySelector(
					`.connect-chat-msg[data-chat-message-id="${beforeId}"]`
				);
				if (anchor) {
					insertAfter = anchor;
					break;
				}
			}
			if (!insertAfter) {
				insertAfter = messagesEl.querySelector('.connect-chat-msg:last-of-type');
			}
			if (!insertAfter) return -1;
		}
		const appended = [];
		for (let i = startIdx; i < allMessages.length; i++) {
			const nm = allMessages[i];
			if (getChatCanvasMetaFromMessage(nm)) continue;
			const row = createChatMessageRowElement(nm, i, allMessages, viewerId, rowFlags);
			if (insertAfter) {
				messagesEl.insertBefore(row, insertAfter.nextSibling);
			} else {
				messagesEl.appendChild(row);
			}
			insertAfter = row;
			appended.push(row);
		}
		if (appended.length === 0) return 0;
		messagesEl.querySelector('.chat-page-empty-hint')?.remove();
		updateChatLatestRowMarker(messagesEl);
		decorateAppendedChatRows(messagesEl, appended);
		return appended.length;
	}

	async function afterSendSuccess(threadId, confirmedMessage = null) {
		optimisticSend = null;
		const messagesEl = root.querySelector('[data-chat-messages]');
		removeOptimisticSendRows(messagesEl);

		const msgForUi =
			confirmedMessage &&
			typeof confirmedMessage === 'object' &&
			!getChatCanvasMetaFromMessage(confirmedMessage)
				? confirmedMessage
				: null;

		if (msgForUi && messagesEl) {
			const mid = Number(msgForUi.id);
			const alreadyInCache = lastChatMessagesPayload.some((m) => Number(m.id) === mid);
			const alreadyInDom = Boolean(
				messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`)
			);
			if ((!alreadyInCache || !alreadyInDom) && Number.isFinite(mid) && mid > 0) {
				const nextPayload = alreadyInCache
					? lastChatMessagesPayload
					: [...lastChatMessagesPayload, msgForUi];
				const startIdx = nextPayload.findIndex((m) => Number(m.id) === mid);
				if (startIdx < 0) {
					await loadMessages();
				} else {
					const appended = appendChatMessagesToDom(messagesEl, nextPayload, startIdx);
					if (appended > 0) {
						if (!alreadyInCache) {
							lastChatMessagesPayload = nextPayload;
						}
						if (chatStickToBottom) {
							scrollChatMessagesToEnd();
						}
					} else if (appended < 0) {
						await loadMessages();
					}
				}
			}
		} else {
			await loadMessages();
		}
		finishAfterSendSuccess(threadId);
	}

	async function resendOptimisticFromUi(tempId) {
		if (!optimisticSend || optimisticSend.tempId !== tempId || optimisticSend.status !== 'failed') return;
		if (sendInFlight) return;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const { threadId, body } = optimisticSend;
		const replyPostOpts = buildOptimisticReplyPostOptsFrom(optimisticSend);
		const errEl = root.querySelector('[data-chat-error]');
		sendInFlight = true;
		optimisticSend = buildOptimisticSendRecord({
			tempId,
			body,
			threadId,
			status: 'pending',
			sendOpts: replyPostOpts
		});
		placeOptimisticInDom(messagesEl, optimisticSend);
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}
		try {
			const result = await postChatMessage(threadId, body, replyPostOpts);
			if (!result.ok) {
				optimisticSend = buildOptimisticSendRecord({
					tempId,
					body,
					threadId,
					status: 'failed',
					errorMessage: result.error,
					sendOpts: replyPostOpts
				});
				placeOptimisticInDom(messagesEl, optimisticSend);
				return;
			}
			await afterSendSuccess(threadId, result.message);
		} catch (err) {
			console.error('[Chat page] resend:', err);
			optimisticSend = buildOptimisticSendRecord({
				tempId,
				body,
				threadId,
				status: 'failed',
				errorMessage: err?.message || 'Could not send message.',
				sendOpts: replyPostOpts
			});
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
			chatGlobalUnreadBroadcastTeardown = await subscribeUserBroadcast(id, () => {
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
				// Keep sidebar rows in sync with the same unread signal used for tab/audio.
				void refreshChatSidebar();
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
		const privateLockIconHtml = (iconCls) => {
			const cls = escapeHtml(String(iconCls || '').trim() || 'chat-page-header-route-icon');
			return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="11" width="13" height="8.5" rx="2"></rect><path d="M8.5 11V8.5a3.5 3.5 0 1 1 7 0V11"></path></svg>`;
		};
		const privateChannelColorSeed = (threadMeta) => {
			const idPart = Number.isFinite(Number(threadMeta?.id)) ? String(Number(threadMeta.id)) : '0';
			let labelPart =
				typeof threadMeta?.title === 'string' && threadMeta.title.trim()
					? threadMeta.title.trim()
					: typeof threadMeta?.channel_slug === 'string' && threadMeta.channel_slug.trim()
						? threadMeta.channel_slug.trim()
						: 'private';
			labelPart = labelPart.replace(/^#+/, '').trim().toLowerCase() || 'private';
			return `private:${idPart}:${labelPart}`;
		};
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
		const slugRaw = rosterMod.inferPseudoStripSlugFromChannelMeta(meta);
		const resolvedServerAvatarUrl = (() => {
			const direct =
				typeof meta?.server_avatar_url === 'string' ? meta.server_avatar_url.trim() : '';
			if (direct) return direct;
			if (!slugRaw) return '';
			const joined = Array.isArray(chatJoinedServers) ? chatJoinedServers : [];
			for (const s of joined) {
				const tag = serverChannelTagFromServerName(
					typeof s?.name === 'string' ? s.name : ''
				);
				if (!tag || tag.toLowerCase() !== slugRaw) continue;
				const avatarUrl =
					typeof s?.avatar_url === 'string' ? s.avatar_url.trim() : '';
				if (avatarUrl) return avatarUrl;
			}
			return '';
		})();
		if (resolvedServerAvatarUrl) {
			return `<span class="chat-page-header-avatar ${sizeCls}" aria-hidden="true"><img class="chat-page-header-avatar-img" src="${escapeHtml(resolvedServerAvatarUrl)}" alt="" loading="lazy" decoding="async"></span>`;
		}
		if (slugRaw && rosterMod.SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slugRaw)) {
			const iconHtml = rosterMod.getPseudoStripRouteIconHtml(slugRaw, 'chat-page-header-route-icon');
			if (iconHtml) {
				return `<span class="chat-page-header-avatar chat-page-header-avatar--pseudo-strip ${sizeCls}" aria-hidden="true">${iconHtml}</span>`;
			}
		}
		const isPrivateChannel = String(meta?.visibility || '').trim().toLowerCase() === 'private';
		if (isPrivateChannel) {
			const seed = privateChannelColorSeed(meta);
			const bg = escapeHtml(getAvatarColor(seed));
			return `<span class="chat-page-header-avatar chat-page-header-avatar--channel ${sizeCls}" style="background: ${bg};" aria-hidden="true">${privateLockIconHtml('chat-page-header-route-icon')}</span>`;
		}
		const seed = slugRaw || String(meta?.title || 'channel').trim().toLowerCase() || 'channel';
		const bg = escapeHtml(getAvatarColor(seed));
		return `<span class="chat-page-header-avatar chat-page-header-avatar--channel ${sizeCls}" style="background: ${bg};" data-chat-header-avatar-glyph="#" aria-hidden="true"></span>`;
	}

	function getDmProfileHrefFromMeta(meta) {
		if (!meta || meta.type !== 'dm') return null;
		if (rosterMod.isSelfDmThread(meta, chatViewerId)) return null;
		const ou = meta?.other_user && typeof meta.other_user === 'object' ? meta.other_user : null;
		const oid =
			ou?.id != null ? Number(ou.id) : Number(rosterMod.getDmOtherUserId(meta));
		const profileHref = buildProfilePath({
			userName: typeof ou?.user_name === 'string' ? ou.user_name : undefined,
			userId: Number.isFinite(oid) && oid > 0 ? oid : undefined
		});
		if (profileHref) return profileHref;
		if (Number.isFinite(oid) && oid > 0) return `/user/${oid}`;
		return null;
	}

	function appendDmViewProfileMenuItem(parent) {
		const href = getDmProfileHrefFromMeta(activeHeaderMeta);
		if (!href || !(parent instanceof HTMLElement)) return;
		const profileBtn = document.createElement('button');
		profileBtn.type = 'button';
		profileBtn.className = 'feed-card-menu-item';
		profileBtn.dataset.chatDmProfileOpen = href;
		profileBtn.setAttribute('role', 'menuitem');
		profileBtn.textContent = 'View Profile';
		parent.appendChild(profileBtn);
	}

	function buildChatHeaderTitleInnerHtml(meta, label, opts = {}) {
		const avatarHtml = buildChatHeaderAvatarHtml(meta, opts);
		const inner = `${avatarHtml}<span class="chat-page-header-title-text">${escapeHtml(label)}</span>`;
		const profileHref = getDmProfileHrefFromMeta(meta);
		if (!profileHref) return inner;
		const ariaLabel = `View ${String(label || 'user').trim()} profile`;
		return `<a class="chat-page-header-profile-link" href="${escapeHtml(profileHref)}" data-profile-link aria-label="${escapeHtml(ariaLabel)}">${inner}</a>`;
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

		const replyBtn =
			activePseudoChannelSlug || !messageRowSupportsReply(m)
				? null
				: (() => {
						const btn = document.createElement('button');
						btn.type = 'button';
						btn.className = 'connect-chat-msg-hover-reply';
						btn.setAttribute('data-chat-hover-reply', '1');
						btn.dataset.chatMessageId = String(messageId);
						btn.setAttribute('aria-label', 'Reply');
						btn.innerHTML = replyTurnIcon('connect-chat-hover-reply-icon');
						return btn;
					})();

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
		const canEdit = isSelf || rowOpts.showAdminDelete === true;
		if (canEdit) {
			const editBtn = document.createElement('button');
			editBtn.type = 'button';
			editBtn.className = 'connect-chat-msg-hover-edit';
			editBtn.setAttribute('data-chat-hover-edit', '1');
			editBtn.dataset.chatMessageId = String(messageId);
			editBtn.setAttribute('aria-label', isSelf ? 'Edit your message' : 'Edit message (moderator)');
			editBtn.innerHTML = pencilIcon('connect-chat-hover-edit-icon');
			actions.appendChild(editBtn);
		}
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
		if (replyBtn) bar.appendChild(replyBtn);
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

	function getChatMessageEditedAt(m) {
		const meta = m?.meta;
		if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
		const raw = meta.edited_at;
		if (typeof raw !== 'string') return '';
		const t = raw.trim();
		return t || '';
	}

	function buildChatMessageEditedLabelElement(m) {
		if (!getChatMessageEditedAt(m)) return null;
		const inline = document.createElement('span');
		inline.className = 'connect-chat-msg-edited-inline';
		inline.textContent = ' (edited)';
		return inline;
	}

	function replaceChatMessageRowFromPayload(messageId, opts = {}) {
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) return null;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return null;
		const idx = lastChatMessagesPayload.findIndex((m) => Number(m.id) === mid);
		if (idx < 0) return null;
		const existing = messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (!existing) return null;
		const viewerId = Number.isFinite(Number(chatViewerId)) ? Number(chatViewerId) : null;
		const rowFlags = {
			effectiveUnread: false,
			vStart: -1,
			vEnd: -1,
			showAdminDelete: chatViewerIsAdmin && !activePseudoChannelSlug,
			showHoverBar: !activePseudoChannelSlug,
		};
		const next = createChatMessageRowElement(
			lastChatMessagesPayload[idx],
			idx,
			lastChatMessagesPayload,
			viewerId,
			rowFlags
		);
		if (opts.keepToolbarOpen === true) {
			next.classList.add('connect-chat-msg--toolbar-open');
		}
		existing.replaceWith(next);
		updateChatLatestRowMarker(messagesEl);
		try {
			hydrateRichUserTextEmbeds(next);
			if (typeof setupReactionTooltipTap === 'function') {
				setupReactionTooltipTap(messagesEl);
			}
		} catch {
			// ignore
		}
		for (const b of next.querySelectorAll('.connect-chat-msg-bubble')) {
			trimTrailingWhitespaceAfterChatEmbed(b);
		}
		for (const embed of next.querySelectorAll('.connect-chat-creation-embed')) {
			trimChatCreationEmbedWhitespace(embed);
		}
		return next;
	}

	function cancelActiveChatMessageEdit() {
		const mid = Number(activeMessageEditId);
		if (!Number.isFinite(mid) || mid <= 0) {
			activeMessageEditId = null;
			activeMessageEditSaving = false;
			return;
		}
		activeMessageEditSaving = false;
		activeMessageEditId = null;
		activeMessageEditMinHeightPx = 0;
		replaceChatMessageRowFromPayload(mid, { keepToolbarOpen: false });
	}

	async function saveActiveChatMessageEdit() {
		const mid = Number(activeMessageEditId);
		if (!Number.isFinite(mid) || mid <= 0 || activeMessageEditSaving) return;
		const row = root.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (!(row instanceof HTMLElement)) return;
		const dialog = row.querySelector('.connect-chat-msg-edit-dialog');
		if (!(dialog instanceof HTMLElement)) return;
		const input = dialog.querySelector('[data-chat-message-edit-input]');
		const saveBtn = dialog.querySelector('[data-chat-message-edit-save]');
		const cancelBtn = dialog.querySelector('[data-chat-message-edit-cancel]');
		const errEl = dialog.querySelector('[data-chat-message-edit-error]');
		if (!(input instanceof HTMLTextAreaElement) || !(saveBtn instanceof HTMLButtonElement)) return;
		const nextBody = String(input.value || '').trim();
		if (!nextBody) {
			if (errEl instanceof HTMLElement) {
				errEl.textContent = 'Message cannot be empty.';
				errEl.hidden = false;
			}
			return;
		}
		const idx = lastChatMessagesPayload.findIndex((m) => Number(m.id) === mid);
		if (idx < 0) return;
		const prevBody = lastChatMessagesPayload[idx]?.body != null
			? String(lastChatMessagesPayload[idx].body)
			: '';
		if (nextBody === prevBody.trim()) {
			cancelActiveChatMessageEdit();
			return;
		}
		activeMessageEditSaving = true;
		row.dataset.chatMessageEditSaving = '1';
		saveBtn.disabled = true;
		if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = true;
		if (errEl instanceof HTMLElement) {
			errEl.textContent = '';
			errEl.hidden = true;
		}
		try {
			const result = await patchChatMessage(mid, { body: nextBody });
			if (!result.ok || !result.message) {
				throw new Error(result.error || 'Could not save message.');
			}
			lastChatMessagesPayload[idx] = result.message;
			activeMessageEditSaving = false;
			activeMessageEditId = null;
			activeMessageEditMinHeightPx = 0;
			replaceChatMessageRowFromPayload(mid, { keepToolbarOpen: false });
		} catch (err) {
			activeMessageEditSaving = false;
			delete row.dataset.chatMessageEditSaving;
			saveBtn.disabled = false;
			if (cancelBtn instanceof HTMLButtonElement) cancelBtn.disabled = false;
			if (errEl instanceof HTMLElement) {
				errEl.textContent = err?.message || 'Could not save message.';
				errEl.hidden = false;
			}
		}
	}

	function startChatMessageEdit(messageId) {
		const mid = Number(messageId);
		if (!Number.isFinite(mid) || mid <= 0) return;
		if (activePseudoChannelSlug) return;
		if (activeMessageEditSaving) return;
		let measuredBubbleHeight = 0;
		const existingRow = root.querySelector(`.connect-chat-msg[data-chat-message-id="${mid}"]`);
		if (existingRow instanceof HTMLElement) {
			const existingBubble = existingRow.querySelector('.connect-chat-msg-bubble');
			if (existingBubble instanceof HTMLElement) {
				measuredBubbleHeight = Math.ceil(existingBubble.getBoundingClientRect().height);
			}
		}
		if (Number.isFinite(Number(activeMessageEditId)) && Number(activeMessageEditId) !== mid) {
			cancelActiveChatMessageEdit();
		}
		const row = replaceChatMessageRowFromPayload(mid, { keepToolbarOpen: true });
		if (!(row instanceof HTMLElement)) return;
		const bubble = row.querySelector('.connect-chat-msg-bubble');
		if (!(bubble instanceof HTMLElement)) return;
		activeMessageEditMinHeightPx = Math.max(92, measuredBubbleHeight + 14);
		const msg = lastChatMessagesPayload.find((x) => Number(x.id) === mid);
		if (!msg) return;
		const bodyValue = msg?.body != null ? String(msg.body) : '';
		row.dataset.chatMessageEditing = '1';
		activeMessageEditId = mid;
		activeMessageEditSaving = false;
		bubble.innerHTML = `<div class="connect-chat-msg-edit-dialog">
			<textarea class="connect-chat-msg-edit-input" data-chat-message-edit-input rows="4" maxlength="4000" aria-label="Edit message">${escapeHtml(bodyValue)}</textarea>
			<p class="connect-chat-msg-edit-error" data-chat-message-edit-error hidden></p>
			<div class="connect-chat-msg-edit-actions">
				<button type="button" class="connect-chat-msg-edit-cancel" data-chat-message-edit-cancel>Cancel</button>
				<button type="button" class="btn-primary connect-chat-msg-edit-save" data-chat-message-edit-save>
					<span class="connect-chat-msg-edit-save-label">Save</span>
					<span class="connect-chat-msg-edit-save-spinner" aria-hidden="true"></span>
				</button>
			</div>
		</div>`;
		const input = bubble.querySelector('[data-chat-message-edit-input]');
		if (input instanceof HTMLTextAreaElement) {
			const baseMinHeight = Number.isFinite(activeMessageEditMinHeightPx) && activeMessageEditMinHeightPx > 0
				? activeMessageEditMinHeightPx
				: 92;
			input.style.minHeight = `${baseMinHeight}px`;
			const syncEditInputHeight = () => {
				input.style.height = 'auto';
				const next = Math.max(baseMinHeight, Math.ceil(input.scrollHeight));
				input.style.height = `${next}px`;
			};
			syncEditInputHeight();
			input.addEventListener('input', syncEditInputHeight);
			input.focus();
			if (!isChatPageMobileLayout()) {
				input.select();
			}
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					cancelActiveChatMessageEdit();
					return;
				}
				if (e.key === 'Enter' && !e.shiftKey && !isChatPageMobileLayout()) {
					e.preventDefault();
					void saveActiveChatMessageEdit();
				}
			});
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
						safeMediaPlay(v);
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

	function openChatInlineImageLightbox(src, creationMeta) {
		return openChatInlineImageLightboxShared(src, creationMeta, { beforeOpen: closeReactionPicker });
	}

	function openChatAttachmentPreviewLightbox(src, kind) {
		return openChatAttachmentPreviewLightboxShared(src, kind, { beforeOpen: closeReactionPicker });
	}

	function syncChatComposerHashtagTargets() {
		if (
			typeof clearPageHashtagTargets !== 'function' ||
			typeof addPageHashtagTargets !== 'function'
		) {
			return;
		}
		clearPageHashtagTargets();
		const items = [];
		const seen = new Set();
		const joinedServerSlugs = new Set(
			(Array.isArray(chatJoinedServers) ? chatJoinedServers : [])
				.map((s) =>
					serverChannelTagFromServerName(typeof s?.name === 'string' ? s.name : '')
				)
				.filter((slug) => Boolean(slug))
				.map((slug) => String(slug).toLowerCase())
		);
		const addTarget = (item) => {
			const type = String(item?.type || 'channel').trim().toLowerCase();
			const slug = String(item?.slug || '')
				.trim()
				.toLowerCase()
				.replace(/^#/, '');
			const dedupeKey = `${type}:${slug}`;
			if (!slug || seen.has(dedupeKey)) return;
			seen.add(dedupeKey);
			items.push({
				...item,
				type,
				slug
			});
		};

		for (const t of Array.isArray(chatThreads) ? chatThreads : []) {
			if (!t || t.type !== 'channel') continue;
			const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
			if (!slug) continue;
			if (rosterMod.SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) continue;
			if (joinedServerSlugs.has(slug)) continue;
			const rawTitle = typeof t.title === 'string' ? t.title.trim() : '';
			const displayTitle = rawTitle.replace(/^#/, '').trim();
			addTarget({
				type: 'channel',
				id: `channel:${slug}`,
				label: displayTitle || `#${slug}`,
				sublabel: `#${slug}`,
				slug,
				badge: 'Channel'
			});
		}

		for (const slugRaw of rosterMod.SIDEBAR_PSEUDO_STRIP_ORDER || []) {
			const slug = String(slugRaw || '').trim().toLowerCase();
			if (!slug) continue;
			addTarget({
				type: 'pseudo_channel',
				id: `pseudo_channel:${slug}`,
				label: rosterMod.getSidebarPseudoChannelTitle(slug) || `#${slug}`,
				sublabel: `#${slug}`,
				slug,
				badge: 'Default'
			});
		}
		addTarget({
			type: 'pseudo_channel',
			id: 'pseudo_channel:create',
			label: 'Create',
			sublabel: '#create',
			slug: 'create',
			badge: 'Default'
		});
		addTarget({
			type: 'pseudo_channel',
			id: 'pseudo_channel:notes',
			label: 'My Notes',
			sublabel: '#notes',
			slug: 'notes',
			badge: 'Default'
		});
		addTarget({
			type: 'pseudo_channel',
			id: 'pseudo_channel:help',
			label: 'Help',
			sublabel: '#help',
			slug: 'help',
			badge: 'Default'
		});

		for (const s of Array.isArray(chatJoinedServers) ? chatJoinedServers : []) {
			const id = Number(s?.id);
			const name = typeof s?.name === 'string' ? s.name.trim() : '';
			const slug = serverChannelTagFromServerName(name);
			if (!slug) continue;
			addTarget({
				type: 'server',
				id: Number.isFinite(id) && id > 0 ? `server:${id}` : `server:${slug.toLowerCase()}`,
				label: name || `#${slug}`,
				sublabel: `#${slug.toLowerCase()}`,
				slug,
				badge: 'Server'
			});
		}

		addPageHashtagTargets(items);
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
			void hydratePrivateThreadTitlesInPlace(chatThreads);
			chatViewerIsAdmin = cached.viewerIsAdmin === true;
			chatViewerIsFounder = cached.viewerIsFounder === true;
			syncChatComposerHashtagTargets();
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
		for (const t of chatThreads) {
			if (!t || t.type !== 'channel' || String(t.visibility || '').toLowerCase() !== 'private') continue;
			t.title = 'Private channel';
		}
		await hydratePrivateThreadTitlesInPlace(chatThreads);
		chatViewerIsAdmin = Boolean(result.data?.viewer_is_admin);
		chatViewerIsFounder = Boolean(result.data?.viewer_is_founder);
		syncChatComposerHashtagTargets();
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

	function chatPrivateThreadMetaById(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		return (chatThreads || []).find((t) => Number(t?.id) === tid) || null;
	}

	async function ensureThreadMetaById(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		const existing = chatPrivateThreadMetaById(tid);
		if (existing) return existing;
		try {
			const res = await fetch(`/api/chat/threads/${tid}`, { credentials: 'include' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data?.thread || typeof data.thread !== 'object') return existing || null;
			const t = data.thread;
			const idx = (chatThreads || []).findIndex((x) => Number(x?.id) === tid);
			if (idx >= 0) {
				chatThreads[idx] = { ...chatThreads[idx], ...t };
			} else {
				chatThreads.push(t);
			}
			return t;
		} catch {
			return existing || null;
		}
	}

	function isPrivateChannelThreadMeta(meta) {
		return (
			meta?.type === 'channel' &&
			String(meta?.visibility || '').trim().toLowerCase() === 'private'
		);
	}

	async function fetchPrivateThreadKey(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		if (chatPrivateKeyByThreadId.has(tid)) {
			return chatPrivateKeyByThreadId.get(tid);
		}
		const res = await fetch(`/api/chat/threads/${tid}/private-key`, { credentials: 'include' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return null;
		const k = typeof data?.k === 'string' ? data.k.trim() : '';
		if (!k) return null;
		chatPrivateKeyByThreadId.set(tid, k);
		return k;
	}

	function bytesToB64(bytes) {
		if (!(bytes instanceof Uint8Array)) return '';
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	}

	function b64ToBytes(s) {
		try {
			let src = String(s || '').trim();
			if (!src) return null;
			// Accept both base64url (`-_`) and classic base64 (`+/`) payloads.
			src = src.replace(/-/g, '+').replace(/_/g, '/');
			const pad = src.length % 4;
			if (pad) src += '='.repeat(4 - pad);
			const raw = atob(src);
			const out = new Uint8Array(raw.length);
			for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
			return out;
		} catch {
			return null;
		}
	}

	async function deriveAesKeyFromSecret(secret) {
		const enc = new TextEncoder();
		const hash = await crypto.subtle.digest('SHA-256', enc.encode(String(secret || '')));
		return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
	}

	async function encryptPrivateText(plain, secret) {
		const key = await deriveAesKeyFromSecret(secret);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const enc = new TextEncoder().encode(String(plain || ''));
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
		return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
	}

	async function decryptPrivateText(token, secret) {
		const parts = String(token || '').split('.');
		if (parts.length !== 2) return null;
		const iv = b64ToBytes(parts[0]);
		const ct = b64ToBytes(parts[1]);
		if (!(iv instanceof Uint8Array) || !(ct instanceof Uint8Array)) return null;
		try {
			const key = await deriveAesKeyFromSecret(secret);
			const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
			return new TextDecoder().decode(plainBuf);
		} catch {
			return null;
		}
	}

	async function hydratePrivateThreadTitlesInPlace(threads) {
		const list = Array.isArray(threads) ? threads : [];
		for (const t of list) {
			if (!isPrivateChannelThreadMeta(t)) continue;
			const tid = Number(t.id);
			if (!Number.isFinite(tid) || tid <= 0) continue;
			const encName = typeof t.enc_name === 'string' ? t.enc_name.trim() : '';
			if (!encName) continue;
			const k = await fetchPrivateThreadKey(tid);
			if (!k) continue;
			const probe = typeof t.enc_probe === 'string' ? t.enc_probe.trim() : '';
			if (probe) {
				const probePlain = await decryptPrivateText(probe, k);
				if (probePlain !== CHAT_PRIVATE_PROBE_TEXT) continue;
			}
			const dec = await decryptPrivateText(encName, k);
			if (dec && dec.trim()) {
				t.title = `#${dec.trim()}`;
			}
		}
	}

	function normalizePathForCompare(p) {
		return rosterMod.normalizeChatNavPathForCompare(p);
	}

	function isChatHrefActive(href) {
		return rosterMod.isChatSidebarHrefActive(href, {
			pathname: window.location.pathname,
			threads: chatThreads,
			viewerId: chatViewerId
		});
	}

	/**
	 * Top pseudo strip (`[data-chat-sidebar-pseudo-list]`): set `is-active` synchronously from `pathname`.
	 * Runs on sidebar click before async pane work so highlight matches immediately; also covers patch failures.
	 */
	function syncChatSidebarPseudoStripActiveNow(pathname) {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;
		const listEl = sidebar.querySelector('[data-chat-sidebar-pseudo-list]');
		if (!(listEl instanceof HTMLElement)) return;
		const pathRaw =
			typeof pathname === 'string' && pathname.trim()
				? pathname.trim()
				: String(window.location.pathname || '');
		const path = pathRaw.replace(/\/+$/, '') || '/';
		const ctx = {
			pathname: path,
			threads: chatThreads,
			viewerId: chatViewerId
		};
		const anchors = listEl.querySelectorAll(
			':scope > a.chat-page-sidebar-row:not([data-chat-sidebar-strip-create])'
		);
		for (const a of anchors) {
			if (!(a instanceof HTMLAnchorElement)) continue;
			const href = a.getAttribute('href') || '';
			const active = rosterMod.isChatSidebarHrefActive(href, ctx);
			a.classList.toggle('is-active', active);
		}
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
				can_manage: Boolean(s.can_manage),
				avatar_url:
					typeof s.avatar_url === 'string' && s.avatar_url.trim()
						? s.avatar_url.trim()
						: ''
			}))
			.filter((s) => Number.isFinite(s.id) && s.id > 0);
	}

	async function fetchPresenceOnlineSnapshot({ allowCached = false } = {}) {
		if (
			allowCached &&
			lastPresenceOnlineSnapshot &&
			Date.now() - lastPresenceOnlineSnapshotAt < PRESENCE_ONLINE_SNAPSHOT_TTL_MS
		) {
			return lastPresenceOnlineSnapshot;
		}
		try {
			const res = await fetch('/api/presence/online', { credentials: 'include' });
			if (!res.ok) {
				return lastPresenceOnlineSnapshot || { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
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
			const snapshot = { onlineIds, lastSeenMsByUserId };
			lastPresenceOnlineSnapshot = snapshot;
			lastPresenceOnlineSnapshotAt = Date.now();
			return snapshot;
		} catch {
			return lastPresenceOnlineSnapshot || { onlineIds: new Set(), lastSeenMsByUserId: new Map() };
		}
	}

	async function fetchPresenceLastActiveSnapshot(userIds, { allowCached = false } = {}) {
		const ids = Array.isArray(userIds)
			? [...new Set(userIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))]
			: [];
		if (ids.length === 0) return new Map();
		const idsKey = ids.join(',');
		if (
			allowCached &&
			lastPresenceLastActiveCache &&
			lastPresenceLastActiveCacheKey === idsKey &&
			Date.now() - lastPresenceLastActiveCacheAt < PRESENCE_LAST_ACTIVE_SNAPSHOT_TTL_MS
		) {
			return new Map(lastPresenceLastActiveCache);
		}
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
			lastPresenceLastActiveCache = out;
			lastPresenceLastActiveCacheAt = Date.now();
			lastPresenceLastActiveCacheKey = idsKey;
			return out;
		} catch {
			if (lastPresenceLastActiveCache && lastPresenceLastActiveCacheKey === idsKey) {
				return new Map(lastPresenceLastActiveCache);
			}
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

	/** Desktop sidebar footer: current user; opens account menu (open-account-menu), same as header avatar. */
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
		const creditBadgeEl = sidebar?.querySelector?.('[data-chat-sidebar-credit-badge]');
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

		function updateSidebarCreditsAttention(canClaim) {
			if (!(creditBtn instanceof HTMLButtonElement)) return;
			const show = canClaim === true;
			creditBtn.classList.toggle('attention', show);
			if (creditBadgeEl instanceof HTMLElement) {
				creditBadgeEl.classList.toggle('has-unread', show);
				creditBadgeEl.textContent = '';
			}
			if (show) {
				creditBtn.setAttribute('aria-label', 'Open credits (daily claim available)');
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

		async function loadSidebarCreditsClaimStatus({ force = false } = {}) {
			try {
				const result = await fetchJsonWithStatusDeduped(
					'/api/credits',
					{ credentials: 'include' },
					{ windowMs: force ? 0 : 2000 }
				);
				if (!result.ok) {
					updateSidebarCreditsAttention(null);
					return;
				}
				const canClaim = result?.data && typeof result.data.canClaim === 'boolean'
					? result.data.canClaim
					: null;
				updateSidebarCreditsAttention(canClaim);
			} catch {
				updateSidebarCreditsAttention(null);
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
			void loadSidebarCreditsClaimStatus();
			scheduleChatSidebarNotificationsPreviewPrefetch();
			row.hidden = false;
			const notificationsUpdatedHandler = () => {
				void loadSidebarNotificationsCount({ force: true });
				scheduleChatSidebarNotificationsPreviewPrefetch({ force: true });
			};
			const creditsUpdatedHandler = (event) => {
				updateSidebarCreditsUI(event?.detail?.count);
				void loadSidebarCreditsClaimStatus({ force: true });
			};
			const creditsClaimStatusHandler = (event) => {
				const value = event?.detail?.canClaim;
				updateSidebarCreditsAttention(typeof value === 'boolean' ? value : null);
			};
			if (sidebar && !sidebar.dataset.notificationsBound) {
				sidebar.dataset.notificationsBound = '1';
				document.addEventListener('notifications-acknowledged', notificationsUpdatedHandler);
				document.addEventListener('credits-updated', creditsUpdatedHandler);
				document.addEventListener('credits-claim-status', creditsClaimStatusHandler);
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
		const cachedRosterSnapshot =
			!skipThreads && typeof readSidebarRosterSessionCache === 'function'
				? readSidebarRosterSessionCache(chatViewerId)
				: null;
		const hasSidebarMarkup = [dmEl, svEl, chEl].some((el) => {
			return el instanceof HTMLElement && String(el.innerHTML || '').trim().length > 0;
		});
		if (!skipThreads && !cachedRosterSnapshot && !hasSidebarMarkup) {
			const skeletonHtml = renderChatSidebarListSkeleton(5);
			dmEl.innerHTML = skeletonHtml;
			svEl.innerHTML = skeletonHtml;
			chEl.innerHTML = skeletonHtml;
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
			chatJoinedServers = joinedArr;
			syncChatComposerHashtagTargets();
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
			const dmsNorm = dmsRaw.filter((t) => !rosterMod.isSelfDmThread(t, chatViewerId));
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
			const dmsPresenceOrdered = prioritizeOnlineDmsInVisibleWindow(dmsPinned, {
				visibleCap: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP,
				isOnline: isDmOnlineForSidebar,
				getLastSeenMs: dmLastActiveMsForSidebar,
				getLastInteractedMs: dmLastInteractedMsForSidebar
			});
			const dmsUnreadOrdered = rosterMod.prioritizeUnreadRowsInVisibleWindow(dmsPresenceOrdered, {
				visibleCap: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP,
				getLastActivityMs: dmLastInteractedMsForSidebar
			});
			const dms = dmsUnreadOrdered;
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
			const serverChannels = rosterMod.prioritizeUnreadRowsInVisibleWindow(
				rosterMod.sortChannelRowsByLastActivity(serverChannelsRaw),
				{ visibleCap: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP }
			);
			const otherChannels = rosterMod.prioritizeUnreadRowsInVisibleWindow(
				rosterMod.sortChannelRowsByLastActivity(otherChannelsRaw),
				{ visibleCap: rosterMod.CHAT_SIDEBAR_COLLAPSE_LIST_CAP }
			);

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
				const threadId = Number(t?.id);
				const threadIdAttr =
					Number.isFinite(threadId) && threadId > 0
						? ` data-chat-row-menu-thread-id="${threadId}"`
						: '';
				const pinKey =
					t.type === 'dm' && !selfDm ? rosterMod.dmStablePinStorageKey(t) : null;
				const rowKind = t?.type === 'dm' ? 'dm' : t?.type === 'channel' ? 'channel' : 'thread';
				const gearAriaLabel = rowKind === 'dm' ? 'Direct message options' : 'Channel options';
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
					return `<div class="chat-page-sidebar-row chat-page-sidebar-row--dm-with-menu chat-page-sidebar-row--with-menu${activeClass}${pc}${extraRow}"${dataPseudoSlugAttr}${dataDmKeyAttr}>
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
					<button type="button" class="chat-page-sidebar-server-settings chat-page-sidebar-dm-menu-btn" data-chat-dm-menu="${escapeHtml(pinKey)}" data-chat-dm-profile-href="${profileHrefAttr}" data-chat-dm-other-user-id="${escapeHtml(otherUserIdAttr)}"${threadIdAttr} data-chat-row-menu-kind="${rowKind}" aria-label="Direct message options" aria-haspopup="menu" aria-expanded="false">${chatSidebarServerGearSvg}</button>
				</div>`;
				}
				return `<div class="chat-page-sidebar-row chat-page-sidebar-row--with-menu${activeClass}${pc}${extraRow}"${dataPseudoSlugAttr}${dataHelpAttr}${dataDmKeyAttr}>
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
					<button type="button" class="chat-page-sidebar-server-settings" data-chat-sidebar-row-menu="1"${threadIdAttr} data-chat-row-menu-kind="${rowKind}" aria-label="${gearAriaLabel}" aria-haspopup="menu" aria-expanded="false">${chatSidebarServerGearSvg}</button>
				</div>`;
			}

			function serverRowHtml(t) {
				const href = rosterMod.buildChatThreadUrl(t);
				const active = isChatHrefActive(href);
				const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
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
				const avatarThread =
					meta && typeof meta.avatar_url === 'string' && meta.avatar_url.trim()
						? { ...t, server_avatar_url: meta.avatar_url.trim() }
						: t;
				const avatarHtml = rosterMod.buildChatThreadRowAvatarHtml(avatarThread, deps);
				const threadId = Number(t?.id);
				const threadIdAttr =
					Number.isFinite(threadId) && threadId > 0
						? ` data-chat-row-menu-thread-id="${threadId}"`
						: '';
				const serverMenuAttrs =
					meta && Number.isFinite(Number(meta.id)) && Number(meta.id) > 0
						? ` data-chat-server-settings="${Number(meta.id)}" data-chat-server-can-manage="${meta.can_manage ? '1' : '0'}"`
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
					<button type="button" class="chat-page-sidebar-server-settings" data-chat-sidebar-row-menu="1"${threadIdAttr} data-chat-row-menu-kind="server"${serverMenuAttrs} aria-label="Server options" aria-haspopup="menu" aria-expanded="false">${chatSidebarServerGearSvg}</button>
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
				const patched = tryPatchPseudoStripInPlace(pseudoListEl, stripRows);
				if (!patched) {
					syncChatSidebarPseudoStripActiveNow(window.location.pathname);
				}
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

		// While the full network roster loads, show the last session snapshot (same viewer) so
		// leaving and returning to chat does not flash an empty sidebar. LS may have fresher
		// threads — prefer in-memory `chatThreads` when present.
		if (!skipThreads) {
			const snap = cachedRosterSnapshot;
			if (snap && typeof readSidebarRosterSessionCache === 'function') {
				const threadsPaint =
					Array.isArray(chatThreads) && chatThreads.length > 0 ? chatThreads : snap.threads || [];
				const joinedPaint = Array.isArray(snap.joined) ? snap.joined : [];
				const presPaint =
					snap.presenceSnapshot && typeof snap.presenceSnapshot === 'object'
						? snap.presenceSnapshot
						: { onlineIds: new Set(), lastSeenMsByUserId: new Map(), lastActiveMsByUserId: new Map() };
				runRender(threadsPaint, joinedPaint, presPaint, snap.viewerProfile);
			}
		}

		function persistSidebarRosterSnapshot(joined, presenceSnapshot, viewerProfile) {
			if (typeof writeSidebarRosterSessionCache !== 'function') return;
			const vid = chatViewerId;
			if (vid == null || !Number.isFinite(Number(vid)) || Number(vid) <= 0) return;
			writeSidebarRosterSessionCache(vid, {
				threads: Array.isArray(chatThreads) ? chatThreads : [],
				joined: Array.isArray(joined) ? joined : [],
				presenceSnapshot,
				viewerProfile
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
				fetchPresenceOnlineSnapshot({ allowCached: true }),
				pack.profileMini,
				fetchPresenceLastActiveSnapshot(dmUserIds, { allowCached: true })
			]);
			const presenceSnapshot = {
				...(presenceOnlineSnapshot || {}),
				lastActiveMsByUserId
			};
			runRender(chatThreads || [], joined, presenceSnapshot, viewerProfile);
			persistSidebarRosterSnapshot(joined, presenceSnapshot, viewerProfile);
			if (Date.now() - chatSidebarLastViewerSyncAt >= 120000) {
				chatSidebarLastViewerSyncAt = Date.now();
				await syncChatSidebarViewerRow();
			}
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
			persistSidebarRosterSnapshot(joined, presenceSnapshot, viewerProfile);
			dispatchChatUnreadRefresh();
		} catch {
			// If network fails, keep cached render.
		}
		chatSidebarLastViewerSyncAt = Date.now();
		await syncChatSidebarViewerRow();
	}

	function openHeaderNotificationsMenuFromSidebar() {
		const nav = document.querySelector('app-navigation');
		if (
			nav &&
			typeof nav.toggleNotificationsMenu === 'function' &&
			window.getComputedStyle(nav).display !== 'none'
		) {
			nav.toggleNotificationsMenu();
			return true;
		}
		const headerNotificationsButton = document.querySelector('app-navigation .notifications-button');
		if (
			headerNotificationsButton instanceof HTMLButtonElement &&
			window.getComputedStyle(headerNotificationsButton).display !== 'none'
		) {
			headerNotificationsButton.click();
			return true;
		}
		return false;
	}

	function closeChatSidebarNotificationsMenu() {
		if (!(chatSidebarNotificationsMenuEl instanceof HTMLElement)) return;
		chatSidebarNotificationsMenuEl.classList.remove('open');
		chatSidebarNotificationsMenuEl.hidden = true;
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	function scheduleChatSidebarNotificationsPreviewPrefetch({ force = false } = {}) {
		const run = () => {
			void loadChatSidebarNotificationsPreviewData({ force });
		};
		if (window.requestIdleCallback) {
			window.requestIdleCallback(run, { timeout: 1200 });
			return;
		}
		setTimeout(run, 150);
	}

	function ensureChatSidebarNotificationsMenu(anchorBtn) {
		if (!(anchorBtn instanceof HTMLElement)) return null;
		const actionsWrap = anchorBtn.closest('.chat-page-sidebar-footer-actions');
		if (!(actionsWrap instanceof HTMLElement)) return null;
		if (chatSidebarNotificationsMenuEl instanceof HTMLElement && actionsWrap.contains(chatSidebarNotificationsMenuEl)) {
			return chatSidebarNotificationsMenuEl;
		}
		const menu = document.createElement('div');
		menu.className = 'chat-page-sidebar-notifications-menu';
		menu.hidden = true;
		menu.innerHTML = `
			<div class="chat-page-sidebar-notifications-preview" data-chat-sidebar-notifications-preview></div>
			<div class="chat-page-sidebar-notifications-divider"></div>
			<button type="button" class="chat-page-sidebar-notifications-view-all" data-chat-sidebar-notifications-view-all>View all</button>
		`;
		menu.addEventListener('click', (e) => {
			e.stopPropagation();
		});
		const viewAllBtn = menu.querySelector('[data-chat-sidebar-notifications-view-all]');
		if (viewAllBtn instanceof HTMLButtonElement) {
			viewAllBtn.addEventListener('click', () => {
				closeChatSidebarNotificationsMenu();
				document.dispatchEvent(new CustomEvent('open-notifications'));
			});
		}
		actionsWrap.appendChild(menu);
		chatSidebarNotificationsMenuEl = menu;
		return menu;
	}

	async function loadChatSidebarNotificationsPreviewData({ force = false } = {}) {
		const now = Date.now();
		if (
			!force &&
			chatSidebarNotificationsPreviewCache.length > 0 &&
			now - chatSidebarNotificationsPreviewLoadedAt < 30000
		) {
			return chatSidebarNotificationsPreviewCache;
		}
		if (chatSidebarNotificationsPreviewLoading) {
			return chatSidebarNotificationsPreviewCache;
		}
		chatSidebarNotificationsPreviewLoading = true;
		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/notifications',
				{ credentials: 'include' },
				{ windowMs: force ? 0 : 2000 }
			);
			if (!result.ok) return null;
			const notifications = Array.isArray(result.data?.notifications)
				? result.data.notifications.slice(0, 5)
				: [];
			chatSidebarNotificationsPreviewCache = notifications;
			chatSidebarNotificationsPreviewLoadedAt = Date.now();
			return notifications;
		} catch {
			return null;
		} finally {
			chatSidebarNotificationsPreviewLoading = false;
		}
	}

	function renderChatSidebarNotificationsPreviewItems(preview, notifications) {
		if (!(preview instanceof HTMLElement)) return;
		if (!Array.isArray(notifications) || notifications.length === 0) {
			preview.innerHTML =
				'<div class="chat-page-sidebar-notifications-menu-item is-static">No notifications yet.</div>';
			return;
		}
		const frag = document.createDocumentFragment();
		for (const notification of notifications) {
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'chat-page-sidebar-notifications-menu-item';
			if (notification.acknowledged_at) item.classList.add('is-read');
			const title = document.createElement('div');
			title.className = 'chat-page-sidebar-notifications-title';
			title.textContent = notification.title || 'Notification';
			const message = document.createElement('div');
			message.className = 'chat-page-sidebar-notifications-message';
			message.textContent = notification.message || '';
			const time = document.createElement('div');
			time.className = 'chat-page-sidebar-notifications-time';
			time.textContent = formatRelativeTime(notification.created_at) || '';
			item.appendChild(title);
			item.appendChild(message);
			item.appendChild(time);
			const clickable = notificationPrimaryClickable(notification);
			if (!clickable) {
				item.disabled = true;
				item.classList.add('is-static');
			} else {
				item.addEventListener('click', async () => {
					item.classList.add('is-loading');
					item.setAttribute('aria-busy', 'true');
					try {
						await fetch('/api/notifications/acknowledge', {
							method: 'POST',
							headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
							body: new URLSearchParams({ id: String(notification.id) }),
							credentials: 'include'
						});
					} catch {
						// ignore
					}
					closeChatSidebarNotificationsMenu();
					document.dispatchEvent(new CustomEvent('close-all-modals'));
					const href = notificationPrimaryHref(notification);
					if (href) {
						window.location.href = href;
						return;
					}
					if (notification.type === 'tip') {
						document.dispatchEvent(
							new CustomEvent('open-notifications', {
								detail: { notificationId: notification.id }
							})
						);
						document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
					}
				});
			}
			frag.appendChild(item);
		}
		preview.innerHTML = '';
		preview.appendChild(frag);
	}

	async function renderChatSidebarNotificationsPreview(menu) {
		if (!(menu instanceof HTMLElement)) return;
		const preview = menu.querySelector('[data-chat-sidebar-notifications-preview]');
		if (!(preview instanceof HTMLElement)) return;
		if (chatSidebarNotificationsPreviewCache.length > 0) {
			renderChatSidebarNotificationsPreviewItems(preview, chatSidebarNotificationsPreviewCache);
		} else {
			preview.innerHTML = '<div class="chat-page-sidebar-notifications-menu-item is-loading">Loading...</div>';
		}
		try {
			const notifications = await loadChatSidebarNotificationsPreviewData({
				force: chatSidebarNotificationsPreviewCache.length === 0
			});
			if (!Array.isArray(notifications)) {
				if (chatSidebarNotificationsPreviewCache.length > 0) return;
				preview.innerHTML =
					'<div class="chat-page-sidebar-notifications-menu-item is-static">Failed to load notifications.</div>';
				return;
			}
			renderChatSidebarNotificationsPreviewItems(preview, notifications);
		} catch {
			if (chatSidebarNotificationsPreviewCache.length > 0) return;
			preview.innerHTML =
				'<div class="chat-page-sidebar-notifications-menu-item is-static">Failed to load notifications.</div>';
		}
	}

	async function toggleChatSidebarNotificationsMenu(notificationsBtn) {
		const menu = ensureChatSidebarNotificationsMenu(notificationsBtn);
		if (!(menu instanceof HTMLElement)) {
			document.dispatchEvent(new CustomEvent('open-notifications'));
			return;
		}
		const willOpen = menu.hidden;
		if (!willOpen) {
			closeChatSidebarNotificationsMenu();
			return;
		}
		menu.hidden = false;
		menu.classList.add('open');
		document.dispatchEvent(new CustomEvent('modal-opened'));
		await renderChatSidebarNotificationsPreview(menu);
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
				document.dispatchEvent(
					new CustomEvent('open-account-menu', { bubbles: true, detail: { anchor: profileBtn } })
				);
				return;
			}
			const notificationsBtn = e.target?.closest?.('[data-chat-sidebar-open-notifications]');
			if (notificationsBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				void toggleChatSidebarNotificationsMenu(notificationsBtn);
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
					onMarkAsRead: () => {
						const tid = Number(dmGearBtn.getAttribute('data-chat-row-menu-thread-id'));
						return markSidebarThreadRead(tid);
					},
					onAfterPinChange: () => void refreshChatSidebar({ skipThreadsFetch: true })
				});
				return;
			}
			const settingsBtn = e.target?.closest?.('[data-chat-sidebar-row-menu]');
			if (settingsBtn instanceof HTMLButtonElement) {
				e.preventDefault();
				e.stopPropagation();
				const tid = Number(settingsBtn.getAttribute('data-chat-row-menu-thread-id'));
				const sid = Number(settingsBtn.getAttribute('data-chat-server-settings'));
				const rowKind = String(settingsBtn.getAttribute('data-chat-row-menu-kind') || '').trim().toLowerCase();
				const canOpenServerDetails = Number.isFinite(sid) && sid > 0;
				const canLeaveChannel = rowKind === 'channel' && Number.isFinite(tid) && tid > 0;
				const extraItems = [];
				if (canOpenServerDetails) extraItems.push({ action: 'server-details', label: 'Server details' });
				if (canLeaveChannel) extraItems.push({ action: 'leave-channel', label: 'Leave channel' });
				openDmSidebarGearMenu(settingsBtn, {
					showProfile: false,
					showPinToggle: false,
					onMarkAsRead: () => markSidebarThreadRead(tid),
					extraItems,
					onAction: (action) => {
						if (action === 'server-details') {
							openServerDetailsFromSidebarButton(settingsBtn);
							return;
						}
						if (action === 'leave-channel') {
							void leaveChannelFromSidebar(tid);
						}
					}
				});
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
				syncChatSidebarPseudoStripActiveNow(nextUrl.pathname);
				return;
			}
			e.preventDefault();
			setMobileSidebarMode(false);
			markThreadUiPending();
			history.pushState({ prsnChat: true }, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
			syncChatSidebarPseudoStripActiveNow(nextUrl.pathname);
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
		chatSidebarNotificationsOutsideClickHandler = (e) => {
			if (!(chatSidebarNotificationsMenuEl instanceof HTMLElement)) return;
			if (chatSidebarNotificationsMenuEl.hidden) return;
			const t = e.target instanceof Element ? e.target : null;
			if (!t) return;
			if (chatSidebarNotificationsMenuEl.contains(t)) return;
			if (t.closest?.('[data-chat-sidebar-open-notifications]')) return;
			closeChatSidebarNotificationsMenu();
		};
		document.addEventListener('click', chatSidebarNotificationsOutsideClickHandler);

		chatSidebarPopstateHandler = () => {
			if (dismissChallengeVoteModalFromBrowserHistoryIfOpen()) {
				return;
			}
			if (closeChatInlineImageLightboxFromPopstateIfOpen()) {
				return;
			}
			if (shouldShowMobileSidebarFromLocation()) {
				setMobileSidebarMode(true);
				return;
			}
			void openThreadForCurrentPath();
		};
		window.addEventListener('popstate', chatSidebarPopstateHandler);
	}

	/** Plus buttons → section-specific modals (new DM, servers, channels). */
	function setupChatSidebarSectionAdds() {
		const sidebar = document.querySelector('[data-chat-sidebar]');
		if (!sidebar) return;

		chatSidebarModalsApi = initChatSidebarModals({
			getThreads: () => chatThreads || [],
			getViewerId: () => chatViewerId,
			getViewerCanCreatePrivateChannel: () => Boolean(chatViewerIsFounder || chatViewerIsAdmin),
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
		hydrateRichUserTextEmbeds(messagesEl);
		if (typeof setupReactionTooltipTap === 'function') {
			setupReactionTooltipTap(messagesEl);
		}
		updateCommentsChannelLatestMarker(messagesEl);
	}

	function buildLocalChatReplyStampFromPayload(referencedId, srcMsg) {
		const rid = Number(referencedId);
		if (!Number.isFinite(rid) || rid <= 0 || !srcMsg) return null;
		const handleRaw = srcMsg.sender_user_name != null ? String(srcMsg.sender_user_name).trim() : '';
		const sid = Number(srcMsg.sender_id);
		return {
			referenced_id: rid,
			sender_id: Number.isFinite(sid) ? sid : undefined,
			sender_user_name: handleRaw || null,
			sender_avatar_url: srcMsg.sender_avatar_url != null ? String(srcMsg.sender_avatar_url) : '',
			sender_plan: srcMsg.sender_plan === 'founder' ? 'founder' : 'free',
			preview_text: plainTextReplyPreview(String(srcMsg.body ?? ''))
		};
	}

	function messageRowSupportsReply(m) {
		if (!m || m.id == null) return false;
		const systemEventRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.system_event : null;
		const systemEvent =
			systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
				? systemEventRaw
				: null;
		const isLegacyInviteSystemLine = isChannelInviteSystemBoundaryMessage(m);
		const isChannelInviteSystemEvent =
			String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent';
		if (isChannelInviteSystemEvent || isLegacyInviteSystemLine) return false;
		if (getChatCanvasMetaFromMessage(m)) return false;
		const timedMetaRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.time_sensitive : null;
		const timedMeta =
			timedMetaRaw && typeof timedMetaRaw === 'object' && !Array.isArray(timedMetaRaw)
				? timedMetaRaw
				: null;
		if (timedMeta && String(timedMeta.kind || '').trim().toLowerCase() === 'channel_invite') {
			return false;
		}
		return true;
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
		const systemEventRaw =
			m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta) ? m.meta.system_event : null;
		const systemEvent =
			systemEventRaw && typeof systemEventRaw === 'object' && !Array.isArray(systemEventRaw)
				? systemEventRaw
				: null;
		const bodyTextRaw = String(m?.body ?? '').trim();
		const isLegacyInviteSystemLine = isChannelInviteSystemBoundaryMessage(m);
		const isChannelInviteSystemEvent =
			String(systemEvent?.kind || '').trim().toLowerCase() === 'channel_invite_sent';
		const shouldRenderAsSystemEvent = isChannelInviteSystemEvent || isLegacyInviteSystemLine;
		const prev = i > 0 ? messages[i - 1] : null;
		const isGroupContinue = shouldRenderAsSystemEvent ? false : isChatMessageGroupContinue(prev, m);
		const row = document.createElement('div');
		row.className = `connect-chat-msg${isSelf ? ' is-self' : ''}${isGroupContinue ? ' is-group-continue' : ''}${shouldRenderAsSystemEvent ? ' connect-chat-msg--system-event' : ''}`;
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
		const timedMetaRaw = m?.meta && typeof m.meta === 'object' && !Array.isArray(m.meta)
			? m.meta.time_sensitive
			: null;
		const timedMeta =
			timedMetaRaw && typeof timedMetaRaw === 'object' && !Array.isArray(timedMetaRaw)
				? timedMetaRaw
				: null;
		const safeBody = processUserText(m.body ?? '', { messageMarkdown: true });
		const bubble = document.createElement('div');
		bubble.className = 'connect-chat-msg-bubble';
		if (shouldRenderAsSystemEvent) {
			bubble.classList.add('connect-chat-msg-bubble--system-event');
			const plain = escapeHtml(String(m?.body ?? '').trim() || 'Channel update');
			bubble.innerHTML = `<div class="chat-channel-system-event-line"><span class="chat-channel-system-event-text">${plain}</span></div>`;
		} else if (canvasMeta) {
			bubble.classList.add('connect-chat-msg-bubble--canvas');
			const preview = processUserText(m.body ?? '', { messageMarkdown: true });
			bubble.innerHTML = `<div class="connect-chat-canvas-inline"><div class="connect-chat-canvas-inline-title">${escapeHtml(canvasMeta.title)}</div><div class="connect-chat-canvas-inline-preview">${preview}</div></div>`;
		} else if (
			timedMeta &&
			String(timedMeta.kind || '').trim().toLowerCase() === 'channel_invite' &&
			timedMeta?.cta &&
			typeof timedMeta.cta === 'object'
		) {
			const privateInviteMetaRaw =
				timedMeta?.private_channel_invite &&
				typeof timedMeta.private_channel_invite === 'object' &&
				!Array.isArray(timedMeta.private_channel_invite)
					? timedMeta.private_channel_invite
					: null;
			const inviteeUserId = Number(privateInviteMetaRaw?.invitee_user_id);
			const isInviteForViewer =
				Number.isFinite(inviteeUserId) && Number.isFinite(viewerId) ? inviteeUserId === Number(viewerId) : true;
			const expiresAtRaw = typeof timedMeta.expires_at === 'string' ? timedMeta.expires_at.trim() : '';
			const expMs = Date.parse(expiresAtRaw);
			const nowMs = Date.now();
			const isExpired =
				timedMeta?.expired === true || (Number.isFinite(expMs) ? nowMs > expMs : false);
			const expLabel = Number.isFinite(expMs) ? (formatRelativeTime(expiresAtRaw) || '') : '';
			const ctaLabel =
				typeof timedMeta?.cta?.label === 'string' && timedMeta.cta.label.trim()
					? timedMeta.cta.label.trim()
					: 'Accept invite';
			const inviteToken =
				typeof timedMeta?.cta?.invite_token === 'string' ? timedMeta.cta.invite_token.trim() : '';
			bubble.classList.add('connect-chat-msg-bubble--timed-invite');
			if (isExpired) bubble.classList.add('connect-chat-msg-bubble--timed-invite-expired');
			bubble.innerHTML = `
				<div class="chat-timed-message">
					<div class="chat-timed-message-title">${isExpired ? 'Invite expired' : (isInviteForViewer ? 'Private channel invite' : 'Pending Invite')}</div>
					<div class="chat-timed-message-body">${safeBody}</div>
					${expLabel ? `<div class="chat-timed-message-expiry">${isExpired ? 'Expired' : 'Expires'} ${escapeHtml(expLabel)}</div>` : ''}
					<div class="chat-timed-message-actions">
						${isExpired
							? '<span class="chat-timed-message-pending">Invite expired</span>'
							: (isInviteForViewer
								? `<button type="button" class="btn-primary chat-timed-message-cta" data-chat-timed-accept-invite="${escapeHtml(inviteToken)}">${escapeHtml(ctaLabel)}</button>`
								: '<span class="chat-timed-message-pending">Waiting for recipient</span>')}
					</div>
				</div>
			`;
		} else {
			bubble.innerHTML = safeBody;
		}
		const editedLabelEl = buildChatMessageEditedLabelElement(m);
		if (editedLabelEl) {
			bubble.appendChild(editedLabelEl);
		}
		normalizeChatBubbleInlineImageSpacing(bubble);
		if (!shouldRenderAsSystemEvent) {
			const rs = m?.meta?.reply;
			if (rs && typeof rs === 'object' && Number.isFinite(Number(rs.referenced_id))) {
				const reachable = m?.reply_parent_exists !== false;
				try {
					inner.appendChild(createReplyIndicatorElement(rs, reachable, { kind: 'chat', omitAvatar: true }));
				} catch {
					/* ignore malformed reply meta */
				}
			}
		}
		if (!isGroupContinue && !shouldRenderAsSystemEvent) {
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
		if (rowOpts.showHoverBar && !shouldRenderAsSystemEvent) {
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
			syncChatComposerReplyStripUi();
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

		syncChatComposerReplyStripUi();
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
		if (feedChannelLoadMoreFallbackCleanup) {
			feedChannelLoadMoreFallbackCleanup();
			feedChannelLoadMoreFallbackCleanup = null;
		}
		feedChannelSentinelWasIntersecting = false;
		feedChannelLoadLatchArmed = true;
		feedChannelScrollWasNearLoadEdge = false;
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
						!loadingPseudoChannelMessages &&
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
			loadingPseudoChannelMessages
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

			hydrateRichUserTextEmbeds(messagesEl);
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
		if (!messagesEl) return;
		const paneEpoch = bumpChatMessagesPaneEpoch();
		enterPseudoChannelLoad();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: 'feed',
				getItemKey: (m) => (Number.isFinite(Number(m?.id)) ? String(m.id) : ''),
				fetchPage: async ({ initial, items }) => {
					if (initial) {
						const result = await _cdComments.fetchLatestComments({ limit: COMMENTS_CHANNEL_PAGE_SIZE });
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
					const result = await _cdComments.fetchLatestComments({
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
			if (isStaleChatPane(paneEpoch)) return;
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
			if (!isStaleChatPane(paneEpoch)) {
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Could not load comments.',
					"Couldn't load comments"
				);
			}
		} finally {
			exitPseudoChannelLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'comments') {
				scrollChatFeedPseudoChannelToTop();
			}
			rebuildTopbarMenuDynamic();
		}
	}

	function setupFeedChannelVideoAutoplay(messagesEl, target) {
		if (!(messagesEl instanceof HTMLElement) || !(target instanceof HTMLElement)) return;

		if (target instanceof HTMLVideoElement) {
			if (!('IntersectionObserver' in window)) {
				const src = target.dataset.feedVideoSrc;
				if (src) {
					target.src = src;
					safeMediaPlay(target);
				}
				return;
			}
		} else if (target.dataset.feedGroupVideoPlaylist !== '1') {
			return;
		}

		if (!('IntersectionObserver' in window)) {
			if (target.dataset.feedGroupVideoPlaylist === '1') {
				const player = getFeedGroupVideoPlayer(target);
				player?.play?.();
			}
			return;
		}
		if (!feedChannelVideoObserver) {
			feedChannelVideoObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const el = entry.target;
						if (!(el instanceof HTMLElement)) continue;
						if (el instanceof HTMLVideoElement) {
							const src = el.dataset.feedVideoSrc || '';
							if (entry.isIntersecting) {
								if (!el.src && src) {
									el.src = src;
								}
								safeMediaPlay(el);
								el.classList.add('is-active');
							} else {
								try {
									el.pause();
								} catch {
									// ignore
								}
								el.classList.remove('is-active');
							}
							continue;
						}
						if (el.dataset.feedGroupVideoPlaylist !== '1') continue;
						const player = getFeedGroupVideoPlayer(el);
						if (!player) continue;
						if (entry.isIntersecting) {
							player.play();
							el.classList.add('is-active');
						} else {
							player.pause();
							el.classList.remove('is-active');
						}
					}
				},
				{ root: messagesEl, threshold: 0.5, rootMargin: '0px 0px 0px 0px' }
			);
		}
		feedChannelVideoObserver.observe(target);
	}

	function maybeLoadMoreActiveFeedLanePseudoChannel() {
		if (
			!pseudoColumnPager ||
			!pseudoColumnPager.getHasMore() ||
			pseudoColumnPager.isOlderBusy() ||
			loadingPseudoChannelMessages
		) {
			return;
		}
		if (activePseudoChannelSlug === 'feed') {
			void loadMoreFeedChannelMessages();
		} else if (activePseudoChannelSlug === 'explore') {
			void loadMoreExploreChannelMessages();
		} else if (activePseudoChannelSlug === 'creations') {
			void loadMoreCreationsChannelMessages();
		}
	}

	/** Browse lanes keep the load sentinel at the bottom (newest at top). */
	function feedChannelLoadSentinelAtBottom() {
		const slug = activePseudoChannelSlug;
		return (
			slug === 'feed' ||
			slug === 'explore' ||
			slug === 'creations' ||
			slug === 'comments' ||
			slug === 'challenges' ||
			chatFeedLaneScrollMode === 'newest_first'
		);
	}

	function feedChannelVisualViewportHeightPx() {
		const vv = window.visualViewport;
		if (vv && typeof vv.height === 'number' && Number.isFinite(vv.height) && vv.height > 0) {
			return Math.round(vv.height);
		}
		if (typeof window.innerHeight === 'number' && Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
			return Math.round(window.innerHeight);
		}
		return Math.round(document.documentElement?.clientHeight || 0);
	}

	function feedChannelScrollViewportBottomPx() {
		const vv = window.visualViewport;
		if (vv && typeof vv.height === 'number' && Number.isFinite(vv.height) && typeof vv.offsetTop === 'number') {
			return vv.offsetTop + vv.height;
		}
		return feedChannelVisualViewportHeightPx();
	}

	function getFeedChannelScrollContainer(messagesEl) {
		if (feedChannelMessagesUseDocumentScroll(messagesEl)) {
			const el = document.scrollingElement || document.documentElement;
			return el instanceof Element ? el : document.documentElement;
		}
		return messagesEl instanceof HTMLElement ? messagesEl : document.documentElement;
	}

	/** True when `html` scrolls the lane (`overflow: visible` on messages); false when `[data-chat-messages]` scrolls. */
	function feedChannelMessagesUseDocumentScroll(messagesEl) {
		if (!shouldUseViewportScrollForChatMessages()) return false;
		if (!(messagesEl instanceof HTMLElement)) return false;
		try {
			const oy = getComputedStyle(messagesEl).overflowY;
			return oy === 'visible' || oy === 'clip';
		} catch {
			return true;
		}
	}

	function getFeedChannelIntersectionRoot(messagesEl) {
		if (feedChannelMessagesUseDocumentScroll(messagesEl)) return null;
		return messagesEl instanceof HTMLElement ? messagesEl : null;
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	function getFeedLaneFeedCards(messagesEl, laneSlug) {
		const routeWrap = messagesEl.querySelector('.chat-feed-channel-route');
		if (routeWrap instanceof HTMLElement) {
			return routeWrap.querySelectorAll(FEED_LANE_COUNTABLE_CARD_SELECTOR);
		}
		const host = resolveFeedLaneCardsHost(messagesEl, laneSlug);
		if (host instanceof HTMLElement) {
			return host.querySelectorAll(FEED_LANE_COUNTABLE_CARD_SELECTOR);
		}
		return messagesEl.querySelectorAll(FEED_LANE_COUNTABLE_CARD_SELECTOR);
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 * @returns {HTMLElement | null}
	 */
	function getFeedLanePreloadTriggerCard(messagesEl, laneSlug) {
		const cards = getFeedLaneFeedCards(messagesEl, laneSlug);
		const n = cards.length;
		if (n === 0) return null;
		/*
		 * When fewer than FEED_LANE_PRELOAD_CARDS_FROM_END cards exist, `n - 5` clamps to 0
		 * (top/newest card). Preload must track the bottom/older edge instead.
		 */
		const idx =
			n <= FEED_LANE_PRELOAD_CARDS_FROM_END
				? n - 1
				: n - FEED_LANE_PRELOAD_CARDS_FROM_END;
		const el = cards[idx];
		return el instanceof HTMLElement ? el : null;
	}

	function feedLaneUsesCardPreloadTrigger(laneSlug) {
		return laneSlug === 'feed' || laneSlug === 'explore' || laneSlug === 'creations';
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	function isFeedLanePreloadTriggerReached(messagesEl, laneSlug) {
		const trigger = getFeedLanePreloadTriggerCard(messagesEl, laneSlug);
		if (!trigger) return false;
		const margin = feedChannelViewportLoadMarginPx(messagesEl);
		return trigger.getBoundingClientRect().top <= getFeedChannelScrollportBottomPx(messagesEl) + margin;
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @returns {HTMLElement | null}
	 */
	function resolveFeedChannelLoadMoreObserveTarget(messagesEl) {
		const slug = activePseudoChannelSlug;
		if (feedLaneUsesCardPreloadTrigger(slug)) {
			const trigger = getFeedLanePreloadTriggerCard(messagesEl, slug);
			if (trigger) return trigger;
		}
		const sentinel = messagesEl.querySelector('[data-chat-feed-load-sentinel]');
		return sentinel instanceof HTMLElement ? sentinel : null;
	}

	/**
	 * Fallback pixel band when there are no countable cards yet.
	 * @param {HTMLElement} [messagesEl]
	 */
	function feedChannelViewportLoadMarginPx(messagesEl) {
		let margin = 0;
		if (activePseudoChannelSlug === 'feed') {
			margin = 1200;
		} else if (
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'comments' ||
			activePseudoChannelSlug === 'challenges'
		) {
			margin = 1200;
		}
		const host =
			messagesEl instanceof HTMLElement
				? messagesEl
				: root.querySelector('[data-chat-messages]');
		if (margin > 0 && host instanceof HTMLElement) {
			const paneH = feedChannelMessagesUseDocumentScroll(host)
				? feedChannelVisualViewportHeightPx()
				: host.clientHeight;
			if (paneH > 0) margin = Math.max(margin, Math.round(paneH * 0.75));
		}
		return margin;
	}

	function feedChannelObserverRootMargin(messagesEl) {
		const px = String(feedChannelViewportLoadMarginPx(messagesEl));
		if (feedChannelLoadSentinelAtBottom()) {
			return `0px 0px ${px}px 0px`;
		}
		return `${px}px 0px 0px 0px`;
	}

	function getFeedChannelScrollportBottomPx(messagesEl) {
		if (feedChannelMessagesUseDocumentScroll(messagesEl)) {
			return feedChannelScrollViewportBottomPx();
		}
		if (messagesEl instanceof HTMLElement) {
			return messagesEl.getBoundingClientRect().bottom;
		}
		return feedChannelScrollViewportBottomPx();
	}

	function getFeedChannelLoadScrollRoot(messagesEl) {
		const vv = window.visualViewport;
		const top =
			feedChannelMessagesUseDocumentScroll(messagesEl) && vv && Number.isFinite(vv.offsetTop)
				? vv.offsetTop
				: messagesEl instanceof HTMLElement
					? messagesEl.getBoundingClientRect().top
					: 0;
		return {
			kind: feedChannelMessagesUseDocumentScroll(messagesEl) ? 'viewport' : 'element',
			top,
			bottom: getFeedChannelScrollportBottomPx(messagesEl)
		};
	}

	/**
	 * Pixels from the visible load edge to the sentinel top (≤ margin ⇒ preload).
	 * @param {HTMLElement} sentinel
	 * @param {HTMLElement} messagesEl
	 */
	function feedChannelSentinelDistanceToLoadEndPx(sentinel, messagesEl) {
		return sentinel.getBoundingClientRect().top - getFeedChannelScrollportBottomPx(messagesEl);
	}

	/**
	 * @param {HTMLElement} sentinel
	 * @param {HTMLElement} [messagesEl]
	 */
	function isFeedChannelSentinelNearLoadEdge(sentinel, messagesEl) {
		if (!(sentinel instanceof HTMLElement) || !sentinel.isConnected) return false;
		const host =
			messagesEl instanceof HTMLElement
				? messagesEl
				: root.querySelector('[data-chat-messages]');
		if (!(host instanceof HTMLElement)) return false;
		const margin = feedChannelViewportLoadMarginPx(host);
		if (margin <= 0) return false;
		if (feedChannelLoadSentinelAtBottom()) {
			const slug = activePseudoChannelSlug;
			if (
				feedLaneUsesCardPreloadTrigger(slug) &&
				getFeedLaneFeedCards(host, slug).length > 0
			) {
				return isFeedLanePreloadTriggerReached(host, slug);
			}
			return feedChannelSentinelDistanceToLoadEndPx(sentinel, host) <= margin;
		}
		const scrollRoot = getFeedChannelLoadScrollRoot(host);
		const rect = sentinel.getBoundingClientRect();
		return rect.bottom >= scrollRoot.top - margin;
	}

	/**
	 * @param {HTMLElement} sentinel
	 * @param {HTMLElement} [messagesEl]
	 * @returns {boolean} whether a load was started
	 */
	function maybeLoadMoreFeedChannelIfNear(sentinel, messagesEl) {
		const host =
			messagesEl instanceof HTMLElement
				? messagesEl
				: root.querySelector('[data-chat-messages]');
		if (!(host instanceof HTMLElement) || !(sentinel instanceof HTMLElement)) return false;
		const near = isFeedChannelSentinelNearLoadEdge(sentinel, host);
		if (!near) {
			feedChannelLoadLatchArmed = true;
			feedChannelScrollWasNearLoadEdge = false;
			return false;
		}
		const enteredNearBand = !feedChannelScrollWasNearLoadEdge;
		feedChannelScrollWasNearLoadEdge = true;
		if (!enteredNearBand || !feedChannelLoadLatchArmed) return false;
		feedChannelLoadLatchArmed = false;
		maybeLoadMoreActiveFeedLanePseudoChannel();
		return true;
	}

	/**
	 * Preserve scroll when appending older feed rows (mobile viewport scroll uses `window`, not `[data-chat-messages]`).
	 * @param {HTMLElement} messagesEl
	 * @returns {{ snap: { kind: 'viewport', scrollY: number, docHeight: number } | { kind: 'element', bottom: number }, anchorEl: Element | null, anchorOffset: number, useViewport: boolean }}
	 */
	function capturePseudoFeedLaneScroll(messagesEl) {
		const useViewport = feedChannelMessagesUseDocumentScroll(messagesEl);
		const scrollEl = useViewport ? getFeedChannelScrollContainer(messagesEl) : null;
		const snap = useViewport
			? {
					kind: 'viewport',
					scrollY:
						scrollEl instanceof Element
							? scrollEl.scrollTop
							: window.scrollY,
					docHeight: document.documentElement.scrollHeight
				}
			: {
					kind: 'element',
					bottom: messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight
				};
		const scrollRoot = getFeedChannelLoadScrollRoot(messagesEl);
		let anchorEl = null;
		let anchorOffset = 0;
		const cardSelector =
			'.feed-card, .feed-card-engagement, .feed-card-tip, .feed-card-blog, .chat-feed-mobile-spotlight';
		const cards = messagesEl.querySelectorAll(cardSelector);
		for (let i = 0; i < cards.length; i += 1) {
			const card = cards[i];
			if (!(card instanceof Element)) continue;
			const r = card.getBoundingClientRect();
			if (r.bottom > scrollRoot.top + 4) {
				anchorEl = card;
				anchorOffset = r.top - scrollRoot.top;
				break;
			}
		}
		return { snap, anchorEl, anchorOffset, useViewport };
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @param {{ snap: { kind: 'viewport', scrollY: number, docHeight: number } | { kind: 'element', bottom: number }, anchorEl: Element | null, anchorOffset: number, useViewport: boolean }} captured
	 */
	function restorePseudoFeedLaneScroll(messagesEl, captured) {
		if (!captured) return;
		const { snap, anchorEl, anchorOffset, useViewport } = captured;
		const apply = () => {
			if (anchorEl instanceof Element && anchorEl.isConnected) {
				const scrollRoot = getFeedChannelLoadScrollRoot(messagesEl);
				const r = anchorEl.getBoundingClientRect();
				const delta = r.top - scrollRoot.top - anchorOffset;
				if (Number.isFinite(delta) && Math.abs(delta) > 0.25) {
					if (useViewport) {
						window.scrollBy(0, delta);
					} else {
						messagesEl.scrollTop += delta;
					}
				}
				return;
			}
			if (snap.kind === 'viewport') {
				const delta = document.documentElement.scrollHeight - snap.docHeight;
				const scrollEl = getFeedChannelScrollContainer(messagesEl);
				const targetTop = Math.max(0, snap.scrollY + delta);
				if (scrollEl instanceof Element) {
					scrollEl.scrollTop = targetTop;
				} else {
					window.scrollTo(0, targetTop);
				}
				return;
			}
			const targetTop = messagesEl.scrollHeight - messagesEl.clientHeight - snap.bottom;
			messagesEl.scrollTop = Math.max(0, targetTop);
		};
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
	}

	function setupFeedChannelLoadMoreScrollFallback(sentinel, messagesEl) {
		if (!(sentinel instanceof HTMLElement) || !(messagesEl instanceof HTMLElement)) return;
		let raf = 0;
		const check = () => {
			raf = 0;
			if (!sentinel.isConnected) return;
			maybeLoadMoreFeedChannelIfNear(sentinel, messagesEl);
		};
		const schedule = () => {
			if (raf) return;
			raf = window.requestAnimationFrame(check);
		};
		/* Pane scroll is the common case (desktop + mobile >768px); document scroll only ≤768 viewport-scroll. */
		messagesEl.addEventListener('scroll', schedule, { passive: true });
		const docScroll = feedChannelMessagesUseDocumentScroll(messagesEl);
		const scrollContainer = docScroll ? getFeedChannelScrollContainer(messagesEl) : null;
		if (docScroll) {
			window.addEventListener('scroll', schedule, { passive: true });
			if (scrollContainer instanceof Element) {
				scrollContainer.addEventListener('scroll', schedule, { passive: true });
			}
			if (window.visualViewport) {
				window.visualViewport.addEventListener('resize', schedule);
				window.visualViewport.addEventListener('scroll', schedule);
			}
		}
		window.addEventListener('resize', schedule);
		feedChannelLoadMoreFallbackCleanup = () => {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			messagesEl.removeEventListener('scroll', schedule);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			if (scrollContainer instanceof Element) {
				scrollContainer.removeEventListener('scroll', schedule);
			}
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', schedule);
				window.visualViewport.removeEventListener('scroll', schedule);
			}
		};
		schedule();
	}

	function setupFeedChannelLoadMoreObserver(messagesEl) {
		disconnectFeedChannelLoadObserver();
		const observeTarget = resolveFeedChannelLoadMoreObserveTarget(messagesEl);
		if (!(observeTarget instanceof HTMLElement)) return;
		feedChannelSentinelWasIntersecting = false;
		const observerRoot = getFeedChannelIntersectionRoot(messagesEl);
		feedChannelLoadMoreObserver = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.target !== observeTarget) continue;
					const wasIntersecting = feedChannelSentinelWasIntersecting;
					const nowIntersecting = e.isIntersecting;
					feedChannelSentinelWasIntersecting = nowIntersecting;
					if (!nowIntersecting) {
						feedChannelLoadLatchArmed = true;
						continue;
					}
					if (wasIntersecting || !feedChannelLoadLatchArmed) continue;
					if (
						!pseudoColumnPager ||
						!pseudoColumnPager.getHasMore() ||
						pseudoColumnPager.isOlderBusy() ||
						loadingPseudoChannelMessages ||
						(activePseudoChannelSlug !== 'feed' &&
							activePseudoChannelSlug !== 'explore' &&
							activePseudoChannelSlug !== 'creations')
					) {
						continue;
					}
					feedChannelLoadLatchArmed = false;
					maybeLoadMoreActiveFeedLanePseudoChannel();
				}
			},
			{
				root: observerRoot,
				rootMargin: feedChannelObserverRootMargin(messagesEl),
				threshold: 0,
			}
		);
		feedChannelLoadMoreObserver.observe(observeTarget);
		const sentinel = messagesEl.querySelector('[data-chat-feed-load-sentinel]');
		if (sentinel instanceof HTMLElement) {
			setupFeedChannelLoadMoreScrollFallback(sentinel, messagesEl);
		}
		nudgeFeedChannelLoadMoreIfStillNear(messagesEl);
	}

	/**
	 * After append the preload trigger card moves; if the reader is still in the preload band,
	 * re-check once layout settles so the next page can load without scrolling away and back.
	 * @param {HTMLElement} messagesEl
	 */
	function nudgeFeedChannelLoadMoreIfStillNear(messagesEl) {
		if (!(messagesEl instanceof HTMLElement)) return;
		const runCheck = () => {
			if (
				!pseudoColumnPager?.getHasMore() ||
				pseudoColumnPager.isOlderBusy() ||
				loadingPseudoChannelMessages
			) {
				return;
			}
			const slug = activePseudoChannelSlug;
			if (slug !== 'feed' && slug !== 'explore' && slug !== 'creations') return;
			const sentinel = messagesEl.querySelector('[data-chat-feed-load-sentinel]');
			if (!(sentinel instanceof HTMLElement)) return;
			if (!isFeedChannelSentinelNearLoadEdge(sentinel, messagesEl)) return;
			feedChannelLoadLatchArmed = true;
			feedChannelScrollWasNearLoadEdge = false;
			feedChannelSentinelWasIntersecting = false;
			maybeLoadMoreFeedChannelIfNear(sentinel, messagesEl);
		};
		requestAnimationFrame(() => {
			requestAnimationFrame(runCheck);
		});
	}

	function refreshFeedChannelLoadMoreAfterAppend(messagesEl) {
		if (!(messagesEl instanceof HTMLElement)) return;
		if (!pseudoColumnPager?.getHasMore()) {
			disconnectFeedChannelLoadObserver();
			return;
		}
		setupFeedChannelLoadMoreObserver(messagesEl);
		feedChannelLoadLatchArmed = true;
		feedChannelScrollWasNearLoadEdge = false;
		feedChannelSentinelWasIntersecting = false;
		nudgeFeedChannelLoadMoreIfStillNear(messagesEl);
	}

	/**
	 * @param {HTMLElement} messagesEl
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 * @returns {HTMLElement | null}
	 */
	function resolveFeedLaneCardsHost(messagesEl, laneSlug) {
		const routeWrap = messagesEl.querySelector('.chat-feed-channel-route');
		if (laneSlug === 'feed' && shouldChatFeedUseMobileAlternatingLayout()) {
			if (!(routeWrap instanceof HTMLElement)) return null;
			const cards =
				routeWrap.querySelector('[data-feed-channel-cards-tail]') ||
				routeWrap.querySelector('[data-feed-channel-cards]');
			return cards instanceof HTMLElement ? cards : null;
		}
		const cards =
			messagesEl.querySelector('[data-feed-channel-cards-tail]') ||
			messagesEl.querySelector('[data-feed-channel-cards]');
		return cards instanceof HTMLElement ? cards : null;
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
		if (loadingPseudoChannelMessages) return;
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
			loadingPseudoChannelMessages
		) {
			return;
		}
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!(messagesEl instanceof HTMLElement)) return;
		const cards = resolveFeedLaneCardsHost(messagesEl, laneSlug);
		if (!cards) return;
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
		if (!isNewestFirstBrowseLane(laneSlug) && anchor) {
			anchorTopBefore =
				anchor.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top;
		}

		mountChatFeedLoadMoreSkeleton(cards);
		try {
			const r = await pseudoColumnPager.loadOlder();
			if (!r.ok) {
				return;
			}
			const mergedFiltered =
				isNewestFirstBrowseLane(laneSlug)
					? Array.isArray(r.appended) ? r.appended : []
					: Array.isArray(r.prepended) ? r.prepended : [];
			if (mergedFiltered.length === 0) {
				refreshFeedChannelLoadMoreAfterAppend(messagesEl);
				return;
			}
			addPageUsers(mergedFiltered.map(feedItemToUser));

			if (isNewestFirstBrowseLane(laneSlug)) {
				const scrollSnap = capturePseudoFeedLaneScroll(messagesEl);
				const idxBase = cards.children.length;
				/*
				 * Mobile `#feed`: page 1 is spotlight segments + cards; load-more is always plain
				 * cards in the tail host (same as desktop append — no re-partitioning).
				 */
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
				restorePseudoFeedLaneScroll(messagesEl, scrollSnap);
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

			refreshFeedChannelLoadMoreAfterAppend(messagesEl);

			if (!isNewestFirstBrowseLane(laneSlug)) {
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
		} finally {
			removeChatFeedLoadMoreSkeleton(cards);
		}
	}

	async function loadMoreFeedChannelMessages() {
		await loadMoreFeedLanePseudoChannelMessages('feed');
	}

	async function loadMoreCreationsChannelMessages() {
		await loadMoreFeedLanePseudoChannelMessages('creations');
	}

	function shouldChatFeedUseMobileAlternatingLayout() {
		return isChatPageMobileLayout();
	}

	function createFeedChannelCardRenderer(messagesElHost) {
		return (item, i) => {
			if (isChatFeedChallengePlaceholder(item)) {
				return createChatFeedChallengePlaceholderElement();
			}
			return createFeedItemCard(
				item,
				i,
				feedCardOptionsForPseudoLane(
					(el) => setupFeedChannelVideoAutoplay(messagesElHost, el),
					'feed'
				)
			);
		};
	}

	async function loadFeedChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const paneEpoch = bumpChatMessagesPaneEpoch();
		enterPseudoChannelLoad();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			if (isStaleChatPane(paneEpoch)) return;

			const useMobileFeedLayout = shouldChatFeedUseMobileAlternatingLayout();
			pseudoColumnPager = createPseudoColumnPager({
				columnOrder: feedLanePagerColumnOrder(),
				getItemKey: getChatFeedItemKey,
				fetchPage: createChatFeedFetchPage({
					fetchJsonWithStatusDeduped,
					getHiddenFeedItems,
					pageSize: FEED_CHANNEL_PAGE_SIZE,
					/* API slot-pack on page 1 only; load-more uses plain feed + cursor. Layout partition is initial-only below. */
					mobileChatSlotPack: useMobileFeedLayout
				})
			});
			const r = await pseudoColumnPager.loadInitial();
			if (isStaleChatPane(paneEpoch)) return;
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
				if (isNewestFirstBrowseLane('feed')) {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const renderFeedCard = createFeedChannelCardRenderer(messagesEl);
			/** @type {{ routeWrap: HTMLDivElement, sentinel: HTMLDivElement }} */
			let routeResult;
			if (shouldChatFeedUseMobileAlternatingLayout()) {
				routeResult = createChatFeedChannelElementsFromSegments(
					partitionChatFeedMobileAlternating(ordered, { reserveChallengeSlot: true }).segments,
					renderFeedCard,
					feedChannelMobileSpotlightOptions
				);
			} else {
				/* Desktop: full cards in API order (standard feed; slot-pack is mobile-only). */
				routeResult = createChatFeedChannelElementsFromSegments(
					[{ type: 'cards', items: ordered }],
					renderFeedCard,
					feedChannelMobileSpotlightOptions
				);
			}
			const { routeWrap, sentinel } = routeResult;
			applyExploreCreationsBrowseViewClass(routeWrap, 'feed');
			if (isNewestFirstBrowseLane('feed')) {
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
			void loadDeferredChatFeedChallenge({
				messagesEl,
				routeWrap,
				mobileLayout: useMobileFeedLayout,
				fetchJson: fetchJsonWithStatusDeduped,
				renderCard: renderFeedCard,
				isStale: () => isStaleChatPane(paneEpoch)
			});
		} catch (err) {
			console.error('[Chat page] feed channel:', err);
			if (!isStaleChatPane(paneEpoch)) {
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Could not load the feed.',
					"Couldn't load your feed"
				);
			}
		} finally {
			exitPseudoChannelLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'feed') {
				scrollChatFeedPseudoChannelToTop();
			}
			rebuildTopbarMenuDynamic();
		}
	}

	/**
	 * Grid browse UI applies only to `#explore` / `#creations`. `#feed` stays a vertical list of full cards (same as before browse mode existed).
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	function applyExploreCreationsBrowseViewClass(routeWrap, laneSlug) {
		if (!(routeWrap instanceof HTMLElement)) return;
		const browseLane = laneSlug === 'explore' || laneSlug === 'creations';
		if (browseLane) {
			routeWrap.dataset.chatExploreCreationsLane = '1';
		} else {
			delete routeWrap.dataset.chatExploreCreationsLane;
		}
		const useBrowseGrid =
			chatExploreCreationsBrowseView && browseLane;
		routeWrap.classList.toggle('chat-feed-channel-route--browse-view', useBrowseGrid);
	}

	function renderChatExploreSearchBarMarkup(options = {}) {
		const committed = escapeHtml(String(exploreQueryRef.q || '').trim());
		const loading = options.loading === true;
		return `
		<div class="chat-explore-search-bar" data-chat-explore-search-bar aria-hidden="false">
			<div class="chat-explore-search-bar-inner">
				<div class="chat-explore-search-input-wrap">
					<input type="search" class="chat-explore-search-input" data-chat-explore-search-input
						placeholder="Search creations..." aria-label="Search creations" value="${committed}"${loading ? ' disabled' : ''} />
					<button type="button" class="chat-explore-search-clear" data-chat-explore-search-clear
						aria-label="Clear search" ${committed ? '' : 'hidden'}${loading ? ' disabled' : ''}>×</button>
				</div>
				<div class="chat-explore-search-actions">
					<button type="button" class="chat-explore-search-submit${loading ? ' is-loading' : ''}" data-chat-explore-search-submit aria-label="${loading ? 'Searching...' : 'Search creations'}"${loading ? ' disabled' : ''}>
						<svg class="chat-explore-search-submit-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
							fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
							stroke-linejoin="round" aria-hidden="true"${loading ? ' hidden' : ''}>
							<circle cx="11" cy="11" r="8" />
							<path d="m21 21-4.3-4.3" />
						</svg>
						<span class="chat-explore-search-submit-spinner" aria-hidden="true"${loading ? '' : ' hidden'}></span>
					</button>
				</div>
			</div>
		</div>`;
	}

	function insertChatExploreSearchChrome(routeWrap, cardsEl) {
		if (!(routeWrap instanceof HTMLElement)) return;
		if (routeWrap.querySelector('[data-chat-explore-search-bar]')) return;
		const shell = document.createElement('div');
		shell.innerHTML = renderChatExploreSearchBarMarkup();
		const bar = shell.querySelector('[data-chat-explore-search-bar]');
		if (!(bar instanceof HTMLElement)) return;
		if (cardsEl instanceof HTMLElement) {
			routeWrap.insertBefore(bar, cardsEl);
		} else {
			routeWrap.prepend(bar);
		}
	}

	function syncChatExploreSearchBar(routeWrap) {
		if (!(routeWrap instanceof HTMLElement)) return;
		const bar = routeWrap.querySelector('[data-chat-explore-search-bar]');
		const input = routeWrap.querySelector('[data-chat-explore-search-input]');
		const clear = routeWrap.querySelector('[data-chat-explore-search-clear]');
		const submit = routeWrap.querySelector('[data-chat-explore-search-submit]');
		const submitIcon = routeWrap.querySelector('.chat-explore-search-submit-icon');
		const submitSpinner = routeWrap.querySelector('.chat-explore-search-submit-spinner');
		if (bar instanceof HTMLElement) {
			bar.setAttribute('aria-hidden', 'false');
		}
		if (input instanceof HTMLInputElement && document.activeElement !== input) {
			input.value = String(exploreQueryRef.q || '').trim();
		}
		if (input instanceof HTMLInputElement) {
			input.disabled = isExploreComposerLoadLocked();
		}
		if (clear instanceof HTMLButtonElement) {
			const value = input instanceof HTMLInputElement
				? String(input.value || '').trim()
				: String(exploreQueryRef.q || '').trim();
			clear.hidden = value.length === 0;
			clear.disabled = isExploreComposerLoadLocked();
		}
		if (submit instanceof HTMLButtonElement) {
			submit.disabled = isExploreComposerLoadLocked();
			submit.setAttribute('aria-label', exploreChannelSearchLoading ? 'Searching...' : 'Search creations');
			submit.classList.toggle('is-loading', exploreChannelSearchLoading);
		}
		if (submitIcon instanceof HTMLElement) {
			submitIcon.hidden = exploreChannelSearchLoading;
		}
		if (submitSpinner instanceof HTMLElement) {
			submitSpinner.hidden = !exploreChannelSearchLoading;
		}
	}

	function syncActiveChatExploreSearchBar() {
		const routeWrap = root.querySelector('[data-chat-messages] [data-chat-explore-creations-lane="1"]');
		if (routeWrap instanceof HTMLElement) {
			syncChatExploreSearchBar(routeWrap);
		}
		syncChatExploreComposerChrome();
	}

	/**
	 * Feed channel: eligible video rows → doom scroll on mobile only. Desktop always uses `/creations/:id`.
	 */
	function resolveFeedLaneVideoToDoomHref(item) {
		if (!isChatPageMobileLayout()) return undefined;
		if (!isDoomEligibleFeedVideoItem(item)) return undefined;
		const cid = item.created_image_id ?? item.id;
		if (cid == null || cid === '') return undefined;
		return `/chat/c/feed/doom/${encodeURIComponent(String(cid))}`;
	}

	/**
	 * Runs synchronously from Spotlight tap → doom (SPA navigation); clears muted pref for autoplay.
	 * Doom mounts after awaits, so this cannot carry browser user activation to video.play(); it does:
	 * - Clear sticky muted preference from a prior failed unmuted autoplay (`chatDoomPreferMuted`).
	 * - Best-effort AudioContext.resume() while still on the click stack (helps some policies; no-op otherwise).
	 */
	function primeChatDoomPlaybackFromNavigationGesture() {
		try {
			sessionStorage.setItem('chatDoomPreferMuted', '0');
		} catch {
			// ignore
		}
		try {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (typeof AC !== 'function') return;
			const ctx = new AC();
			const r = ctx.resume();
			if (r && typeof r.finally === 'function') {
				r.finally(() => {
					try {
						ctx.close();
					} catch {
						// ignore
					}
				});
			} else {
				try {
					ctx.close();
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}
	}

	/** Same-origin URLs handled by chat: pushState then openThreadForCurrentPath; otherwise full navigation. */
	function navigateWithinChatShell(href, ev) {
		if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
		let url;
		try {
			url = new URL(href, window.location.href);
		} catch {
			window.location.assign(href);
			return;
		}
		if (url.origin !== window.location.origin) {
			window.location.assign(url.href);
			return;
		}
		const parsed = parseChatPathname(url.pathname);
		const spaKinds = new Set(['thread', 'channel', 'doom_scroll', 'dm']);
		if (!spaKinds.has(parsed.kind)) {
			window.location.assign(url.pathname + url.search + url.hash);
			return;
		}
		if (parsed.kind === 'doom_scroll' && !isChatPageMobileLayout()) {
			window.location.assign(`/creations/${encodeURIComponent(String(parsed.startCreationId))}`);
			return;
		}
		if (parsed.kind === 'doom_scroll') {
			primeChatDoomPlaybackFromNavigationGesture();
		}
		history.pushState({ prsnChat: true }, '', url.pathname + url.search + url.hash);
		void openThreadForCurrentPath();
	}

	const feedChannelMobileSpotlightOptions = {
		resolveSpotlightHref: resolveFeedLaneVideoToDoomHref,
		performSpotlightNavigation: navigateWithinChatShell,
	};

	/**
	 * @param {(el: HTMLVideoElement) => void} setupFeedVideo
	 * @param {'feed' | 'explore' | 'creations'} laneSlug
	 */
	function feedCardOptionsForPseudoLane(setupFeedVideo, laneSlug) {
		const hide =
			chatExploreCreationsBrowseView && (laneSlug === 'explore' || laneSlug === 'creations');
		const base = {
			setupFeedVideo,
			hideFeedCardMetadata: hide,
			preferThumbnail: laneSlug === 'explore' || laneSlug === 'creations',
			creationsBulkChrome: laneSlug === 'creations',
			enableComposerDragSource:
				laneSlug === 'feed' || laneSlug === 'explore' || laneSlug === 'creations',
			performShellNavigation: navigateWithinChatShell,
		};
		if (laneSlug === 'feed') {
			return {
				...base,
				resolveCreationCardHref: resolveFeedLaneVideoToDoomHref,
				performCreationNavigation: navigateWithinChatShell
			};
		}
		return base;
	}

	function insertChatCreationsPseudoBulkChrome(routeWrap, cardsEl) {
		if (!(routeWrap instanceof HTMLElement) || !(cardsEl instanceof HTMLElement)) return;
		const shell = document.createElement('div');
		shell.innerHTML = `
		<div class="creations-bulk-bar" data-creations-bulk-bar aria-hidden="true">
			<div class="creations-bulk-bar-inner">
				<span class="creations-bulk-bar-label">Bulk</span>
				<div class="creations-bulk-actions">
					<button type="button" class="btn-secondary creations-bulk-queue-btn" data-creations-bulk-queue disabled>Queue</button>
					<button type="button" class="btn-secondary creations-bulk-group-btn" data-creations-bulk-group disabled>Group</button>
					<button type="button" class="btn-secondary creations-bulk-delete-btn" data-creations-bulk-delete disabled>Delete</button>
				</div>
				<button type="button" class="modal-close creations-bulk-bar-close" data-creations-bulk-close aria-label="Close bulk actions">
					<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
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
			if (typeof h._exitChatCreationsBulk === 'function') {
				try {
					h._exitChatCreationsBulk();
				} catch {
					// ignore
				}
			}
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

		const bar = routeWrap.querySelector('[data-creations-bulk-bar]');
		const bulkClose = routeWrap.querySelector('[data-creations-bulk-close]');
		const bulkDelete = routeWrap.querySelector('[data-creations-bulk-delete]');
		const bulkQueue = routeWrap.querySelector('[data-creations-bulk-queue]');
		const bulkGroup = routeWrap.querySelector('[data-creations-bulk-group]');
		const modalOverlay = routeWrap.querySelector('[data-creations-bulk-delete-modal]');
		const modalCancel = routeWrap.querySelector('[data-creations-bulk-delete-cancel]');
		const modalConfirm = routeWrap.querySelector('[data-creations-bulk-delete-confirm]');

		function queryBulkCards() {
			return Array.from(routeWrap.querySelectorAll('.feed-card[data-image-id]'));
		}

		function updateBulkBarSelection() {
			const deleteBtn = routeWrap.querySelector('[data-creations-bulk-delete]');
			const queueBtn = routeWrap.querySelector('[data-creations-bulk-queue]');
			const groupBtn = routeWrap.querySelector('[data-creations-bulk-group]');
			if (!bar || !deleteBtn) return;
			const selectedCards = queryBulkCards().filter((card) =>
				card.querySelector('[data-creations-bulk-checkbox]:checked')
			);
			const checked = selectedCards.length;
			const hasSelection = checked > 0;
			const queueableCards = hasSelection
				? selectedCards.filter((card) => {
					const url = (card.dataset.imageUrl || '').trim();
					return url;
				})
				: [];
			const eligibleCards = selectedCards.filter((card) => {
				const isPublished = card.dataset.published === '1';
				const mediaType = (card.dataset.mediaType || 'image').toLowerCase();
				const creationStatus = (card.dataset.creationStatus || '').toLowerCase();
				return !isPublished && (mediaType === 'image' || mediaType === 'video') && creationStatus === 'completed';
			});
			const selectedMediaTypes = new Set(
				selectedCards.map((card) => (card.dataset.mediaType || 'image').toLowerCase())
			);
			const homogeneousMedia = selectedMediaTypes.size <= 1;
			const selectedGroups = selectedCards.filter((card) => card.dataset.groupCreation === '1');
			let canGroup = false;
			if (selectedCards.length > 0 && eligibleCards.length === selectedCards.length && homogeneousMedia && selectedGroups.length <= 1) {
				if (selectedGroups.length === 0) {
					canGroup = selectedCards.length >= 2;
				} else {
					canGroup = selectedCards.length >= 2;
				}
			}
			bar.classList.toggle('has-selection', hasSelection);
			deleteBtn.disabled = !hasSelection;
			if (queueBtn) queueBtn.disabled = queueableCards.length === 0;
			if (groupBtn) groupBtn.disabled = !canGroup;
		}

		function exitBulkMode() {
			closeBulkDeleteModal();
			routeWrap.classList.remove('is-bulk-mode');
			if (bar) bar.setAttribute('aria-hidden', 'true');
			for (const c of queryBulkCards()) {
				const cb = c.querySelector('[data-creations-bulk-checkbox]');
				if (cb instanceof HTMLInputElement) cb.checked = false;
			}
			updateBulkBarSelection();
		}

		function enterBulkMode() {
			closeBulkDeleteModal();
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
		let suppressCardClickUntil = 0;

		bindMobileCreationsBulkLongPress({
			container: cards,
			cardSelector: '.feed-card[data-image-id]',
			isEnabled: () => isChatPageMobileLayout(),
			isBulkActive: () => routeWrap.classList.contains('is-bulk-mode'),
			onLongPress: (card) => {
				closeMobileChromeSheet();
				closeTopbarMenu();
				enterBulkMode();
				const cb = card.querySelector('[data-creations-bulk-checkbox]');
				if (cb instanceof HTMLInputElement) cb.checked = true;
				updateBulkBarSelection();
				suppressCardClickUntil = Date.now() + 900;
			},
			signal: capAc.signal
		});

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
		if (bulkGroup) {
			bulkGroup.addEventListener(
				'click',
				(e) => {
					e.preventDefault();
					void bulkGroupSelected();
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

		async function bulkGroupSelected() {
			const selected = queryBulkCards().filter((card) =>
				card.querySelector('[data-creations-bulk-checkbox]:checked')
			);
			if (selected.length < 2) return;
			const invalidCount = selected.filter((card) => {
				const isPublished = card.dataset.published === '1';
				const mediaType = (card.dataset.mediaType || 'image').toLowerCase();
				const creationStatus = (card.dataset.creationStatus || '').toLowerCase();
				return isPublished || (mediaType !== 'image' && mediaType !== 'video') || creationStatus !== 'completed';
			}).length;
			const mediaTypes = new Set(
				selected.map((card) => (card.dataset.mediaType || 'image').toLowerCase())
			);
			if (invalidCount > 0) {
				alert('Group Creations supports only completed, unpublished image or video creations.');
				return;
			}
			if (mediaTypes.size > 1) {
				alert('Cannot mix image and video creations in one group.');
				return;
			}
			const selectedGroups = selected.filter((card) => card.dataset.groupCreation === '1');
			if (selectedGroups.length > 1) {
				alert('Select at most one existing group when grouping creations.');
				return;
			}
			const ids = selected
				.map((card) => Number(card.dataset.imageId))
				.filter((id) => Number.isFinite(id) && id > 0);
			if (ids.length < 2) return;
			const groupMediaType = [...mediaTypes][0] || 'image';
			const groupMediaNoun = groupMediaType === 'video' ? 'video' : 'image';
			const confirmMsg = selectedGroups.length === 1
				? `Add ${ids.length - 1} ${groupMediaNoun}${ids.length - 1 === 1 ? '' : 's'} to the selected group?`
				: `Group ${ids.length} creations into a single creation?`;
			if (!window.confirm(confirmMsg)) return;
			if (!(bulkGroup instanceof HTMLButtonElement)) return;
			bulkGroup.disabled = true;
			let errMsg = '';
			try {
				const res = await fetch('/api/create/images/group', {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ids })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					errMsg = data?.error || 'Failed to group creations';
					alert(errMsg);
					return;
				}
				await loadCreationsChannelMessages({ forceFreshFirstPage: true });
				exitBulkMode();
			} catch (err) {
				errMsg = err?.message || 'Failed to group creations';
				alert(errMsg);
			} finally {
				if (bulkGroup.isConnected) {
					updateBulkBarSelection();
				}
			}
		}
	}

	let chatCreationsNavigateDetail = null;

	async function loadCreationsChannelMessages(options = {}) {
		const navOpts =
			options.forceFreshFirstPage != null
				? options
				: chatCreationsNavigateDetail && typeof chatCreationsNavigateDetail === 'object'
					? chatCreationsNavigateDetail
					: {};
		const forceFreshFirstPage = navOpts.forceFreshFirstPage === true;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		stopChatCreationsPseudoChannelPoll();
		const viewerId = chatViewerId;
		if (!Number.isFinite(Number(viewerId)) || Number(viewerId) <= 0) {
			paintChatMessagesPaneError(
				messagesEl,
				'Sign in to see your creations here.',
				'Sign in required',
				{ buttonText: 'Sign in', buttonHref: '/auth' }
			);
			stopChatCreationsPseudoChannelPoll();
			rebuildTopbarMenuDynamic();
			return;
		}
		const paneEpoch = bumpChatMessagesPaneEpoch();
		enterPseudoChannelLoad();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			if (isStaleChatPane(paneEpoch)) return;

			const creationsAuthorHints = await resolveCreationsChannelAuthorHints();
			if (isStaleChatPane(paneEpoch)) return;

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
			if (isStaleChatPane(paneEpoch)) return;
			if (!r.ok) {
				if (r.error instanceof Error) {
					throw r.error;
				}
				throw new Error(typeof r.reason === 'string' ? r.reason : 'Failed to load creations');
			}
			let ordered = pseudoColumnPager.getItems();
			ordered = creationsPollMod.mergeSessionPendingIntoFeedItems(ordered, (p) =>
				mapPendingCreationToFeedItem(p, viewerId, creationsAuthorHints)
			);
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
				if (isNewestFirstBrowseLane('creations')) {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const routeWrap = document.createElement('div');
			routeWrap.className = 'feed-route chat-feed-channel-route creations-route';
			routeWrap.dataset.chatCreationsBulkHost = '1';
			applyExploreCreationsBrowseViewClass(routeWrap, 'creations');
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
			if (isStaleChatPane(paneEpoch)) return;

			const sentinel = document.createElement('div');
			sentinel.dataset.chatFeedLoadSentinel = '1';
			sentinel.className = 'chat-page-feed-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			if (isNewestFirstBrowseLane('creations')) {
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
			if (!isStaleChatPane(paneEpoch)) {
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Could not load your creations.',
					"Couldn't load creations"
				);
			}
		} finally {
			exitPseudoChannelLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			// Hard-enforce top anchoring for browse lanes after all unlock/layout work.
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'creations') {
				scrollChatFeedPseudoChannelToTop();
			}
			rebuildTopbarMenuDynamic();
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'creations') {
				maybeStartChatCreationsPseudoChannelPoll();
			}
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

	async function fetchExploreSearchListForChat(kind, trimmed) {
		const q = encodeURIComponent(trimmed);
		const url = kind === 'semantic'
			? `/api/explore/search/semantic?q=${q}&limit=${EXPLORE_SEARCH_FETCH_LIMIT}`
			: `/api/explore/search?q=${q}&limit=${EXPLORE_SEARCH_FETCH_LIMIT}`;
		try {
			const r = await fetch(url, { credentials: 'include' });
			const data = await r.json().catch(() => null);
			return { ok: r.ok, items: r.ok && Array.isArray(data?.items) ? data.items : [] };
		} catch {
			return { ok: false, items: [] };
		}
	}

	async function loadExploreChannelMessages(options = {}) {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl) return;
		const explicitSearchQuery =
			typeof options.searchQuery === 'string' ? options.searchQuery.trim() : null;
		const qActive = explicitSearchQuery != null
			? explicitSearchQuery
			: String(exploreQueryRef.q || '').trim();
		if (qActive) {
			exploreQueryRef.q = qActive;
		}
		const paneEpoch = bumpChatMessagesPaneEpoch();
		enterPseudoChannelLoad();
		exploreBrowseMessagesLoading = true;
		syncActiveChatExploreSearchBar();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();
		messagesEl.setAttribute('aria-busy', 'true');
		try {
			if (isStaleChatPane(paneEpoch)) return;

			if (qActive) {
				pseudoColumnPager = null;
				disconnectFeedChannelLoadObserver();
				exploreChannelSearchLoading = true;
				syncActiveChatExploreSearchBar();
				const searchGridInner =
					chatExploreCreationsBrowseView && typeof renderGridSkeleton === 'function'
						? renderGridSkeleton(25)
						: typeof renderFeedCardsSkeleton === 'function'
							? renderFeedCardsSkeleton(4)
							: '';
				if (searchGridInner) {
					messagesEl.innerHTML = `<div class="feed-route chat-feed-channel-route${chatExploreCreationsBrowseView ? ' chat-feed-channel-route--browse-view' : ''}">
						${renderChatExploreSearchBarMarkup({ loading: true })}
						<div class="route-cards feed-cards" aria-busy="true" aria-label="Searching">${searchGridInner}</div>
					</div>`;
					resetAndLockChatMessagesScrollForSkeleton(messagesEl, 'explore');
				}
				let keywordItems = [];
				let semanticItems = [];
				let keywordSettled = false;
				let semanticSettled = false;
				let firstList = '';
				let hasRenderedSearchResults = false;
				let resolveFirstRenderable;
				const firstRenderable = new Promise((resolve) => {
					resolveFirstRenderable = resolve;
				});

				const finishInitialSearchLoading = () => {
					if (hasRenderedSearchResults) return;
					hasRenderedSearchResults = true;
					exploreChannelSearchLoading = false;
					exploreBrowseMessagesLoading = false;
					if (messagesEl.isConnected) {
						messagesEl.removeAttribute('aria-busy');
					}
					unlockChatMessagesPaneScroll(messagesEl);
					syncActiveChatExploreSearchBar();
					if (typeof resolveFirstRenderable === 'function') resolveFirstRenderable();
				};

				const paintSearchItems = (items) => {
					if (isStaleChatPane(paneEpoch)) return false;
					if (activePseudoChannelSlug !== 'explore') return false;
					if (String(exploreQueryRef.q || '').trim() !== qActive) return false;
					pushExploreChannelSearchToHistory(qActive);
					lastChatMessagesPayload = [];
					clearPageUsers();
					addPageUsers(items.map(feedItemToUser));
					teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
					teardownLatestMessageReadObserver();
					messagesEl.innerHTML = '';
					const routeWrap = document.createElement('div');
					routeWrap.className = 'feed-route chat-feed-channel-route';
					applyExploreCreationsBrowseViewClass(routeWrap, 'explore');
					if (items.length === 0) {
						insertChatExploreSearchChrome(routeWrap, null);
						const empty = document.createElement('div');
						empty.innerHTML = renderEmptyState({
							className: 'route-empty-image-grid',
							title: 'No creations found',
						});
						routeWrap.append(...Array.from(empty.childNodes));
					} else {
						const cards = document.createElement('div');
						cards.className = 'route-cards feed-cards';
						cards.setAttribute('data-feed-channel-cards', '1');
						for (let i = 0; i < items.length; i++) {
							cards.appendChild(
								createFeedItemCard(
									items[i],
									i,
									feedCardOptionsForPseudoLane(
										(el) => setupFeedChannelVideoAutoplay(messagesEl, el),
										'explore'
									)
								)
							);
						}
						routeWrap.appendChild(cards);
						insertChatExploreSearchChrome(routeWrap, cards);
					}
					syncChatExploreSearchBar(routeWrap);
					messagesEl.appendChild(routeWrap);
					if (isNewestFirstBrowseLane('explore')) {
						scrollChatFeedPseudoChannelToTop();
					} else {
						scrollChatMessagesToEnd();
					}
					return true;
				};

				const renderProgressiveSearchResults = () => {
					if (
						isStaleChatPane(paneEpoch) ||
						activePseudoChannelSlug !== 'explore' ||
						String(exploreQueryRef.q || '').trim() !== qActive
					) {
						if (typeof resolveFirstRenderable === 'function') resolveFirstRenderable();
						return;
					}
					const bothSettled = keywordSettled && semanticSettled;
					let items = [];
					if (keywordItems.length > 0 && semanticItems.length > 0) {
						items = mergeExploreSearchKeywordSemantic(keywordItems, semanticItems, firstList === 'semantic');
					} else if (keywordItems.length > 0) {
						if (!firstList) firstList = 'keyword';
						items = mergeExploreSearchKeywordSemantic(keywordItems, [], false);
					} else if (semanticItems.length > 0) {
						if (!firstList) firstList = 'semantic';
						items = mergeExploreSearchKeywordSemantic([], semanticItems, true);
					} else if (bothSettled) {
						items = [];
					} else {
						return;
					}
					if (paintSearchItems(items)) {
						finishInitialSearchLoading();
					}
				};

				const handleSearchResult = (kind, res) => {
					if (kind === 'semantic') {
						semanticSettled = true;
						semanticItems = Array.isArray(res?.items) ? res.items : [];
					} else {
						keywordSettled = true;
						keywordItems = Array.isArray(res?.items) ? res.items : [];
					}
					renderProgressiveSearchResults();
				};

				fetchExploreSearchListForChat('keyword', qActive).then((res) => handleSearchResult('keyword', res));
				fetchExploreSearchListForChat('semantic', qActive).then((res) => handleSearchResult('semantic', res));
				await firstRenderable;
				return;
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
			if (isStaleChatPane(paneEpoch)) return;
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
				const routeWrap = document.createElement('div');
				routeWrap.className = 'feed-route chat-feed-channel-route';
				applyExploreCreationsBrowseViewClass(routeWrap, 'explore');
				insertChatExploreSearchChrome(routeWrap, null);
				const empty = document.createElement('div');
				empty.innerHTML = renderEmptyState({
					className: 'route-empty-image-grid',
					title: 'Nothing to explore yet',
					message: 'Published creations from the community will appear here.',
				});
				routeWrap.append(...Array.from(empty.childNodes));
				messagesEl.appendChild(routeWrap);
				syncChatExploreSearchBar(routeWrap);
				if (isNewestFirstBrowseLane('explore')) {
					scrollChatFeedPseudoChannelToTop();
				} else {
					scrollChatMessagesToEnd();
				}
				return;
			}

			const routeWrap = document.createElement('div');
			routeWrap.className = 'feed-route chat-feed-channel-route';
			applyExploreCreationsBrowseViewClass(routeWrap, 'explore');
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
			insertChatExploreSearchChrome(routeWrap, cards);
			syncChatExploreSearchBar(routeWrap);

			const sentinel = document.createElement('div');
			sentinel.dataset.chatFeedLoadSentinel = '1';
			sentinel.className = 'chat-page-feed-load-sentinel';
			sentinel.setAttribute('aria-hidden', 'true');
			sentinel.style.cssText = 'height:1px;margin:0;padding:0;flex-shrink:0;pointer-events:none';
			if (isNewestFirstBrowseLane('explore')) {
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
			if (!isStaleChatPane(paneEpoch)) {
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Could not load explore.',
					"Couldn't load explore"
				);
			}
		} finally {
			exitPseudoChannelLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			exploreBrowseMessagesLoading = false;
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			// Hard-enforce top anchoring for explore browse lane after unlock/layout work.
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'explore') {
				scrollChatFeedPseudoChannelToTop();
			}
			syncActiveChatExploreSearchBar();
			if (activePseudoChannelSlug === 'explore' && !String(exploreQueryRef.q || '').trim()) {
				syncExploreChannelBrowseUrl();
			}
			rebuildTopbarMenuDynamic();
		}
	}

	function chatMessageStableJson(value) {
		try {
			return JSON.stringify(value ?? null);
		} catch {
			return '';
		}
	}

	function chatMessagePayloadDiffers(a, b) {
		if (String(a?.body ?? '') !== String(b?.body ?? '')) return true;
		if (getChatMessageEditedAt(a) !== getChatMessageEditedAt(b)) return true;
		if (chatMessageStableJson(a?.reactions) !== chatMessageStableJson(b?.reactions)) return true;
		if (chatMessageStableJson(a?.viewer_reactions) !== chatMessageStableJson(b?.viewer_reactions)) {
			return true;
		}
		if (chatMessageStableJson(a?.meta) !== chatMessageStableJson(b?.meta)) return true;
		return false;
	}

	function chatMessageOnlyReactionsDiffer(a, b) {
		if (!chatMessagePayloadDiffers(a, b)) return false;
		if (String(a?.body ?? '') !== String(b?.body ?? '')) return false;
		if (getChatMessageEditedAt(a) !== getChatMessageEditedAt(b)) return false;
		if (chatMessageStableJson(a?.meta) !== chatMessageStableJson(b?.meta)) return false;
		return true;
	}

	function shouldSkipSelfMessageDuringOptimisticSend(m, threadId) {
		if (!optimisticSend || optimisticSend.status !== 'pending') return false;
		if (Number(optimisticSend.threadId) !== Number(threadId)) return false;
		const vid = Number(chatViewerId);
		const sid = m?.sender_id != null ? Number(m.sender_id) : null;
		return Number.isFinite(vid) && Number.isFinite(sid) && sid === vid;
	}

	async function fetchActiveThreadMessagesForUi(threadId) {
		if (chatSimulateConversationLoadFail()) {
			throw new Error('Failed to fetch');
		}
		const res = await fetch(`/api/chat/threads/${threadId}/messages?limit=50`, {
			credentials: 'include'
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data.message || data.error || 'Failed to load messages');
		}
		const messages = Array.isArray(data.messages) ? data.messages : [];
		const messagesForUiRaw = messages.filter((m) => !getChatCanvasMetaFromMessage(m));
		const threadMetaForPriv = chatPrivateThreadMetaById(threadId);
		let messagesForUi = messagesForUiRaw;
		if (isPrivateChannelThreadMeta(threadMetaForPriv)) {
			const k = await fetchPrivateThreadKey(threadId);
			if (!k) {
				throw new Error('Private channel key missing. Re-open using invite link.');
			}
			messagesForUi = [];
			for (const m of messagesForUiRaw) {
				if (m?.private_decrypted === true) {
					messagesForUi.push(m);
					continue;
				}
				const body = String(m?.body || '');
				if (body.startsWith(CHAT_PRIVATE_MSG_PREFIX)) {
					const dec = await decryptPrivateText(body.slice(CHAT_PRIVATE_MSG_PREFIX.length), k);
					messagesForUi.push({ ...m, body: dec != null ? dec : '[Encrypted message]' });
				} else {
					messagesForUi.push({ ...m, body: '[Encrypted message]' });
				}
			}
		}
		return messagesForUi;
	}

	function applyChatMessagesIncremental(nextMessages, threadId) {
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!messagesEl || !Array.isArray(nextMessages)) return { ok: false };

		const prev = lastChatMessagesPayload;
		if (!prev.length) return { ok: false };

		const prevIds = new Set(prev.map((m) => Number(m.id)));
		const nextIds = new Set(nextMessages.map((m) => Number(m.id)));
		const overlap = [...prevIds].filter((id) => nextIds.has(id));
		if (overlap.length === 0) return { ok: false };

		const nextNumericIds = nextMessages
			.map((m) => Number(m.id))
			.filter((n) => Number.isFinite(n) && n > 0);
		if (nextNumericIds.length === 0) {
			lastChatMessagesPayload = nextMessages;
			return { ok: true, changed: false };
		}
		const nextMinId = Math.min(...nextNumericIds);
		const prevById = new Map(prev.map((m) => [Number(m.id), m]));
		const viewerId = Number(chatViewerId);
		let changed = false;
		let appendedFromOther = false;

		for (const m of prev) {
			const id = Number(m.id);
			if (id < nextMinId || nextIds.has(id)) continue;
			if (Number(activeMessageEditId) === id) continue;
			const row = messagesEl.querySelector(`.connect-chat-msg[data-chat-message-id="${id}"]`);
			if (row) {
				row.remove();
				changed = true;
			}
		}

		for (const nm of nextMessages) {
			const id = Number(nm.id);
			const om = prevById.get(id);
			if (!om || !chatMessagePayloadDiffers(om, nm)) continue;
			if (Number(activeMessageEditId) === id) continue;
			changed = true;
			const idx = lastChatMessagesPayload.findIndex((x) => Number(x.id) === id);
			if (idx >= 0) lastChatMessagesPayload[idx] = nm;
			if (chatMessageOnlyReactionsDiffer(om, nm)) {
				patchChatMessageReactionDom(id, nm);
				updateChatHoverBarReactionState(id, nm);
			} else {
				replaceChatMessageRowFromPayload(id);
			}
		}

		const firstNewIdx = nextMessages.findIndex((m) => !prevIds.has(Number(m.id)));
		if (firstNewIdx >= 0) {
			let appendStart = -1;
			for (let i = firstNewIdx; i < nextMessages.length; i++) {
				if (shouldSkipSelfMessageDuringOptimisticSend(nextMessages[i], threadId)) continue;
				appendStart = i;
				break;
			}
			if (appendStart >= 0) {
				const n = appendChatMessagesToDom(messagesEl, nextMessages, appendStart);
				if (n < 0) return { ok: false };
				if (n > 0) {
					changed = true;
					for (let i = appendStart; i < nextMessages.length; i++) {
						const nm = nextMessages[i];
						if (shouldSkipSelfMessageDuringOptimisticSend(nm, threadId)) continue;
						const sid = nm?.sender_id != null ? Number(nm.sender_id) : null;
						if (Number.isFinite(viewerId) && Number.isFinite(sid) && sid !== viewerId) {
							appendedFromOther = true;
						}
					}
				}
			}
		}

		let mergedPayload = nextMessages;
		if (
			optimisticSend &&
			optimisticSend.status === 'pending' &&
			Number(optimisticSend.threadId) === Number(threadId)
		) {
			mergedPayload = nextMessages.filter((m) => {
				const id = Number(m.id);
				if (prevIds.has(id)) return true;
				return !shouldSkipSelfMessageDuringOptimisticSend(m, threadId);
			});
		}
		lastChatMessagesPayload = mergedPayload;

		if (changed && chatStickToBottom) {
			scrollChatMessagesToEnd();
		}
		if (appendedFromOther && chatStickToBottom) {
			void markLatestMessageRead();
		}

		return { ok: true, changed };
	}

	async function syncChatMessagesFromServer() {
		const threadId = activeThreadId;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !messagesEl || activePseudoChannelSlug) return;
		if (loadingThreadMessages || chatMessagesSyncInFlight) return;
		if (!lastChatMessagesPayload.length) {
			void loadMessages();
			return;
		}

		chatMessagesSyncInFlight = true;
		const prevVideoStates = captureChatVideoPlaybackStates(messagesEl);
		try {
			const nextMessages = await fetchActiveThreadMessagesForUi(threadId);
			if (Number(activeThreadId) !== Number(threadId)) return;

			const result = applyChatMessagesIncremental(nextMessages, threadId);
			if (!result.ok) {
				await loadMessages();
				return;
			}
			restoreChatVideoPlaybackStates(messagesEl, prevVideoStates);
		} catch (err) {
			console.error('[Chat page] sync messages:', err);
		} finally {
			chatMessagesSyncInFlight = false;
		}
	}

	async function loadMessages() {
		const threadId = activeThreadId;
		const messagesEl = root.querySelector('[data-chat-messages]');
		if (!threadId || !messagesEl) return;
		let shouldAutoMarkRead = false;
		chatThreadLoadFailed = false;
		applyComposerState();
		const paneEpoch = bumpChatMessagesPaneEpoch();
		if (threadId !== lastReadThreadIdForMark) {
			lastReadThreadIdForMark = threadId;
			lastMarkReadSentId = null;
		}
		enterThreadMessagesLoad();
		messagesEl.setAttribute('aria-busy', 'true');
		const prevVideoStates = captureChatVideoPlaybackStates(messagesEl);

		const viewerId = chatViewerId;
		try {
			await refreshChatCanvasesList();
			if (isStaleChatPane(paneEpoch)) return;
			const messagesForUi = await fetchActiveThreadMessagesForUi(threadId);
			if (isStaleChatPane(paneEpoch)) return;
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
			hydrateRichUserTextEmbeds(messagesEl);
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
			shouldAutoMarkRead = !isStaleChatPane(paneEpoch);
		} catch (err) {
			console.error('[Chat page] messages:', err);
			if (!isStaleChatPane(paneEpoch)) {
				chatThreadLoadFailed = true;
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Could not load messages.',
					"Couldn't load this conversation",
					{
						showRetry: true,
						onRetry: () => {
							clearChatSimulateConversationLoadFailParam();
							void loadMessages();
						}
					}
				);
				chatCanvasesList = [];
				activeThreadPinnedCanvasId = null;
				rebuildTopbarMenuDynamic();
				applyComposerState();
			}
		} finally {
			exitThreadMessagesLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			rebuildTopbarMenuDynamic();
			if (shouldAutoMarkRead && Number(activeThreadId) === Number(threadId)) {
				void markLatestMessageRead();
			}
		}
	}

	/**
	 * Human-readable title + body when the #challenges pane fails (fetch, chunk load, or mount).
	 * Keep recoverable cases actionable (Retry); avoid raw stack traces in UI.
	 */
	function getChallengesChannelLoadFailureCopy(err) {
		const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
		const m = String(raw || '').trim();
		const lower = m.toLowerCase();
		const title = "Couldn't load Challenges";
		let detail =
			m ||
			'Something went wrong while loading this channel. You can try again or go back to your channel list.';

		if (/loading chunk \d+ failed|import\(\)|failed to fetch|networkerror|network request failed|load failed/i.test(m)) {
			detail =
				"We couldn't finish loading this screen—often a network blip or an interrupted download. Check your connection and tap Retry.";
		} else if (/sign in|401|403|unauthorized|forbidden/i.test(lower)) {
			detail =
				'Your session may have expired. Sign in again in another tab if needed, then tap Retry.';
		} else if (/not found|404/.test(lower)) {
			detail = 'This conversation could not be loaded. It may have been removed or you may not have access.';
		} else if (/status:\s*5\d\d|server could not load|500/.test(lower)) {
			detail = 'The server had trouble loading this channel. Please try again in a moment.';
		}

		return { title, detail };
	}

	async function loadChallengesChannelMessages() {
		const messagesEl = root.querySelector('[data-chat-messages]');
		const tid = Number(activeThreadId);
		if (!messagesEl || !Number.isFinite(tid) || tid <= 0) return;

		try {
			captureChallengeSubmitThread?.(tid);
		} catch {
			// ignore
		}

		applyComposerState();
		const paneEpoch = bumpChatMessagesPaneEpoch();
		enterPseudoChannelLoad();
		messagesEl.setAttribute('aria-busy', 'true');
		if (typeof challengesPaneTeardown === 'function') {
			try {
				challengesPaneTeardown();
			} catch {
				// ignore
			}
		}
		challengesPaneTeardown = null;
		const organizerWasOpen =
			isChallengesOrganizerSidebarOpen() || isOpenOrganizerToolsStoredForThread(tid);
		if (typeof challengesOrganizerSidebarTeardown === 'function') {
			try {
				challengesOrganizerSidebarTeardown();
			} catch {
				// ignore
			}
		}
		challengesOrganizerSidebarTeardown = null;
		try {
			const [messages, viewerProf] = await Promise.all([
				challengesChannelModule.fetchAllChatThreadMessages(tid),
				fetchChatViewerProfileMini()
			]);
			const viewerUserName = viewerProf?.user_name ?? null;
			const organizerUserNames = challengesChannelModule.resolveChallengeOrganizerAllowlistFromMessages?.(
				messages
			);
			const globalConfig =
				typeof challengesChannelModule.pickLatestChallengesGlobalConfig === 'function'
					? challengesChannelModule.pickLatestChallengesGlobalConfig(messages)
					: null;
			chatChallengesOrganizerEligible = Boolean(
				challengesChannelModule.isChallengeChannelAdmin?.(viewerUserName, organizerUserNames)
			);
			if (isStaleChatPane(paneEpoch)) return;
			lastChatMessagesPayload = [];
			messagesEl.innerHTML = '';
			const mountWrap = document.createElement('div');
			mountWrap.className = 'challenge-pane-root';
			messagesEl.appendChild(mountWrap);

			const reactionIconHtml = (key, cls) => {
				const fn = REACTION_ICONS[key];
				return typeof fn === 'function' ? fn(cls || '') : '';
			};

			const api = await challengesChannelModule.mountChallengesPane({
				root: mountWrap,
				threadId: tid,
				viewerId: Number.isFinite(Number(chatViewerId)) ? Number(chatViewerId) : null,
				messages,
				reload: async () => {
					await loadChallengesChannelMessages();
				},
				postMessage: (body) => postChatMessage(tid, body),
				toggleReaction: (mid, ek) => toggleChatMessageReaction(mid, ek),
				reactionIconHtml
			});
			challengesPaneTeardown = api.destroy;

			const orgHost = chatCanvasScope?.querySelector('[data-chat-challenges-organizer-sidebar]');
			if (chatChallengesOrganizerEligible && orgHost instanceof HTMLElement && challengesChannelModule.mountChallengesOrganizerSidebar) {
				const orgApi = challengesChannelModule.mountChallengesOrganizerSidebar(orgHost, {
					messages,
					viewerId: Number.isFinite(Number(chatViewerId)) ? Number(chatViewerId) : null,
					viewerUserName,
					organizerUserNames: Array.isArray(organizerUserNames) ? organizerUserNames : [],
					globalConfigMessageId:
						Number.isFinite(Number(globalConfig?.messageId)) && Number(globalConfig?.messageId) > 0
							? Number(globalConfig.messageId)
							: null,
					threadId: tid,
					postMessage: (body) => postChatMessage(tid, body),
					patchMessage: (messageId, body) => patchChatMessageBody(messageId, body),
					reload: async () => {
						await loadChallengesChannelMessages();
					},
					gearIcon,
					statsIcon: statsBarsIcon,
					plusIcon
				});
				challengesOrganizerSidebarTeardown = orgApi.destroy;
			} else {
				chatChallengesOrganizerEligible = false;
				closeChallengesOrganizerSidebar();
			}

			if (organizerWasOpen && chatChallengesOrganizerEligible) {
				openChallengesOrganizerSidebar();
			}

			const last = messages[messages.length - 1];
			const midLast = last?.id != null ? Number(last.id) : null;
			if (Number.isFinite(midLast) && midLast > 0) {
				void markThreadReadByMessageId(tid, midLast);
			}
			scrollChatFeedPseudoChannelToTop();
		} catch (err) {
			console.error('[Chat page] challenges channel:', err);
			chatChallengesOrganizerEligible = false;
			if (typeof challengesPaneTeardown === 'function') {
				try {
					challengesPaneTeardown();
				} catch {
					// ignore
				}
			}
			challengesPaneTeardown = null;
			if (typeof challengesOrganizerSidebarTeardown === 'function') {
				try {
					challengesOrganizerSidebarTeardown();
				} catch {
					// ignore
				}
			}
			challengesOrganizerSidebarTeardown = null;
			closeChallengesOrganizerSidebar();
			if (!isStaleChatPane(paneEpoch)) {
				const { title, detail } = getChallengesChannelLoadFailureCopy(err);
				paintChatMessagesPaneError(messagesEl, detail, title, {
					showRetry: true,
					onRetry: () => {
						void loadChallengesChannelMessages();
					},
					buttonText: 'Back to channels',
					buttonHref: '/chat#channels'
				});
			}
		} finally {
			exitPseudoChannelLoad();
			unlockChatMessagesPaneScroll(messagesEl);
			if (!isStaleChatPane(paneEpoch) && messagesEl.isConnected) {
				messagesEl.removeAttribute('aria-busy');
			}
			if (!isStaleChatPane(paneEpoch) && activePseudoChannelSlug === 'challenges') {
				scrollChatFeedPseudoChannelToTop();
			}
			rebuildTopbarMenuDynamic();
		}
	}

	async function openChallengeVoteModalFromFeedCard() {
		const viewerIdNum = Number.isFinite(Number(chatViewerId)) ? Number(chatViewerId) : null;
		let challengesThreadId = Number.NaN;
		const match = (chatThreads || []).find(
			(t) => t.type === 'channel' && String(t.channel_slug || '').toLowerCase() === 'challenges'
		);
		if (match) challengesThreadId = Number(match.id);
		if (!Number.isFinite(challengesThreadId) || challengesThreadId <= 0) {
			const res = await fetch('/api/chat/channels', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tag: 'challenges' })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data?.message || data?.error || `Could not open channel (${res.status})`);
			}
			const tid = Number(data?.thread?.id);
			if (!Number.isFinite(tid) || tid <= 0) {
				throw new Error('Could not resolve #challenges thread.');
			}
			challengesThreadId = tid;
			await loadChatThreads({ forceNetwork: true });
			await refreshChatSidebar({ skipThreadsFetch: true });
		}

		const messages = await challengesChannelModule.fetchAllChatThreadMessages(challengesThreadId);
		const opened = challengesChannelModule.openChallengeVoteModalFromMessages?.({
			messages,
			viewerId: viewerIdNum,
			toggleReaction: (mid, ek) => toggleChatMessageReaction(mid, ek),
			onAfterVote: () => {
				if (
					activePseudoChannelSlug === 'challenges' &&
					Number.isFinite(Number(activeThreadId)) &&
					Number(activeThreadId) === Number(challengesThreadId)
				) {
					void loadChallengesChannelMessages();
				}
			}
		});
		if (!opened) {
			window.location.href = '/challenges';
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
			if (activePseudoChannelSlug === 'challenges') {
				if (!activeThreadId || loadingPseudoChannelMessages) return;
				void loadChallengesChannelMessages();
				return;
			}
			if (!activeThreadId || loadingThreadMessages) return;
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
			const onRoomDirty = () => {
				if (activePseudoChannelSlug === 'challenges') {
					void loadChallengesChannelMessages();
				} else {
					void syncChatMessagesFromServer();
				}
			};
			const onRoomReconnect = () => {
				if (activePseudoChannelSlug === 'challenges') {
					void loadChallengesChannelMessages();
				} else {
					void loadMessages();
				}
			};
			roomBroadcastTeardown = await subscribeRoomBroadcast(tid, onRoomDirty, {
				onReconnect: onRoomReconnect,
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
				hydrateRichUserTextEmbeds(rowRestored);
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
		const acceptInviteBtn = e.target?.closest?.('[data-chat-timed-accept-invite]');
		if (acceptInviteBtn instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const token = String(acceptInviteBtn.getAttribute('data-chat-timed-accept-invite') || '').trim();
			if (!token) return;
			void (async () => {
				const res = await fetch('/api/chat/invites/accept', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ invite_token: token })
				});
				const data = await res.json().catch(() => ({}));
				const errEl = root.querySelector('[data-chat-error]');
				if (!res.ok) {
					if (errEl instanceof HTMLElement) {
						errEl.hidden = false;
						errEl.textContent = data?.message || data?.error || 'Invite could not be accepted.';
					}
					return;
				}
				const threadId = Number(data?.thread_id);
				if (Number.isFinite(threadId) && threadId > 0) {
					await loadChatThreads({ forceNetwork: true });
					await refreshChatSidebar({ skipThreadsFetch: true });
					const meta = (chatThreads || []).find((t) => Number(t.id) === threadId);
					history.pushState({ prsnChat: true }, '', buildPreferredChatThreadPath(threadId, meta));
					await openThreadForCurrentPath();
				}
			})().catch(() => {
				// ignore
			});
			return;
		}

		const exploreSearchSubmit = e.target?.closest?.('[data-chat-explore-search-submit]');
		if (exploreSearchSubmit instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			if (activePseudoChannelSlug !== 'explore') return;
			void commitExploreSearchImmediateFromComposer();
			return;
		}
		const exploreSearchClear = e.target?.closest?.('[data-chat-explore-search-clear]');
		if (exploreSearchClear instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			if (activePseudoChannelSlug !== 'explore') return;
			if (isExploreComposerLoadLocked()) return;
			const searchInput = root.querySelector('[data-chat-explore-search-input]');
			const hadCommittedSearch = String(exploreQueryRef.q || '').trim().length > 0;
			if (searchInput instanceof HTMLInputElement) {
				searchInput.value = '';
			}
			exploreQueryRef.q = '';
			syncActiveChatExploreSearchBar();
			if (hadCommittedSearch) {
				void loadExploreChannelMessages();
			}
			return;
		}

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

		const tagLink = e.target?.closest?.('a.mention-link[href]');
		if (tagLink instanceof HTMLAnchorElement && tagLink.closest('.connect-chat-msg-bubble')) {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
				return;
			}
			const hrefAttr = tagLink.getAttribute('href') || '';
			if (!hrefAttr.startsWith('/')) {
				return;
			}
			const pathOnly = hrefAttr.split('?')[0].split('#')[0];
			const isHashtagTagPath = /^\/t\/([^/?#]+)/i.test(pathOnly);
			const isChatInAppRoute =
				pathOnly.startsWith('/chat/') ||
				pathOnly === '/feed' ||
				pathOnly === '/explore' ||
				pathOnly === '/creations' ||
				pathOnly === '/challenges';
			if (!isHashtagTagPath && !isChatInAppRoute) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isHashtagTagPath) {
				const m = pathOnly.match(/^\/t\/([^/?#]+)/i);
				if (!m) return;
				const slug = decodeURIComponent(m[1]);
				void openChatHashtagDestination(slug);
				return;
			}
			history.pushState({ prsnChat: true }, '', hrefAttr);
			void openThreadForCurrentPath();
			return;
		}

		const inHoverBar = e.target?.closest?.('.connect-chat-msg-hover-bar');
		if (inHoverBar) {
			e.stopPropagation();
		}
		const inMessageEditDialog = e.target?.closest?.('.connect-chat-msg-edit-dialog');
		if (inMessageEditDialog) {
			e.stopPropagation();
		}

		const hoverEdit = e.target?.closest?.('[data-chat-hover-edit]');
		if (hoverEdit instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(hoverEdit.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			closeChatMessageToolbar();
			startChatMessageEdit(messageId);
			return;
		}

		const editCancel = e.target?.closest?.('[data-chat-message-edit-cancel]');
		if (editCancel instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			cancelActiveChatMessageEdit();
			return;
		}

		const editSave = e.target?.closest?.('[data-chat-message-edit-save]');
		if (editSave instanceof HTMLButtonElement) {
			e.preventDefault();
			e.stopPropagation();
			void saveActiveChatMessageEdit();
			return;
		}

		const replyBtn = e.target?.closest?.('[data-chat-hover-reply]');
		if (replyBtn instanceof HTMLButtonElement) {
			if (activePseudoChannelSlug) {
				e.preventDefault();
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const messageId = Number(replyBtn.dataset.chatMessageId);
			if (!Number.isFinite(messageId)) return;
			closeChatMessageToolbar();
			chatComposerReferencedMessageId = messageId;
			syncChatComposerReplyStripUi();
			const inp = root.querySelector('[data-chat-body-input]');
			if (inp instanceof HTMLTextAreaElement) {
				inp.focus();
			}
			return;
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
			if (msgRow.dataset.chatMessageEditing === '1') {
				return;
			}
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

		const refMid = Number(chatComposerReferencedMessageId);
		const replySrc =
			Number.isFinite(refMid) && refMid > 0
				? lastChatMessagesPayload.find((x) => Number(x.id) === refMid)
				: null;
		const sendOpts =
			Number.isFinite(refMid) && refMid > 0
				? {
						referencedMessageId: refMid,
						replyPreview: plainTextReplyPreview(
							replySrc?.body != null ? String(replySrc.body) : ''
						)
					}
				: {};

		sendInFlight = true;
		if (errEl instanceof HTMLElement) {
			errEl.hidden = true;
			errEl.textContent = '';
		}

		if (clearInput) {
			bodyInput.value = '';
			syncChatSendButton();
		}

		optimisticSend = buildOptimisticSendRecord({
			tempId,
			body: text,
			threadId,
			status: 'pending',
			sendOpts
		});
		messagesEl.querySelector('.chat-page-empty-hint')?.remove();
		placeOptimisticInDom(messagesEl, optimisticSend);

		try {
			const result = await postChatMessage(threadId, text, sendOpts);
			if (!result.ok) {
				optimisticSend = buildOptimisticSendRecord({
					tempId,
					body: text,
					threadId,
					status: 'failed',
					errorMessage: result.error,
					sendOpts
				});
				placeOptimisticInDom(messagesEl, optimisticSend);
				return;
			}
			clearChatComposerReplyTarget();
			await afterSendSuccess(threadId, result.message);
		} catch (err) {
			console.error('[Chat page] send:', err);
			optimisticSend = buildOptimisticSendRecord({
				tempId,
				body: text,
				threadId,
				status: 'failed',
				errorMessage: err?.message || 'Could not send message.',
				sendOpts
			});
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
		const searchInput = root.querySelector('[data-chat-explore-search-input]');
		const bodyInput = root.querySelector('[data-chat-body-input]');
		if (searchInput instanceof HTMLInputElement) {
			exploreQueryRef.q = String(searchInput.value || '').trim();
		} else if (bodyInput instanceof HTMLTextAreaElement) {
			exploreQueryRef.q = String(bodyInput.value || '').trim();
		} else {
			return;
		}
		await loadExploreChannelMessages();
	}

	async function createPrivateChannelFromCommand(rawName) {
		const name = normalizeChannelTagLikeApi(rawName || '');
		if (!name) {
			throw new Error('Private channel tag must be 2–32 chars: lowercase letters, numbers, _, -.');
		}
		const secret = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
		const encName = await encryptPrivateText(name, secret);
		const encProbe = await encryptPrivateText(CHAT_PRIVATE_PROBE_TEXT, secret);
		const res = await fetch('/api/chat/channels', {
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
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data?.message || data?.error || `Could not create private channel (${res.status})`);
		}
		const threadId = Number(data?.thread?.id);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			throw new Error('Private channel creation failed.');
		}
		chatPrivateKeyByThreadId.set(threadId, secret);
		const invRes = await fetch('/api/chat/invites', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ thread_id: threadId })
		});
		const invData = await invRes.json().catch(() => ({}));
		if (!invRes.ok) {
			throw new Error(invData?.message || invData?.error || `Could not create invite (${invRes.status})`);
		}
		const inviteUrl = typeof invData?.invite_url === 'string' ? invData.invite_url : '';
		if (inviteUrl && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(inviteUrl);
			} catch {
				// ignore
			}
		}
		await loadChatThreads({ forceNetwork: true });
		await refreshChatSidebar({ skipThreadsFetch: true });
		const meta = (chatThreads || []).find((t) => Number(t.id) === threadId);
		history.pushState({ prsnChat: true }, '', buildPreferredChatThreadPath(threadId, meta));
		await openThreadForCurrentPath();
		return inviteUrl;
	}

	async function createInviteForActiveThread() {
		const threadId = Number(activeThreadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			throw new Error('Open a channel first.');
		}
		const meta = chatPrivateThreadMetaById(threadId);
		if (!isPrivateChannelThreadMeta(meta)) {
			throw new Error('Invites are only for private channels.');
		}
		const invRes = await fetch('/api/chat/invites', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ thread_id: threadId })
		});
		const invData = await invRes.json().catch(() => ({}));
		if (!invRes.ok) {
			throw new Error(invData?.message || invData?.error || `Could not create invite (${invRes.status})`);
		}
		const inviteUrl = typeof invData?.invite_url === 'string' ? invData.invite_url : '';
		if (!inviteUrl) throw new Error('Invite created, but URL was missing.');
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(inviteUrl);
			} catch {
				// ignore
			}
		}
		return inviteUrl;
	}

	function parseInviteRecipientsFromCommand(raw) {
		const text = String(raw || '').trim();
		if (!text) return [];
		const tokens = text
			.split(/[\s,]+/)
			.map((x) => String(x || '').trim())
			.filter(Boolean);
		const out = [];
		for (const t of tokens) {
			const name = t.startsWith('@') ? t.slice(1).trim().toLowerCase() : t.toLowerCase();
			if (/^[a-z0-9][a-z0-9_]{2,23}$/.test(name)) {
				out.push({ user_name: name });
			}
		}
		return out;
	}

	async function sendInviteDmToRecipients(recipients) {
		const threadId = Number(activeThreadId);
		if (!Number.isFinite(threadId) || threadId <= 0) {
			throw new Error('Open a channel first.');
		}
		const meta = chatPrivateThreadMetaById(threadId);
		if (!isPrivateChannelThreadMeta(meta)) {
			throw new Error('DM invites are only for private channels.');
		}
		const list = Array.isArray(recipients) ? recipients : [];
		if (list.length === 0) throw new Error('Add at least one @username.');
		const res = await fetch('/api/chat/invites/dm', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ thread_id: threadId, recipients: list })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data?.message || data?.error || 'Could not send invites.');
		}
		const alreadyJoined = Array.isArray(data?.already_joined)
			? data.already_joined.map((x) => String(x || '').trim()).filter(Boolean)
			: [];
		return {
			sentCount: Number(data?.sent_count) || 0,
			alreadyJoined
		};
	}

	async function submitChatMessage() {
		const bodyInput = root.querySelector('[data-chat-body-input]');
		const errEl = root.querySelector('[data-chat-error]');
		if (!(bodyInput instanceof HTMLTextAreaElement)) return;
		if (activePseudoChannelSlug === 'explore') {
			await commitExploreSearchImmediateFromComposer();
			return;
		}
		const text = String(bodyInput.value || '').trim();
		const inviteDmCmdMatch = text.match(/^\/invite\s+(.+)$/i);
		if (inviteDmCmdMatch) {
			bodyInput.value = '';
			syncChatSendButton();
			try {
				const recipients = parseInviteRecipientsFromCommand(inviteDmCmdMatch[1] || '');
				const inviteResult = await sendInviteDmToRecipients(recipients);
				const sentCount = Number(inviteResult?.sentCount) || 0;
				const alreadyJoined = Array.isArray(inviteResult?.alreadyJoined) ? inviteResult.alreadyJoined : [];
				if (errEl instanceof HTMLElement) {
					if (alreadyJoined.length > 0) {
						errEl.hidden = false;
						errEl.textContent = `Already joined: ${alreadyJoined.join(', ')}`;
					} else {
						errEl.hidden = true;
						errEl.textContent = '';
					}
				}
				if (sentCount > 0) {
					await loadMessages();
				}
			} catch (err) {
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = err?.message || 'Could not send invites.';
				}
			}
			return;
		}

		const inviteCmdMatch = text.match(/^\/invite$/i);
		if (inviteCmdMatch) {
			bodyInput.value = '';
			syncChatSendButton();
			try {
				const inviteUrl = await createInviteForActiveThread();
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = inviteUrl
						? 'Invite link copied to clipboard.'
						: 'Invite link created.';
				}
			} catch (err) {
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = err?.message || 'Could not create invite.';
				}
			}
			return;
		}
		const privateCmdMatch = text.match(/^\/private\s+(.+)$/i);
		if (privateCmdMatch) {
			bodyInput.value = '';
			syncChatSendButton();
			try {
				const inviteUrl = await createPrivateChannelFromCommand(privateCmdMatch[1] || '');
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = inviteUrl
						? 'Private channel created. Invite link copied to clipboard.'
						: 'Private channel created.';
				}
			} catch (err) {
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = err?.message || 'Could not create private channel.';
				}
			}
			return;
		}
		const genCmdMatch = text.match(/^\/gen(?:\s+(.+))?$/i);
		if (genCmdMatch) {
			if (errEl instanceof HTMLElement) {
				errEl.hidden = true;
				errEl.textContent = '';
			}
			bodyInput.value = '';
			syncChatSendButton();
			const optimisticAttachmentId = addOptimisticGenAttachment();
			try {
				const creationId = await runChatGenFromPrompt(genCmdMatch[1] || '');
				const entry = chatPendingImages.find((x) => x.id === optimisticAttachmentId);
				if (entry) {
					entry.generationId = creationId;
					entry.previewUrl = '';
					writeChatComposerDrafts();
					startChatGenPoll(optimisticAttachmentId);
				}
			} catch (err) {
				const entry = chatPendingImages.find((x) => x.id === optimisticAttachmentId);
				if (entry) {
					entry.status = 'error';
					entry.errorMessage =
						String(err?.message || '') === 'Cancelled /gen.'
							? 'Cancelled'
							: err?.message || 'Could not start /gen.';
					entry.previewUrl = '';
					renderChatAttachmentStrip();
					syncChatSendButton();
					writeChatComposerDrafts();
				}
				if (String(err?.message || '') === 'Cancelled /gen.') {
					return;
				}
				if (errEl instanceof HTMLElement) {
					errEl.hidden = false;
					errEl.textContent = err?.message || 'Could not start /gen.';
				}
			}
			return;
		}
		if (chatPendingImages.some((x) => x.status === 'uploading' && x.source !== 'gen')) return;
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
		clearSentReadyChatAttachments();
		await sendChatOutgoing(body, { clearInput: true });
	}

	/**
	 * Friendly in-pane error for chat `[data-chat-messages]` (threads, real channels, pseudo lanes).
	 * @param {HTMLElement | null} messagesEl
	 * @param {string} [detail]
	 * @param {string} [title]
	 * @param {{ buttonText?: string, buttonHref?: string, buttonRoute?: string, showRetry?: boolean, onRetry?: (() => void) }} [cta]
	 */
	function paintChatMessagesPaneError(messagesEl, detail, title, cta = {}) {
		if (!(messagesEl instanceof HTMLElement) || typeof renderPaneLoadError !== 'function') return;
		const msg =
			typeof detail === 'string' && detail.trim()
				? detail.trim()
				: 'Please try again in a moment.';
		const ttl =
			typeof title === 'string' && title.trim() ? title.trim() : "Couldn't load this view";
		messagesEl.innerHTML = renderPaneLoadError(msg, {
			title: ttl,
			buttonText: cta.buttonText || '',
			buttonHref: cta.buttonHref || '',
			buttonRoute: cta.buttonRoute || '',
		});
		if (cta.showRetry === true) {
			const wrap = messagesEl.querySelector('.chat-page-pane-load-error');
			if (wrap instanceof HTMLElement) {
				const retryBtn = document.createElement('button');
				retryBtn.type = 'button';
				retryBtn.className = 'btn-outlined chat-page-pane-load-retry';
				retryBtn.textContent = 'Retry';
				retryBtn.addEventListener('click', () => {
					messagesEl.innerHTML = renderEmptyState({
						loading: true,
						loadingAriaLabel: 'Loading',
						className: 'chat-page-thread-loading'
					});
					messagesEl.setAttribute('aria-busy', 'true');
					if (typeof cta.onRetry === 'function') cta.onRetry();
				});
				const detailEl = wrap.querySelector('.route-empty-message');
				if (detailEl instanceof HTMLElement) {
					detailEl.insertAdjacentElement('afterend', retryBtn);
				} else {
					wrap.appendChild(retryBtn);
				}
			}
		}
		messagesEl.removeAttribute('aria-busy');
		unlockChatMessagesPaneScroll(messagesEl);
	}

	async function openThreadForCurrentPath() {
		syncChatSidebarPseudoStripActiveNow(window.location.pathname);
		const messagesEl = root.querySelector('[data-chat-messages]');
		const errEl = root.querySelector('[data-chat-error]');
		const parsed = parseChatPathname(window.location.pathname);
		if (parsed.kind === 'doom_scroll' && !isChatPageMobileLayout()) {
			window.location.replace(`/creations/${encodeURIComponent(String(parsed.startCreationId))}`);
			return;
		}
		markThreadUiPending();

		if (parsed.kind === 'empty' || parsed.kind === 'invalid') {
			window.location.replace('/chat#channels');
			return;
		}

		optimisticSend = null;
		tearDownChatCanvasUi();
		if (typeof challengesPaneTeardown === 'function') {
			try {
				challengesPaneTeardown();
			} catch {
				// ignore
			}
		}
		challengesPaneTeardown = null;
		if (typeof challengesOrganizerSidebarTeardown === 'function') {
			try {
				challengesOrganizerSidebarTeardown();
			} catch {
				// ignore
			}
		}
		challengesOrganizerSidebarTeardown = null;
		chatChallengesOrganizerEligible = false;
		closeChallengesOrganizerSidebar();
		teardownChatDoomScroll();
		activePseudoChannelSlug = null;
		if (parsed.kind === 'channel') {
			const slug = String(parsed.slug || '').trim().toLowerCase();
			if (
				slug === 'feed' ||
				slug === 'explore' ||
				slug === 'creations' ||
				slug === 'comments' ||
				slug === 'challenges'
			) {
				activePseudoChannelSlug = slug;
			}
		}
		if (parsed.kind === 'doom_scroll') {
			activePseudoChannelSlug = 'feed_doom';
		}
		if (activePseudoChannelSlug === 'explore') {
			exploreQueryRef.q = getExploreChannelSearchFromUrl();
		}
		syncChatBrowseViewBodyClass();
		applyComposerState();
		teardownCommentsChannelLoadMore();
		teardownFeedChannelLoadMore();
		teardownExploreChannelLoadMore();

		if (messagesEl) {
			stopChatCreationsPseudoChannelPoll();
			teardownChatCreationsPseudoBulkHostIfPresent(messagesEl);
			const channelSlugForLoading =
				parsed.kind === 'channel' ? String(parsed.slug || '').trim().toLowerCase() : '';
			if (parsed.kind === 'doom_scroll') {
				messagesEl.innerHTML =
					'<div class="chat-doom-scroll-loading route-loading chat-page-thread-loading" aria-busy="true" aria-label="Loading"></div>';
				resetAndLockChatMessagesScrollForSkeleton(messagesEl, 'feed');
			} else if (channelSlugForLoading === 'feed' && typeof renderFeedCardsSkeleton === 'function') {
				const spotlightHtml = getChatFeedMobileSpotlightHtml();
				messagesEl.innerHTML = `<div class="feed-route chat-feed-channel-route">
					${spotlightHtml}
					<div class="route-cards feed-cards" data-feed-container aria-busy="true" aria-label="Loading">${renderFeedCardsSkeleton(4)}</div>
				</div>`;
				resetAndLockChatMessagesScrollForSkeleton(messagesEl, 'feed');
			} else if (channelSlugForLoading === 'comments' && typeof renderCommentRowsSkeleton === 'function') {
				messagesEl.innerHTML = `<div class="chat-comments-channel-loading" aria-busy="true" aria-label="Loading">${renderCommentRowsSkeleton(10)}</div>`;
				resetAndLockChatMessagesScrollForSkeleton(messagesEl, 'comments');
			} else if (channelSlugForLoading === 'challenges') {
				if (typeof renderChallengePaneSkeleton === 'function') {
					messagesEl.innerHTML = `<div class="challenge-pane-root" aria-busy="true" aria-label="Loading">${renderChallengePaneSkeleton()}</div>`;
				} else {
					messagesEl.innerHTML = renderEmptyState({
						loading: true,
						loadingAriaLabel: 'Loading',
						className: 'chat-page-thread-loading'
					});
				}
				resetAndLockChatMessagesScrollForSkeleton(messagesEl, 'challenges');
			} else if (channelSlugForLoading === 'explore' || channelSlugForLoading === 'creations') {
				const creationsCls = channelSlugForLoading === 'creations' ? ' creations-route' : '';
				const browseCls = chatExploreCreationsBrowseView ? ' chat-feed-channel-route--browse-view' : '';
				const pendingExploreSearch = channelSlugForLoading === 'explore' && String(exploreQueryRef.q || '').trim().length > 0;
				const searchBar = channelSlugForLoading === 'explore'
					? renderChatExploreSearchBarMarkup({ loading: pendingExploreSearch })
					: '';
				const gridInner =
					chatExploreCreationsBrowseView && typeof renderGridSkeleton === 'function'
						? renderGridSkeleton(25)
						: typeof renderFeedCardsSkeleton === 'function'
							? renderFeedCardsSkeleton(4)
							: '';
				if (gridInner) {
					messagesEl.innerHTML = `<div class="feed-route chat-feed-channel-route${creationsCls}${browseCls}">
						${searchBar}
						<div class="route-cards feed-cards" aria-busy="true" aria-label="${pendingExploreSearch ? 'Searching' : 'Loading'}">${gridInner}</div>
					</div>`;
					resetAndLockChatMessagesScrollForSkeleton(messagesEl, channelSlugForLoading);
				} else {
					messagesEl.innerHTML = renderEmptyState({
						loading: true,
						loadingAriaLabel: 'Loading',
						className: 'chat-page-thread-loading'
					});
				}
			} else {
				messagesEl.innerHTML = renderEmptyState({
					loading: true,
					loadingAriaLabel: 'Loading',
					className: 'chat-page-thread-loading'
				});
			}
			messagesEl.setAttribute('aria-busy', 'true');
		}
		/* Mobile viewport-scroll lanes: snap window + pane to top as soon as we swap routes (before async fetch),
		 * same issue as feed/explore/creations — otherwise the previous scroll position lingers under the skeleton. */
		if (
			activePseudoChannelSlug === 'feed' ||
			activePseudoChannelSlug === 'feed_doom' ||
			activePseudoChannelSlug === 'explore' ||
			activePseudoChannelSlug === 'creations' ||
			activePseudoChannelSlug === 'comments' ||
			activePseudoChannelSlug === 'challenges'
		) {
			scrollChatFeedPseudoChannelToTop();
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
				const canonicalPath = buildPreferredChatThreadPath(parsed.threadId, meta);
				const curPath = String(window.location.pathname || '');
				if (curPath !== canonicalPath) {
					history.replaceState({ prsnChat: true }, '', canonicalPath);
				}
				updateTitleFromMeta(meta);
				await loadMessages();
				await bindRoomBroadcast(activeThreadId);
				return;
			}

			await refreshChatSidebar({ skipThreadsFetch: true });

			if (parsed.kind === 'doom_scroll') {
				activeThreadId = null;
				updateTitleFromMeta({
					type: 'channel',
					channel_slug: 'feed',
				});
				if (messagesEl) {
					messagesEl.removeAttribute('aria-busy');
				}
				try {
					await mountChatDoomScroll({
						messagesEl,
						startCreationId: parsed.startCreationId,
						fetchJsonWithStatusDeduped,
						getHiddenFeedItems,
						viewerUserId: chatViewerId,
						applyComposerState,
						syncChatBrowseViewBodyClass,
						navigateToFeedChannel: () => {
							history.pushState({ prsnChat: true }, '', '/chat/c/feed');
							void openThreadForCurrentPath();
						},
					});
				} catch (doomErr) {
					teardownChatDoomScroll();
					throw doomErr;
				}
				rebuildTopbarMenuDynamic();
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
					await loadCreationsChannelMessages({
						forceFreshFirstPage:
							chatCreationsNavigateDetail?.forceFreshFirstPage === true,
					});
					return;
				}
				if (slug === 'explore') {
					activePseudoChannelSlug = 'explore';
					activeThreadId = null;
					const exploreSearchFromUrl = getExploreChannelSearchFromUrl();
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
					await loadExploreChannelMessages({ searchQuery: exploreSearchFromUrl });
					return;
				}
				if (slug === 'challenges') {
					activePseudoChannelSlug = 'challenges';
					applyComposerState();
					const matchCh = (chatThreads || []).find(
						(t) => t.type === 'channel' && String(t.channel_slug || '').toLowerCase() === 'challenges'
					);
					if (matchCh) {
						activeThreadId = Number(matchCh.id);
						updateTitleFromMeta(matchCh);
						if (messagesEl) {
							messagesEl.removeAttribute('aria-busy');
						}
						await loadChallengesChannelMessages();
						await bindRoomBroadcast(activeThreadId);
						return;
					}
					const resCh = await fetch('/api/chat/channels', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ tag: 'challenges' })
					});
					const dataCh = await resCh.json().catch(() => ({}));
					if (!resCh.ok) {
						const msg = dataCh?.message || dataCh?.error || `Could not open channel (${resCh.status})`;
						throw new Error(msg);
					}
					const tidCh = Number(dataCh?.thread?.id);
					await loadChatThreads({ forceNetwork: true });
					await refreshChatSidebar({ skipThreadsFetch: true });
					if (Number.isFinite(tidCh) && tidCh > 0) {
						activeThreadId = tidCh;
						const metaCh = (chatThreads || []).find((t) => Number(t.id) === tidCh);
						updateTitleFromMeta(metaCh || { type: 'channel', channel_slug: 'challenges', title: 'Challenges' });
						if (messagesEl) {
							messagesEl.removeAttribute('aria-busy');
						}
						await loadChallengesChannelMessages();
						await bindRoomBroadcast(activeThreadId);
					} else if (messagesEl) {
						chatThreadLoadFailed = true;
						paintChatMessagesPaneError(
							messagesEl,
							'This channel could not be opened. Try again or choose another channel from the sidebar.',
							"Couldn't open this channel"
						);
						applyComposerState();
						if (errEl instanceof HTMLElement) {
							errEl.hidden = true;
							errEl.textContent = '';
						}
					}
					return;
				}
				const match = (chatThreads || []).find(
					(t) => t.type === 'channel' && String(t.channel_slug || '').toLowerCase() === slug
				);
				if (match) {
					activeThreadId = Number(match.id);
					const canonicalPath = buildPreferredChatThreadPath(activeThreadId, match);
					const curPath = String(window.location.pathname || '');
					if (curPath !== canonicalPath) {
						history.replaceState({ prsnChat: true }, '', canonicalPath);
					}
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
					const canonicalPath = buildPreferredChatThreadPath(activeThreadId, meta);
					const curPath = String(window.location.pathname || '');
					if (curPath !== canonicalPath) {
						history.replaceState({ prsnChat: true }, '', canonicalPath);
					}
					updateTitleFromMeta(meta);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
				} else if (messagesEl) {
					chatThreadLoadFailed = true;
					paintChatMessagesPaneError(
						messagesEl,
						'This channel could not be opened. Try again or choose another channel from the sidebar.',
						"Couldn't open this channel"
					);
					applyComposerState();
					if (errEl instanceof HTMLElement) {
						errEl.hidden = true;
						errEl.textContent = '';
					}
				}
				return;
			}

			if (parsed.kind === 'dm') {
				const isSelfNotesRoute = 'self' in parsed && parsed.self === true;
				let uid =
					isSelfNotesRoute
						? Number(chatViewerId)
						: 'userId' in parsed && parsed.userId != null
							? Number(parsed.userId)
							: null;
				if (!Number.isFinite(uid) || uid <= 0) uid = null;
				const userName = 'userName' in parsed && parsed.userName ? String(parsed.userName) : null;
				if (uid == null && !userName) {
					throw new Error('Could not open My Notes until your chat profile is loaded.');
				}

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
					updateTitleFromMeta(isSelfNotesRoute ? { ...match, title: 'My Notes' } : match);
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
					updateTitleFromMeta(isSelfNotesRoute && meta ? { ...meta, title: 'My Notes' } : meta);
					await loadMessages();
					await bindRoomBroadcast(activeThreadId);
				} else if (messagesEl) {
					chatThreadLoadFailed = true;
					paintChatMessagesPaneError(
						messagesEl,
						'This conversation could not be opened. Try again or start from your inbox.',
						"Couldn't open this chat"
					);
					applyComposerState();
					if (errEl instanceof HTMLElement) {
						errEl.hidden = true;
						errEl.textContent = '';
					}
				}
			}
		} catch (err) {
			tearDownVisibilityResync();
			tearDownRoomBroadcast();
			console.error('[Chat page]', err);
			void refreshChatSidebar({ skipThreadsFetch: true });
			if (messagesEl) {
				chatThreadLoadFailed = true;
				paintChatMessagesPaneError(
					messagesEl,
					err?.message || 'Something went wrong while opening chat.',
					"Couldn't open this view"
				);
				applyComposerState();
			}
			if (errEl instanceof HTMLElement) {
				errEl.hidden = true;
				errEl.textContent = '';
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

	function resolveSpecialHashtagDestination(slug) {
		const key = String(slug || '').trim().toLowerCase();
		if (!key) return null;
		const map = {
			create: '/create',
			feed: '/feed',
			help: '/help',
			creations: '/chat/c/creations',
			creation: '/chat/c/creations',
			challenges: '/challenges',
			notes: '/chat/notes',
			explore: '/explore',
			comments: '/chat/c/comments',
			feedback: '/chat/c/feedback'
		};
		const href = map[key];
		if (href) return { kind: 'path', href };
		return null;
	}

	async function openChatHashtagDestination(slug) {
		const safe = String(slug || '')
			.trim()
			.toLowerCase();
		if (!safe) {
			return;
		}
		const special = resolveSpecialHashtagDestination(safe);
		if (special?.kind === 'path' && special.href) {
			const href = String(special.href || '').trim();
			if (href.startsWith('/chat/')) {
				history.pushState({ prsnChat: true }, '', href);
				await openThreadForCurrentPath();
				return;
			}
			window.location.href = href;
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
	restoreChatComposerDraftsFromSession();
	resumeChatGenPollsFromDrafts();
	renderChatAttachmentStrip();
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
		if (typeof attachChatComposerSuggest === 'function') {
			attachChatComposerSuggest(bodyInput);
		} else if (typeof attachChatMentionSuggest === 'function') {
			attachChatMentionSuggest(bodyInput);
		} else {
			attachMentionSuggest(bodyInput);
		}
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
		stopAllChatGenPolls();
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
		if (typeof chatSidebarNotificationsOutsideClickHandler === 'function') {
			document.removeEventListener('click', chatSidebarNotificationsOutsideClickHandler);
			chatSidebarNotificationsOutsideClickHandler = null;
		}
		if (chatSidebarNotificationsMenuEl instanceof HTMLElement) {
			chatSidebarNotificationsMenuEl.remove();
			chatSidebarNotificationsMenuEl = null;
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
		if (typeof chatInlineImageLightboxClickUnbind === 'function') {
			chatInlineImageLightboxClickUnbind();
			chatInlineImageLightboxClickUnbind = null;
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
		messagesContainerForReactions.addEventListener('keydown', (e) => {
			if (activePseudoChannelSlug !== 'explore') return;
			if (!(e.target instanceof HTMLInputElement)) return;
			if (!e.target.matches('[data-chat-explore-search-input]')) return;
			if (e.key === 'Enter') {
				e.preventDefault();
				void commitExploreSearchImmediateFromComposer();
			}
		});
		const resetExploreSearchOnInputClear = (e) => {
			if (activePseudoChannelSlug !== 'explore') return;
			if (!(e.target instanceof HTMLInputElement)) return;
			if (!e.target.matches('[data-chat-explore-search-input]')) return;
			const next = String(e.target.value || '').trim();
			const committed = String(exploreQueryRef.q || '').trim();
			syncActiveChatExploreSearchBar();
			if (next.length > 0 || committed.length === 0) return;
			exploreQueryRef.q = '';
			syncActiveChatExploreSearchBar();
			void loadExploreChannelMessages();
		};
		messagesContainerForReactions.addEventListener('input', resetExploreSearchOnInputClear);
		messagesContainerForReactions.addEventListener('search', resetExploreSearchOnInputClear, true);

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

	chatInlineImageLightboxClickUnbind = bindChatInlineImageLightboxClickDelegation(root, {
		bubbleSelector: '.connect-chat-msg-bubble',
		openHooks: { beforeOpen: closeReactionPicker },
	});
	root.addEventListener(
		'click',
		(e) => {
			if (!(root instanceof HTMLElement)) return;
			if (!(e.target instanceof Element)) return;
			const cardsHost = e.target.closest('[data-feed-channel-cards]');
			if (!cardsHost || !root.contains(cardsHost)) return;
			const link = e.target.closest('a[href]');
			if (!(link instanceof HTMLAnchorElement)) return;
			if (link.hasAttribute('data-profile-link')) return;
			const voteCta = link.closest('[data-engagement-vote-cta]');
			if (
				voteCta instanceof HTMLAnchorElement &&
				(voteCta.getAttribute('data-engagement-vote-action') || '').trim() ===
					'challenge_vote_modal'
			) {
				return;
			}
			/* Challenge engagement CTAs use card-level handlers + performShellNavigation (avoid SPA then reload). */
			if (
				link.closest('[data-engagement-enter-cta]') ||
				link.closest('[data-challenge-title-link]') ||
				link.closest('[data-engagement-vote-cta]') ||
				link.closest('[data-engagement-cta]')
			) {
				return;
			}
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			const hrefAttr = (link.getAttribute('href') || '').trim();
			if (!hrefAttr.startsWith('/')) return;
			const pathOnly = hrefAttr.split('?')[0].split('#')[0];
			const isFeedShellRoute =
				pathOnly === '/feed' ||
				pathOnly === '/explore' ||
				pathOnly === '/creations' ||
				pathOnly === '/challenges' ||
				pathOnly === '/create' ||
				pathOnly.startsWith('/chat/');
			if (!isFeedShellRoute) return;
			navigateWithinChatShell(hrefAttr, e);
		},
		true
	);
	root.addEventListener(
		'click',
		(e) => {
			if (!(root instanceof HTMLElement)) return;
			if (!(e.target instanceof Element)) return;
			const cardsHost = e.target.closest('[data-feed-channel-cards]');
			if (!cardsHost || !root.contains(cardsHost)) return;
			const imageWrap = e.target.closest('.feed-card-image--group-carousel');
			if (!(imageWrap instanceof HTMLElement)) return;
			if (e.target.closest('.feed-card-group-nav')) return;
			if (e.target.closest('[data-creations-bulk-overlay]')) return;
			const card = imageWrap.closest('.feed-card[data-creation-id]');
			if (!(card instanceof HTMLElement)) return;

			let galleryUrls = [];
			try {
				const raw = card.dataset.feedGroupCarouselUrls;
				if (raw) galleryUrls = JSON.parse(raw);
			} catch {
				galleryUrls = [];
			}
			if (!Array.isArray(galleryUrls) || galleryUrls.length < 2) {
				galleryUrls = Array.from(imageWrap.querySelectorAll('.feed-card-group-img'))
					.map((img) =>
						img instanceof HTMLImageElement ? String(img.currentSrc || img.src || '').trim() : ''
					)
					.filter(Boolean);
			}
			if (galleryUrls.length < 2) return;
			const cid = String(card.getAttribute('data-creation-id') || '').trim();
			if (!cid) return;
			e.preventDefault();
			e.stopPropagation();
			window.location.href = `/creations/${encodeURIComponent(cid)}`;
		},
		true
	);

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

	function canOpenPrivateChannelMembersModal() {
		return (
			!activePseudoChannelSlug &&
			Number.isFinite(Number(activeThreadId)) &&
			Number(activeThreadId) > 0 &&
			isPrivateChannelMeta(activeHeaderMeta)
		);
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
		appendDmViewProfileMenuItem(body);
		const channelLabel = root.querySelector('[data-chat-title]')?.textContent?.trim() || '';
		const ch = document.createElement('button');
		ch.type = 'button';
		ch.className = 'feed-card-menu-item';
		ch.dataset.chatMobileChromeOpenChannel = '';
		ch.setAttribute('role', 'menuitem');
		ch.textContent = channelLabel;
		if (!activeCanvasRow) ch.classList.add('chat-page-mobile-chrome-sheet-item--current');
		body.appendChild(ch);
		if (canOpenPrivateChannelMembersModal()) {
			const membersBtn = document.createElement('button');
			membersBtn.type = 'button';
			membersBtn.className = 'feed-card-menu-item';
			membersBtn.dataset.chatPrivateMembersOpen = '';
			membersBtn.setAttribute('role', 'menuitem');
			membersBtn.textContent = 'Members';
			body.appendChild(membersBtn);
		}
		if (chatChallengesOrganizerEligible && activePseudoChannelSlug === 'challenges') {
			const orgMb = document.createElement('button');
			orgMb.type = 'button';
			orgMb.className = 'feed-card-menu-item';
			orgMb.dataset.chatChallengesOrganizerOpen = '';
			orgMb.setAttribute('role', 'menuitem');
			orgMb.textContent = 'Organizer tools';
			if (isChallengesOrganizerSidebarOpen()) {
				orgMb.classList.add('chat-page-mobile-chrome-sheet-item--current');
			}
			body.appendChild(orgMb);
		}
		const canCreateCanvas = isActiveThreadCanvasEligible() && chatViewerIsFounder;
		const hasCanvasSection = chatCanvasesList.length > 0 || canCreateCanvas;
		if (hasCanvasSection) {
			const sectionLabel = document.createElement('div');
			sectionLabel.className = 'chat-page-menu-section-muted';
			sectionLabel.textContent = 'Canvases';
			body.appendChild(sectionLabel);
			for (const c of chatCanvasesList) {
				const row = document.createElement('div');
				row.className = 'chat-page-menu-canvas-row';
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'feed-card-menu-item chat-page-menu-canvas-open';
				b.dataset.chatCanvasOpen = String(c.id);
				b.setAttribute('role', 'menuitem');
				b.textContent = c.title;
				if (activeCanvasRow && Number(activeCanvasRow.id) === Number(c.id)) {
					b.classList.add('chat-page-mobile-chrome-sheet-item--current');
				}
				row.appendChild(b);
				const isOwner = Number(c?.sender_id) === Number(chatViewerId);
				if (isOwner) {
					const editInline = document.createElement('button');
					editInline.type = 'button';
					editInline.className = 'chat-page-menu-canvas-edit-inline';
					editInline.dataset.chatCanvasEditInline = String(c.id);
					editInline.setAttribute('role', 'menuitem');
					editInline.setAttribute('aria-label', `Edit canvas: ${String(c.title || 'Canvas')}`);
					editInline.innerHTML =
						'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
					row.appendChild(editInline);
				}
				body.appendChild(row);
			}
			if (canCreateCanvas) {
				const createBtn = document.createElement('button');
				createBtn.type = 'button';
				createBtn.className = 'feed-card-menu-item';
				createBtn.dataset.chatCanvasCreate = '';
				createBtn.setAttribute('role', 'menuitem');
				createBtn.textContent = 'Create canvas…';
				body.appendChild(createBtn);
			}
			const divider = document.createElement('div');
			divider.className = 'chat-page-mobile-chrome-sheet-divider';
			divider.setAttribute('aria-hidden', 'true');
			body.appendChild(divider);
		}
		const refresh = document.createElement('button');
		refresh.type = 'button';
		refresh.className = 'feed-card-menu-item';
		refresh.dataset.chatMobileChromeRefresh = '';
		refresh.setAttribute('role', 'menuitem');
		refresh.textContent = 'Refresh';
		body.appendChild(refresh);
		if (activeCanvasRow && isActiveThreadCanvasEligible()) {
			const isOwner = Number(activeCanvasRow.sender_id) === Number(chatViewerId);
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
			limitHint: chatCanvasScope.querySelector('[data-chat-canvas-limit-hint]'),
			editFooter: chatCanvasScope.querySelector('[data-chat-canvas-edit-footer]'),
			moreWrap: chatCanvasScope.querySelector('[data-chat-canvas-more-wrap]'),
			moreBtn: chatCanvasScope.querySelector('[data-chat-canvas-more]'),
			ownerMenu: chatCanvasScope.querySelector('[data-chat-canvas-owner-menu]')
		};
	}

	function isChallengesOrganizerSidebarOpen() {
		const orgShell = chatCanvasScope?.querySelector('[data-chat-challenges-organizer-sidebar]');
		return orgShell instanceof HTMLElement && !orgShell.hidden;
	}

	function closeChallengesOrganizerSidebar() {
		const defaultShell = chatCanvasScope?.querySelector('[data-chat-canvas-default-shell]');
		const orgShell = chatCanvasScope?.querySelector('[data-chat-challenges-organizer-sidebar]');
		const panel = getChatCanvasPanelEls().panel;
		forgetOpenOrganizerToolsForActiveThread();
		if (defaultShell instanceof HTMLElement) defaultShell.hidden = false;
		if (orgShell instanceof HTMLElement) orgShell.hidden = true;
		if (panel instanceof HTMLElement) {
			panel.hidden = true;
			panel.setAttribute('aria-label', 'Canvas');
		}
		setChatCanvasOpenBodyClass(false);
		rebuildTopbarMenuDynamic();
		syncTopbarPinnedCanvasButton();
	}

	function openChallengesOrganizerSidebar() {
		closeMobileChromeSheet();
		closeCanvasOwnerDropdown();
		closeTopbarMenu();
		const defaultShell = chatCanvasScope?.querySelector('[data-chat-canvas-default-shell]');
		const orgShell = chatCanvasScope?.querySelector('[data-chat-challenges-organizer-sidebar]');
		const panel = getChatCanvasPanelEls().panel;
		if (!(orgShell instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
		if (defaultShell instanceof HTMLElement) defaultShell.hidden = true;
		orgShell.hidden = false;
		panel.hidden = false;
		rememberOpenOrganizerToolsForActiveThread();
		panel.setAttribute('aria-label', 'Challenge organizer tools');
		setChatCanvasOpenBodyClass(true);
		rebuildTopbarMenuDynamic();
		syncTopbarPinnedCanvasButton();
	}

	function updateCanvasBodyLimitHint(inputEl, hintEl) {
		if (!(inputEl instanceof HTMLTextAreaElement) || !(hintEl instanceof HTMLElement)) return;
		const max = Number(inputEl.maxLength);
		if (!Number.isFinite(max) || max <= 0) {
			hintEl.hidden = true;
			hintEl.textContent = '';
			hintEl.classList.remove('is-at-limit');
			return;
		}
		const used = Math.min(max, String(inputEl.value || '').length);
		const left = Math.max(0, max - used);
		hintEl.hidden = false;
		hintEl.textContent = `${left}/${max} characters left`;
		if (left === 0) {
			hintEl.classList.add('is-at-limit');
			return;
		}
		hintEl.classList.remove('is-at-limit');
	}

	function setChatCanvasOpenBodyClass(on) {
		if (typeof document !== 'undefined' && document.body) {
			document.body.classList.toggle('chat-page--canvas-open', Boolean(on));
		}
		applyComposerState();
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
		if (el.panel instanceof HTMLElement) {
			el.panel.classList.remove('chat-page-canvas-panel--editing');
		}
		const rev = revert === true;
		if (rev && activeCanvasRow) {
			if (el.titleInput instanceof HTMLInputElement) el.titleInput.value = chatCanvasEditSnapshot.title;
			if (el.bodyInput instanceof HTMLTextAreaElement) el.bodyInput.value = chatCanvasEditSnapshot.body;
		}
		if (el.titleView instanceof HTMLElement) el.titleView.hidden = false;
		if (el.titleInput instanceof HTMLElement) el.titleInput.hidden = true;
		if (el.bodyView instanceof HTMLElement) el.bodyView.hidden = false;
		if (el.bodyInput instanceof HTMLElement) el.bodyInput.hidden = true;
		if (el.limitHint instanceof HTMLElement) {
			el.limitHint.hidden = true;
			el.limitHint.textContent = '';
			el.limitHint.classList.remove('is-at-limit');
		}
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = true;
		if (activeCanvasRow && Number(activeCanvasRow.sender_id) === Number(chatViewerId)) {
			if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = false;
		}
		if (activeCanvasRow) paintCanvasPanelReadOnly();
	}

	function normalizeCanvasOwnerUserName(raw) {
		const trimmed = typeof raw === 'string' ? raw.trim() : '';
		if (!trimmed) return '';
		return trimmed.replace(/^@+/, '');
	}

	function renderCanvasTitleWithOwnerMarkup(titleRaw, ownerUserNameRaw) {
		const title = String(titleRaw || '').trim() || 'Canvas';
		const ownerUserName = normalizeCanvasOwnerUserName(ownerUserNameRaw);
		if (!ownerUserName) {
			return `<span class="chat-page-canvas-title-main">${escapeHtml(title)}</span>`;
		}
		return `<span class="chat-page-canvas-title-main">${escapeHtml(title)}</span><span class="chat-page-canvas-title-owner-sep" aria-hidden="true">•</span><span class="chat-page-canvas-title-owner-muted">@${escapeHtml(ownerUserName)}</span>`;
	}

	function applyCanvasTitleWithOwner(el, titleRaw, ownerUserNameRaw) {
		if (!(el instanceof HTMLElement)) return;
		el.innerHTML = renderCanvasTitleWithOwnerMarkup(titleRaw, ownerUserNameRaw);
	}

	function paintCanvasPanelReadOnly() {
		const el = getChatCanvasPanelEls();
		if (!activeCanvasRow) return;
		applyCanvasTitleWithOwner(el.titleView, activeCanvasRow.title, activeCanvasRow.sender_user_name);
		if (el.bodyView instanceof HTMLElement) {
			/** Prefer server-rendered markdown HTML from GET …/canvases (`body_html`); else linkify plain text. */
			const serverHtml =
				typeof activeCanvasRow.body_html === 'string' ? activeCanvasRow.body_html.trim() : '';
			if (serverHtml) {
				el.bodyView.innerHTML = serverHtml;
				el.bodyView.classList.add('chat-page-canvas-body--markdown');
			} else {
				el.bodyView.innerHTML = processUserText(activeCanvasRow.body || '', { messageMarkdown: true }) + CANVAS_BODY_HTML_SUFFIX;
				el.bodyView.classList.remove('chat-page-canvas-body--markdown');
			}
			hydrateRichUserTextEmbeds(el.bodyView);
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
		if (el.panel instanceof HTMLElement) {
			el.panel.classList.add('chat-page-canvas-panel--editing');
		}
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
			el.bodyInput.maxLength = 4000;
			el.bodyInput.oninput = () => updateCanvasBodyLimitHint(el.bodyInput, el.limitHint);
			updateCanvasBodyLimitHint(el.bodyInput, el.limitHint);
		}
		if (el.editFooter instanceof HTMLElement) el.editFooter.hidden = false;
		if (el.moreWrap instanceof HTMLElement) el.moreWrap.hidden = true;
	}

	const CHAT_OPEN_CANVAS_BY_THREAD_LS = 'prsn-chat-open-canvas-by-thread-v1';
	const CHAT_OPEN_ORGANIZER_TOOLS_BY_THREAD_LS = 'prsn-chat-open-organizer-tools-by-thread-v1';

	function readOpenByThreadMap(storageKey) {
		try {
			const raw = window.localStorage?.getItem(storageKey);
			if (!raw) return {};
			const o = JSON.parse(raw);
			return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
		} catch {
			return {};
		}
	}

	function writeOpenByThreadMap(storageKey, map) {
		try {
			window.localStorage.setItem(storageKey, JSON.stringify(map));
		} catch {
			// ignore quota / private mode
		}
	}

	function setOpenByThreadPreference(storageKey, threadId, rawValue) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		const map = readOpenByThreadMap(storageKey);
		map[String(tid)] = rawValue;
		writeOpenByThreadMap(storageKey, map);
	}

	function forgetOpenByThreadPreference(storageKey, threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return;
		const map = readOpenByThreadMap(storageKey);
		if (map[String(tid)] == null) return;
		delete map[String(tid)];
		writeOpenByThreadMap(storageKey, map);
	}

	function rememberOpenCanvasForActiveThread(canvasMessageId) {
		const tid = activeThreadId;
		if (tid == null || !Number.isFinite(Number(tid)) || Number(tid) <= 0) return;
		const mid = Number(canvasMessageId);
		if (!Number.isFinite(mid) || mid <= 0) return;
		setOpenByThreadPreference(CHAT_OPEN_CANVAS_BY_THREAD_LS, tid, mid);
	}

	function forgetOpenCanvasForThread(threadId) {
		forgetOpenByThreadPreference(CHAT_OPEN_CANVAS_BY_THREAD_LS, threadId);
	}

	function getStoredOpenCanvasIdForThread(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return null;
		const v = readOpenByThreadMap(CHAT_OPEN_CANVAS_BY_THREAD_LS)[String(tid)];
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	function rememberOpenOrganizerToolsForActiveThread() {
		if (activeThreadId == null) return;
		setOpenByThreadPreference(CHAT_OPEN_ORGANIZER_TOOLS_BY_THREAD_LS, activeThreadId, 1);
	}

	function forgetOpenOrganizerToolsForActiveThread() {
		if (activeThreadId == null) return;
		forgetOpenByThreadPreference(CHAT_OPEN_ORGANIZER_TOOLS_BY_THREAD_LS, activeThreadId);
	}

	function isOpenOrganizerToolsStoredForThread(threadId) {
		const tid = Number(threadId);
		if (!Number.isFinite(tid) || tid <= 0) return false;
		const v = readOpenByThreadMap(CHAT_OPEN_ORGANIZER_TOOLS_BY_THREAD_LS)[String(tid)];
		return Number(v) === 1 || v === true;
	}

	function openChatCanvasPanel(row) {
		closeMobileChromeSheet();
		closeCanvasOwnerDropdown();
		const defaultShellOpen = chatCanvasScope.querySelector('[data-chat-canvas-default-shell]');
		const orgShellOpen = chatCanvasScope.querySelector('[data-chat-challenges-organizer-sidebar]');
		if (defaultShellOpen instanceof HTMLElement) defaultShellOpen.hidden = false;
		if (orgShellOpen instanceof HTMLElement) orgShellOpen.hidden = true;
		activeCanvasRow = {
			id: Number(row.id),
			title: String(row.title || '').trim(),
			body: row.body != null ? String(row.body) : '',
			body_html: typeof row.body_html === 'string' ? row.body_html : null,
			sender_id: Number(row.sender_id),
			sender_user_name:
				typeof row.sender_user_name === 'string' && row.sender_user_name.trim()
					? row.sender_user_name.trim()
					: null
		};
		const el = getChatCanvasPanelEls();
		if (el.panel instanceof HTMLElement) {
			el.panel.classList.remove('chat-page-canvas-panel--editing');
		}
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
		if (isChallengesOrganizerSidebarOpen()) {
			closeChallengesOrganizerSidebar();
			return;
		}
		if (forgetOpenPreference && activeThreadId != null) {
			forgetOpenCanvasForThread(activeThreadId);
		}
		closeMobileChromeSheet();
		closeCanvasOwnerDropdown();
		activeCanvasRow = null;
		const el = getChatCanvasPanelEls();
		if (el.panel instanceof HTMLElement) {
			el.panel.classList.remove('chat-page-canvas-panel--editing');
		}
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
				viewingPinnedInPanel
					? `Return to channel from pinned canvas: ${title}`
					: `Open pinned canvas: ${title}`
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
		appendDmViewProfileMenuItem(dyn);
		if (canOpenPrivateChannelMembersModal()) {
			const membersBtn = document.createElement('button');
			membersBtn.type = 'button';
			membersBtn.className = 'feed-card-menu-item';
			membersBtn.dataset.chatPrivateMembersOpen = '';
			membersBtn.setAttribute('role', 'menuitem');
			membersBtn.textContent = 'Members';
			dyn.appendChild(membersBtn);
		}

		if (activePseudoChannelSlug === 'creations') {
			const bulkBtn = document.createElement('button');
			bulkBtn.type = 'button';
			bulkBtn.className = 'feed-card-menu-item';
			bulkBtn.dataset.chatCreationsBulkActions = '';
			bulkBtn.setAttribute('role', 'menuitem');
			bulkBtn.textContent = 'Bulk actions';
			dyn.appendChild(bulkBtn);
		}
		if (chatChallengesOrganizerEligible && activePseudoChannelSlug === 'challenges') {
			const orgBtn = document.createElement('button');
			orgBtn.type = 'button';
			orgBtn.className = 'feed-card-menu-item';
			orgBtn.dataset.chatChallengesOrganizerOpen = '';
			orgBtn.setAttribute('role', 'menuitem');
			orgBtn.textContent = 'Organizer tools';
			dyn.appendChild(orgBtn);
		}
		const canCreateCanvas = isActiveThreadCanvasEligible() && chatViewerIsFounder;
		const hasCanvasSection = chatCanvasesList.length > 0 || canCreateCanvas;
		if (hasCanvasSection) {
			const sectionLabel = document.createElement('div');
			sectionLabel.className = 'chat-page-menu-section-muted';
			sectionLabel.textContent = 'Canvases';
			dyn.appendChild(sectionLabel);
			for (const c of chatCanvasesList) {
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'feed-card-menu-item';
				b.dataset.chatCanvasOpen = String(c.id);
				b.setAttribute('role', 'menuitem');
				b.textContent = c.title;
				dyn.appendChild(b);
			}
			if (canCreateCanvas) {
				const createBtn = document.createElement('button');
				createBtn.type = 'button';
				createBtn.className = 'feed-card-menu-item';
				createBtn.dataset.chatCanvasCreate = '';
				createBtn.setAttribute('role', 'menuitem');
				createBtn.textContent = 'Create canvas…';
				dyn.appendChild(createBtn);
			}
			const divider = document.createElement('div');
			divider.className = 'chat-page-menu-divider';
			divider.setAttribute('aria-hidden', 'true');
			dyn.appendChild(divider);
		}
		const refreshBtn = document.createElement('button');
		refreshBtn.type = 'button';
		refreshBtn.className = 'feed-card-menu-item';
		refreshBtn.dataset.chatMobileChromeRefresh = '';
		refreshBtn.setAttribute('role', 'menuitem');
		refreshBtn.textContent = 'Refresh';
		dyn.appendChild(refreshBtn);
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
					sender_id: Number(up.sender_id),
					sender_user_name:
						typeof up.sender_user_name === 'string' && up.sender_user_name.trim()
							? up.sender_user_name.trim()
							: null
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

		const bodyLimitHint = document.createElement('p');
		bodyLimitHint.className = 'chat-canvas-create-limit-hint';
		updateCanvasBodyLimitHint(bodyTa, bodyLimitHint);
		bodyTa.addEventListener('input', () => updateCanvasBodyLimitHint(bodyTa, bodyLimitHint));

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
		panel.appendChild(bodyLimitHint);
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
					const rowFromList = chatCanvasesList.find((c) => Number(c.id) === id) || null;
					const row = rowFromList || {
						id,
						title,
						body,
						sender_id: chatViewerId,
						sender_user_name: null
					};
					const meta = (await ensureThreadMetaById(tid)) || chatPrivateThreadMetaById(tid);
					if (
						isPrivateChannelThreadMeta(meta) &&
						String(row.body || '').trim() === '[Encrypted message]'
					) {
						// Keep author-visible plaintext for the just-created canvas panel even if
						// the immediate canvases refresh cannot decrypt yet.
						row.body = body;
						row.body_html = null;
					}
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

	function closePrivateChannelMembersOverlay() {
		if (typeof privateChannelMembersOverlayCleanup === 'function') {
			try {
				privateChannelMembersOverlayCleanup();
			} catch {
				// ignore
			}
			privateChannelMembersOverlayCleanup = null;
		}
	}

	function showPrivateChannelMembersOverlay() {
		closePrivateChannelMembersOverlay();
		if (!canOpenPrivateChannelMembersModal()) return;
		const tid = Number(activeThreadId);
		const overlay = document.createElement('div');
		overlay.className = 'modal-overlay open chat-private-members-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Private channel members');
		const panel = document.createElement('div');
		panel.className = 'modal chat-private-members-dialog';
		panel.innerHTML = `
			<div class="chat-private-members-head">
				<h2 class="chat-private-members-title">Members</h2>
				<button type="button" class="modal-close" data-chat-private-members-close aria-label="Close">
					<span class="modal-close-icon" aria-hidden="true">×</span>
				</button>
			</div>
			<div class="chat-private-members-body">
				<div class="chat-private-members-loading" data-chat-private-members-loading>Loading members…</div>
				<p class="chat-private-members-error" data-chat-private-members-error hidden></p>
				<div class="chat-private-members-table-wrap" data-chat-private-members-table-wrap hidden>
					<table class="chat-private-members-table">
						<thead>
							<tr>
								<th scope="col">User</th>
								<th scope="col">Status</th>
							</tr>
						</thead>
						<tbody data-chat-private-members-tbody></tbody>
					</table>
				</div>
			</div>
		`;
		overlay.appendChild(panel);
		document.body.appendChild(overlay);
		const loadingEl = panel.querySelector('[data-chat-private-members-loading]');
		const errEl = panel.querySelector('[data-chat-private-members-error]');
		const tableWrap = panel.querySelector('[data-chat-private-members-table-wrap]');
		const tbody = panel.querySelector('[data-chat-private-members-tbody]');
		const setError = (msg) => {
			if (loadingEl instanceof HTMLElement) loadingEl.hidden = true;
			if (tableWrap instanceof HTMLElement) tableWrap.hidden = true;
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = String(msg || 'Could not load members.');
			}
		};
		void (async () => {
			try {
				const res = await fetch(`/api/chat/threads/${tid}/member-status`, { credentials: 'include' });
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					setError(data?.message || data?.error || 'Could not load members.');
					return;
				}
				const list = Array.isArray(data?.members) ? data.members : [];
				if (!(tbody instanceof HTMLElement)) return;
				tbody.innerHTML = list
					.map((row) => {
						const userId = Number(row?.user_id);
						const userNameRaw =
							typeof row?.user_name === 'string' && row.user_name.trim() ? row.user_name.trim() : '';
						const display = userNameRaw ? `@${userNameRaw}` : `User ${userId}`;
						const avatarUrl =
							typeof row?.avatar_url === 'string' && row.avatar_url.trim() ? row.avatar_url.trim() : '';
						const statusRaw =
							String(row?.status || '').trim().toLowerCase() === 'joined' ? 'Joined' : 'Invited';
						const color = getAvatarColor(userNameRaw || String(userId));
						const avatarHtml = renderCommentAvatarHtml({
							avatarUrl,
							displayName: display,
							color,
							href: '',
							isFounder: false,
							flairSize: 'xs'
						});
						return `<tr>
							<td>
								<div class="chat-private-members-user-cell">
									${avatarHtml}
									<span class="chat-private-members-username">${escapeHtml(display)}</span>
								</div>
							</td>
							<td><span class="chat-private-members-status chat-private-members-status--${statusRaw.toLowerCase()}">${statusRaw}</span></td>
						</tr>`;
					})
					.join('');
				if (loadingEl instanceof HTMLElement) loadingEl.hidden = true;
				if (tableWrap instanceof HTMLElement) tableWrap.hidden = false;
			} catch {
				setError('Could not load members.');
			}
		})();
		const close = () => closePrivateChannelMembersOverlay();
		const onKey = (ev) => {
			if (ev.key === 'Escape') close();
		};
		overlay.addEventListener('click', (ev) => {
			if (ev.target === overlay || ev.target?.closest?.('[data-chat-private-members-close]')) close();
		});
		document.addEventListener('keydown', onKey);
		privateChannelMembersOverlayCleanup = () => {
			document.removeEventListener('keydown', onKey);
			overlay.remove();
		};
	}

	tearDownChatCanvasUi = () => {
		closeChatCanvasCreateOverlay();
		closePrivateChannelMembersOverlay();
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
		const dmProfileOpenEl = t.closest('[data-chat-dm-profile-open]');
		if (dmProfileOpenEl instanceof HTMLElement) {
			e.preventDefault();
			const href = dmProfileOpenEl.getAttribute('data-chat-dm-profile-open') || '';
			closeTopbarMenu();
			closeMobileChromeSheet();
			if (href.trim()) window.location.assign(href.trim());
			return;
		}
		if (t.closest('[data-chat-private-members-open]')) {
			e.preventDefault();
			closeTopbarMenu();
			closeMobileChromeSheet();
			showPrivateChannelMembersOverlay();
			return;
		}
		if (t.closest('[data-chat-challenges-organizer-open]')) {
			e.preventDefault();
			closeTopbarMenu();
			closeMobileChromeSheet();
			openChallengesOrganizerSidebar();
			return;
		}
		if (t.closest('[data-chat-challenges-organizer-close]')) {
			e.preventDefault();
			closeChallengesOrganizerSidebar();
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
		const editInlineEl = t.closest('[data-chat-canvas-edit-inline]');
		if (editInlineEl instanceof HTMLElement) {
			e.preventDefault();
			e.stopPropagation();
			closeTopbarMenu();
			closeMobileChromeSheet();
			const id = Number(editInlineEl.getAttribute('data-chat-canvas-edit-inline'));
			const row = chatCanvasesList.find((c) => Number(c.id) === id);
			if (row) {
				openChatCanvasPanel(row);
				enterCanvasEditUi();
			}
			return;
		}
		if (t.closest('[data-chat-canvas-close]')) {
			e.preventDefault();
			if (isChallengesOrganizerSidebarOpen()) {
				closeChallengesOrganizerSidebar();
				return;
			}
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
					const result = await patchChatMessage(mid, { title, body });
					if (!result.ok) {
						window.alert(result.error || 'Could not save');
						return;
					}
					const msgRow = result.message;
					if (msgRow) {
						const cm = getChatCanvasMetaFromMessage(msgRow);
						activeCanvasRow = {
							id: Number(msgRow.id),
							title: cm?.title || title,
							body: msgRow.body != null ? String(msgRow.body) : body,
							body_html: null,
							sender_id: Number(msgRow.sender_id),
							sender_user_name:
								typeof msgRow.sender_user_name === 'string' && msgRow.sender_user_name.trim()
									? msgRow.sender_user_name.trim()
									: null
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
	window.addEventListener('ps:challenge-vote-modal-request', (e) => {
		if (e instanceof CustomEvent) {
			e.preventDefault();
		}
		void openChallengeVoteModalFromFeedCard().catch(() => {
			window.location.href = '/challenges';
		});
	});
	window.addEventListener('hashchange', () => {
		setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
	});
	window.addEventListener('popstate', (e) => {
		// Vote modal / lightbox dismiss runs here before `chatSidebarPopstateHandler`. Without
		// stopImmediatePropagation, the second listener still runs: dismiss ref is already
		// cleared so it falls through to openThreadForCurrentPath() and leaves the lane.
		if (dismissChallengeVoteModalFromBrowserHistoryIfOpen()) {
			e.stopImmediatePropagation();
			return;
		}
		if (closeChatInlineImageLightboxFromPopstateIfOpen()) {
			e.stopImmediatePropagation();
			return;
		}
		setMobileSidebarMode(shouldShowMobileSidebarFromLocation());
	});
	document.addEventListener('prsn-chat-open-path', (e) => {
		chatCreationsNavigateDetail =
			e && typeof e === 'object' && e.detail && typeof e.detail === 'object'
				? e.detail
				: { forceFreshFirstPage: true };
		void openThreadForCurrentPath().finally(() => {
			chatCreationsNavigateDetail = null;
		});
	});

	async function acceptInviteFromHashIfPresent() {
		const hash = String(window.location.hash || '');
		const m = hash.match(/(?:^#|[?&])ci=([^&]+)/i);
		if (!m) return false;
		const token = decodeURIComponent(m[1] || '').trim();
		if (!token) return false;
		const res = await fetch('/api/chat/invites/accept', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ invite_token: token })
		});
		const data = await res.json().catch(() => ({}));
		const threadId = Number(data?.thread_id);
		history.replaceState({ prsnChat: true }, '', '/chat');
		if (!res.ok || !Number.isFinite(threadId) || threadId <= 0) {
			const errEl = root.querySelector('[data-chat-error]');
			if (errEl instanceof HTMLElement) {
				errEl.hidden = false;
				errEl.textContent = data?.message || data?.error || 'Invite could not be accepted.';
			}
			return false;
		}
		await loadChatThreads({ forceNetwork: true });
		await refreshChatSidebar({ skipThreadsFetch: true });
		history.replaceState({ prsnChat: true }, '', `/chat/t/${encodeURIComponent(String(threadId))}`);
		return true;
	}

	chatGlobalUnreadPoll = setInterval(() => void loadChatGlobalUnreadSummary(), 45000);
	void loadChatGlobalUnreadSummary();
	void hydrateAudibleNotificationsFromProfileOnce();
	enableLikeButtons(root);
	const shouldStartInMobileSidebar = shouldShowMobileSidebarFromLocation();
	setMobileSidebarMode(shouldStartInMobileSidebar);
	if (shouldStartInMobileSidebar) {
		// Prioritize sidebar data immediately for /chat#channels first paint.
		void refreshChatSidebar();
	}
	await acceptInviteFromHashIfPresent();
	await mountChatCreateComposer();
	await openThreadForCurrentPath();
	refreshChatCreateComposerModelsIfVisible();
	dispatchChatUnreadRefresh();
	/** Presence/UI poll: keep roster status fresh without force-refetching all thread metadata. */
	chatSidebarPollTimer = setInterval(() => void refreshChatSidebar({ skipThreadsFetch: true }), 30000);
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
