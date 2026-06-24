/**
 * Shared roster logic for Connect chat list and full-page chat sidebar (channels + DMs).
 */

import { getAvatarColor } from './avatar.js';
import { serverChannelTagFromServerName } from './serverChatTag.js';
import { readDmPinKeysOrdered } from './chatDmPins.js';
import { feedNavLabel, readFeedBetaEnabledSync } from './feedBetaNav.js';
import * as Icons from '../icons/svg-strings.js';

function escapeHtmlPseudoStrip(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Slugs for the fixed channel rows in the top strip (no section label) above DMs on chat + Connect sidebars.
 * Order: Feed, Challenges, My Creations, Comments, Explore, Prompt Library, Feedback.
 */
export const SIDEBAR_PSEUDO_STRIP_ORDER = ['feed', 'challenges', 'creations', 'comments', 'explore', 'prompt-library', 'feedback'];

/** Notes-to-self shortcut: not a channel, opens the viewer's own DM. */
export const SIDEBAR_NOTES_STRIP_HREF = '/chat/notes';

/** @type {Record<string, string>} */
const SIDEBAR_PSEUDO_STRIP_TITLES = {
	feed: 'Feed',
	challenges: 'Challenges',
	explore: 'Explore',
	'prompt-library': 'Prompt Library',
	creations: 'My Creations',
	comments: 'Comments',
	feedback: 'Feedback',
};

function creationsRouteIcon(className = '') {
	if (typeof Icons.pictureIcon === 'function') return Icons.pictureIcon(className);
	const cls = className ? ` class="${escapeHtmlPseudoStrip(className)}"` : '';
	return `<svg${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8" cy="10" r="2"></circle><path d="M21 17l-5-5L5 19"></path></svg>`;
}

function feedbackMegaphoneIcon(className = '') {
	if (typeof Icons.megaphoneIcon === 'function') return Icons.megaphoneIcon(className);
	const cls = className ? ` class="${escapeHtmlPseudoStrip(className)}"` : '';
	return `<svg${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"></path><path d="M8 6v8"></path></svg>`;
}

function pseudoStripRouteIconSvg(slug, routeIconClass = 'chat-page-sidebar-channel-route-icon') {
	const key = String(slug || '').trim().toLowerCase();
	if (!key) return '';
	const cls = String(routeIconClass || '').trim() || 'chat-page-sidebar-channel-route-icon';
	if (key === 'create' || key === 'creation') return creationsRouteIcon(cls);
	if (key === 'notes') return sidebarNotesStripIconSvg(cls);
	if (key === 'feed') return typeof Icons.homeIcon === 'function' ? Icons.homeIcon(cls) : '';
	if (key === 'challenges') return typeof Icons.trophyIcon === 'function' ? Icons.trophyIcon(cls) : '';
	if (key === 'explore') return typeof Icons.globeIcon === 'function' ? Icons.globeIcon(cls) : '';
	if (key === 'prompt-library') return typeof Icons.promptLibraryIcon === 'function' ? Icons.promptLibraryIcon(cls) : '';
	if (key === 'creations') return creationsRouteIcon(cls);
	if (key === 'comments') return typeof Icons.smsIcon === 'function' ? Icons.smsIcon(cls) : '';
	if (key === 'feedback') return feedbackMegaphoneIcon(cls);
	return '';
}

/** SVG markup for pseudo-strip slugs (feed, creations, …); same icons as mobile nav / sidebar strip. */
export function getPseudoStripRouteIconHtml(slug, routeIconClass) {
	return pseudoStripRouteIconSvg(slug, routeIconClass);
}

function pseudoStripRouteIconAvatarHtml(slug) {
	const icon = pseudoStripRouteIconSvg(slug);
	if (!icon) return null;
	return `<div class="comment-avatar connect-chat-thread-row-channel-avatar chat-page-sidebar-channel-avatar chat-page-sidebar-channel-avatar--icon-only" aria-hidden="true">${icon}</div>`;
}

/** Display label for a pseudo strip channel — same string as the sidebar row (use for chat header / tab title). */
export function getSidebarPseudoChannelTitle(channelSlug) {
	const s = String(channelSlug ?? '')
		.toLowerCase()
		.trim();
	if (!s) return null;
	const base = SIDEBAR_PSEUDO_STRIP_TITLES[s] ?? null;
	if (!base) return null;
	if (s === 'feed') return feedNavLabel(base);
	return base;
}

function pseudoStripTitleForSlug(slug, opts = {}) {
	const key = String(slug || '').trim().toLowerCase();
	const base = SIDEBAR_PSEUDO_STRIP_TITLES[key] || `#${key}`;
	if (key !== 'feed') return base;
	const enabled =
		opts.feedBetaEnabled === true ||
		(opts.feedBetaEnabled !== false && readFeedBetaEnabledSync());
	return feedNavLabel(base, enabled);
}

/**
 * Normalize `channel_slug` for header/server matching; infer strip slug from title when slug is missing.
 * @param {{ type?: string, channel_slug?: unknown, title?: unknown } | null | undefined} meta
 */
export function inferPseudoStripSlugFromChannelMeta(meta) {
	if (!meta || meta.type !== 'channel') return '';
	const direct =
		meta.channel_slug != null && String(meta.channel_slug).trim()
			? String(meta.channel_slug).trim().toLowerCase()
			: '';
	if (direct) return direct;

	const title = typeof meta.title === 'string' ? meta.title.trim() : '';
	if (title.startsWith('#')) {
		return title.slice(1).trim().toLowerCase();
	}
	for (const slug of SIDEBAR_PSEUDO_STRIP_ORDER) {
		const lab = SIDEBAR_PSEUDO_STRIP_TITLES[slug];
		if (lab && lab.trim().toLowerCase() === title.toLowerCase()) return slug;
	}
	return '';
}

/** Exclude these from the collapsible “Channels” list — they render only in the top strip. */
export const SIDEBAR_TOP_STRIP_CHANNEL_SLUGS = new Set(
	SIDEBAR_PSEUDO_STRIP_ORDER.map((s) => s.toLowerCase())
);

/**
 * Strip slugs that mirror primary app chrome: `app-navigation` links in `pages/app.html` (feed, explore, creations)
 * and the same `data-route` values on `app-navigation-mobile` (`public/components/navigation/mobile.js`).
 * Rows get class `chat-page-sidebar-row--also-in-app-primary-nav` where layout/CSS hides dupes of header / mobile nav.
 */
export const SIDEBAR_STRIP_SLUGS_ALSO_IN_APP_PRIMARY_NAV = new Set(['feed', 'explore', 'creations']);

/**
 * Synthetic channel rows appended for the **Channels** section (none today — strip covers reserved slugs).
 */
export const RESERVED_PSEUDO_CHANNEL_SLUGS = [];

/**
 * Sort priority within the Channels section only (empty: order by activity only).
 */
export const SIDEBAR_CHANNEL_PRIORITY_FIRST = [];

/**
 * Put priority channel rows first (see SIDEBAR_CHANNEL_PRIORITY_FIRST), then the rest), stable order within each tier.
 * @param {object[]} threads
 */
export function sortChatSidebarRowsPriority(threads) {
	const list = Array.isArray(threads) ? [...threads] : [];
	const rank = (t) => {
		if (t?.type === 'channel' && t.channel_slug) {
			const s = String(t.channel_slug).toLowerCase();
			const i = SIDEBAR_CHANNEL_PRIORITY_FIRST.indexOf(s);
			if (i >= 0) return i;
		}
		return SIDEBAR_CHANNEL_PRIORITY_FIRST.length;
	};
	list.sort((a, b) => {
		const ra = rank(a);
		const rb = rank(b);
		if (ra !== rb) return ra - rb;
		return 0;
	});
	return list;
}

/** @param {object | null | undefined} row */
export function rowUnreadCount(row) {
	const n = Number(row?.unread_count);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** @param {object | null | undefined} row */
export function rowLastActivityMs(row) {
	const lm = row?.last_message;
	if (!lm || lm.created_at == null) return 0;
	const ms = Date.parse(String(lm.created_at));
	return Number.isFinite(ms) ? ms : 0;
}

/** @param {object | null | undefined} t */
function channelLastActivityMs(t) {
	return rowLastActivityMs(t);
}

/**
 * Keep base order stable, but ensure the collapsed visible window contains the
 * most recent unread rows before read rows.
 * @param {object[]} rows
 * @param {{
 *   visibleCap?: number,
 *   preserveHeadCount?: number,
 *   getUnreadCount?: ((row: object) => number) | null,
 *   getLastActivityMs?: ((row: object) => number) | null,
 * }} [opts]
 */
export function prioritizeUnreadRowsInVisibleWindow(rows, opts = {}) {
	const list = Array.isArray(rows) ? [...rows] : [];
	if (list.length <= 1) return list;
	const capRaw = Number(opts?.visibleCap);
	const cap =
		Number.isFinite(capRaw) && capRaw > 0
			? Math.floor(capRaw)
			: CHAT_SIDEBAR_COLLAPSE_LIST_CAP;
	if (cap <= 0) return list;

	const preserveRaw = Number(opts?.preserveHeadCount);
	const preserveHeadCount =
		Number.isFinite(preserveRaw) && preserveRaw > 0
			? Math.min(Math.floor(preserveRaw), cap, list.length)
			: 0;
	const visibleSlots = Math.min(cap, list.length) - preserveHeadCount;
	if (visibleSlots <= 0) return list;

	const getUnreadCount =
		typeof opts?.getUnreadCount === 'function' ? opts.getUnreadCount : rowUnreadCount;
	const getLastActivityMs =
		typeof opts?.getLastActivityMs === 'function' ? opts.getLastActivityMs : rowLastActivityMs;
	const preserved = list.slice(0, preserveHeadCount);
	const candidates = list.slice(preserveHeadCount);
	const unreadRanked = [];
	for (let i = 0; i < candidates.length; i += 1) {
		const row = candidates[i];
		const unread = getUnreadCount(row);
		if (unread > 0) {
			unreadRanked.push({
				i,
				row,
				unread,
				lastActivityMs: getLastActivityMs(row)
			});
		}
	}
	unreadRanked.sort((a, b) => {
		if (a.lastActivityMs !== b.lastActivityMs) return b.lastActivityMs - a.lastActivityMs;
		if (a.unread !== b.unread) return b.unread - a.unread;
		return a.i - b.i;
	});
	const selected = [];
	const selectedIdxs = new Set();
	for (const item of unreadRanked) {
		if (selected.length >= visibleSlots) break;
		selected.push(item.row);
		selectedIdxs.add(item.i);
	}
	for (let i = 0; i < candidates.length && selected.length < visibleSlots; i += 1) {
		if (selectedIdxs.has(i)) continue;
		selected.push(candidates[i]);
		selectedIdxs.add(i);
	}
	const rest = [];
	for (let i = 0; i < candidates.length; i += 1) {
		if (!selectedIdxs.has(i)) rest.push(candidates[i]);
	}
	return [...preserved, ...selected, ...rest];
}

/**
 * Order channel rows: priority slugs first (see SIDEBAR_CHANNEL_PRIORITY_FIRST), then
 * newest `last_message` first. Rows with no last message sort after, by slug for stability.
 * @param {object[]} channelRows
 */
export function sortChannelRowsByLastActivity(channelRows) {
	const list = Array.isArray(channelRows) ? channelRows.filter((t) => t && t.type === 'channel') : [];
	const priority = [];
	const rest = [];
	for (const t of list) {
		const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
		const pi = SIDEBAR_CHANNEL_PRIORITY_FIRST.indexOf(slug);
		if (pi >= 0) priority.push({ t, pi });
		else rest.push(t);
	}
	priority.sort((a, b) => {
		if (a.pi !== b.pi) return a.pi - b.pi;
		return channelLastActivityMs(b.t) - channelLastActivityMs(a.t);
	});
	rest.sort((a, b) => {
		const d = channelLastActivityMs(b) - channelLastActivityMs(a);
		if (d !== 0) return d;
		const sa = String(a?.channel_slug || '').toLowerCase();
		const sb = String(b?.channel_slug || '').toLowerCase();
		return sa.localeCompare(sb);
	});
	return [...priority.map((x) => x.t), ...rest];
}

/**
 * Append synthetic channel rows for the **Channels** section only.
 * Feed / explore / creations / comments / feedback render in the top strip, not here.
 * @param {object[]} threads
 */
export function appendReservedPseudoChannels(threads) {
	const list = Array.isArray(threads) ? [...threads] : [];
	const slugs = new Set();
	for (const t of list) {
		if (t && t.type === 'channel' && t.channel_slug) {
			slugs.add(String(t.channel_slug).toLowerCase());
		}
	}
	for (const slug of RESERVED_PSEUDO_CHANNEL_SLUGS) {
		if (!slugs.has(slug)) {
			list.push({
				type: 'channel',
				channel_slug: slug,
				title: `#${slug}`,
				unread_count: 0,
				last_read_message_id: null,
			});
		}
	}
	return sortChatSidebarRowsPriority(list);
}

/**
 * Thread-shaped rows for the sidebar top strip (plain titles, same URLs as /chat/c/:slug).
 * @returns {object[]}
 */
export function buildSidebarPseudoStripRows() {
	return SIDEBAR_PSEUDO_STRIP_ORDER.map((slug) => ({
		type: 'channel',
		channel_slug: slug,
		title: pseudoStripTitleForSlug(slug),
		unread_count: 0,
		last_read_message_id: null,
	}));
}

/**
 * Top-strip slug when the request path is a pseudo channel URL (`/chat/c/:slug`), else null.
 * @param {string} [requestPath]
 * @returns {string | null}
 */
export function pseudoStripActiveSlugFromRequestPath(requestPath) {
	const raw = String(requestPath || '').trim();
	if (!raw) return null;
	const pathOnly = stripRequestPathname(raw);
	if (pathOnly === '/prompt-library') return 'prompt-library';
	const match = raw.match(/\/chat\/c\/([^/?#]+)/);
	if (!match) return null;
	try {
		const slug = decodeURIComponent(match[1]).trim().toLowerCase();
		if (SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) return slug;
	} catch {
		return null;
	}
	return null;
}

function stripRequestPathname(requestPath) {
	const s = String(requestPath || '').trim();
	if (!s) return '';
	try {
		if (s.startsWith('http://') || s.startsWith('https://')) return new URL(s).pathname;
	} catch {
		return '';
	}
	const noQuery = s.split('?')[0].split('#')[0];
	if (!noQuery) return '';
	return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
}

function sidebarNotesStripIconSvg(routeIconClass = 'chat-page-sidebar-channel-route-icon') {
	const cls = String(routeIconClass || '').trim() || 'chat-page-sidebar-channel-route-icon';
	if (typeof Icons.notesIcon === 'function') return Icons.notesIcon(cls);
	return `<svg class="${escapeHtmlPseudoStrip(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5m0 2.25a2.25 2.25 0 0 1 2.25 -2.25h11.5a2.25 2.25 0 0 1 2.25 2.25v14.5a2.25 2.25 0 0 1 -2.25 2.25h-11.5a2.25 2.25 0 0 1 -2.25 -2.25z"></path><path d="M8.25 7l7.5 0"></path><path d="M8.25 11.5l7.5 0"></path><path d="M8.25 16l5 0"></path></svg>`;
}

function sidebarNotesStripAvatarHtml() {
	const icon = sidebarNotesStripIconSvg();
	return `<div class="comment-avatar connect-chat-thread-row-channel-avatar chat-page-sidebar-channel-avatar chat-page-sidebar-channel-avatar--icon-only" aria-hidden="true">${icon}</div>`;
}

/** True when `requestPath` is the notes-to-self shortcut. */
export function isSidebarNotesPathActive(requestPath) {
	const path = stripRequestPathname(requestPath);
	return path === SIDEBAR_NOTES_STRIP_HREF;
}

/** Strip row object for the notes-to-self shortcut. */
export function buildSidebarNotesStripRow() {
	return { type: 'sidebar_notes', title: 'My Notes', href: SIDEBAR_NOTES_STRIP_HREF };
}

export function buildSidebarNotesStripAnchorHtml(requestPath = '') {
	const activeCls = isSidebarNotesPathActive(requestPath) ? ' is-active' : '';
	const avatarHtml = sidebarNotesStripAvatarHtml();
	return `<a class="chat-page-sidebar-row chat-page-sidebar-row--sidebar-notes${activeCls}" href="${escapeHtmlPseudoStrip(SIDEBAR_NOTES_STRIP_HREF)}" data-chat-sidebar-notes="1">
				${avatarHtml}
				<div class="chat-page-sidebar-row-body">
					<div class="chat-page-sidebar-row-title-line">
						<span class="chat-page-sidebar-row-title">My Notes</span>
					</div>
				</div>
			</a>`;
}

/**
 * Initial HTML for the pseudo strip (same row shape as `rowHtml` in chat / Connect).
 * Server injects into `pages/chat.html` via `{{CHAT_SIDEBAR_PSEUDO_STRIP_LIST}}`; Connect uses this after `loadDeps`.
 * @param {string} [requestPath] — e.g. Express `req.path` so the current pseudo channel can show `is-active` on first paint.
 * @returns {string}
 */
export function buildSidebarPseudoStripListStaticHtml(requestPath = '', opts = {}) {
	const activeSlug = pseudoStripActiveSlugFromRequestPath(requestPath);
	const channelHtml = SIDEBAR_PSEUDO_STRIP_ORDER.map((slug) => {
		const title = pseudoStripTitleForSlug(slug, opts);
		const href = slug === 'prompt-library'
			? '/prompt-library'
			: `/chat/c/${encodeURIComponent(slug)}`;
		const bg = getAvatarColor(slug);
		const iconAvatarHtml = pseudoStripRouteIconAvatarHtml(slug);
		const avatarHtml = iconAvatarHtml || `<div class="comment-avatar connect-chat-thread-row-channel-avatar chat-page-sidebar-channel-avatar" style="background: ${escapeHtmlPseudoStrip(bg)};" aria-hidden="true">#</div>`;
		const navDup = SIDEBAR_STRIP_SLUGS_ALSO_IN_APP_PRIMARY_NAV.has(slug);
		const navCls = navDup ? ' chat-page-sidebar-row--also-in-app-primary-nav' : '';
		const activeCls = activeSlug === slug ? ' is-active' : '';
		const feedBetaCls = slug === 'feed' && title.includes('[beta]') ? ' chat-page-sidebar-row--feed-beta' : '';
		const notesHtml = slug === 'creations' ? buildSidebarNotesStripAnchorHtml(requestPath) : '';
		const feedNavAttr = slug === 'feed' ? ' data-feed-nav="feed"' : '';
		return `<a class="chat-page-sidebar-row${navCls}${activeCls}${feedBetaCls}" href="${escapeHtmlPseudoStrip(href)}" data-chat-pseudo-slug="${escapeHtmlPseudoStrip(slug)}">
				${avatarHtml}
				<div class="chat-page-sidebar-row-body">
					<div class="chat-page-sidebar-row-title-line">
						<span class="chat-page-sidebar-row-title"${feedNavAttr}>${escapeHtmlPseudoStrip(title)}</span>
					</div>
				</div>
			</a>${notesHtml}`;
	}).join('');
	return channelHtml;
}

/**
 * Strip rows with API thread data merged in (unread, ids) when GET /api/chat/threads returned those channels.
 * @param {object[]} channelRowsRaw from merged roster (`type === 'channel'` slice is fine).
 * @returns {object[]}
 */
export function getSidebarPseudoStripRowsMerged(channelRowsRaw) {
	const stubs = buildSidebarPseudoStripRows();
	const list = Array.isArray(channelRowsRaw) ? channelRowsRaw : [];
	const bySlug = new Map();
	for (const t of list) {
		if (!t || t.type !== 'channel') continue;
		const slug = typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
		if (slug && SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) bySlug.set(slug, t);
	}
	const mergedChannels = stubs.map((stub) => {
		const key = String(stub.channel_slug || '').toLowerCase();
		const api = bySlug.get(key);
		if (!api) return stub;
		return { ...api, title: stub.title };
	});
	const out = [];
	for (const row of mergedChannels) {
		out.push(row);
		if (row?.type === 'channel' && String(row.channel_slug || '').toLowerCase() === 'creations') {
			out.push(buildSidebarNotesStripRow());
		}
	}
	return out;
}

/** @param {object} meta */
export function buildChatThreadUrl(meta) {
	if (!meta) return '/connect#chat';
	if (meta.type === 'sidebar_notes') {
		return SIDEBAR_NOTES_STRIP_HREF;
	}
	if (meta.type === 'channel' && meta.channel_slug) {
		const slug = String(meta.channel_slug).trim().toLowerCase();
		if (slug === 'prompt-library') return '/prompt-library';
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

/** Same rules as chat sidebar `normalizePathForCompare` — keep pseudo-strip active state aligned. */
export function normalizeChatNavPathForCompare(p) {
	const s = String(p || '')
		.replace(/\/+$/, '')
		.trim();
	if (!s || s === '/index.html' || s === '/feed') return '/chat/c/feed';
	if (s === '/explore') return '/chat/c/explore';
	if (s === '/creations') return '/chat/c/creations';
	if (s === '/prompt-library') return '/prompt-library';
	if (s === SIDEBAR_NOTES_STRIP_HREF) return SIDEBAR_NOTES_STRIP_HREF;
	return s;
}

/** Matches server `normalizeDmUsernameInput` / profile handle rules (user.js). Align with chatPage `normalizeDmPathUsername`. */
function normalizeDmPathUsernameForSidebar(raw) {
	if (typeof raw !== 'string') return null;
	let s = raw.trim();
	if (!s) return null;
	if (s.startsWith('@')) s = s.slice(1).trim();
	s = s.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(s)) return null;
	return s;
}

/**
 * Same URL shapes as chatPage `parseChatPathname` — used so sidebar `is-active` matches canonical `/chat/t/:id` URLs.
 * @param {string} pathname
 * @returns {{ kind: 'empty' } | { kind: 'invalid' } | { kind: 'thread', threadId: number } | { kind: 'channel', slug: string } | { kind: 'dm', userId: number } | { kind: 'dm', userName: string } | { kind: 'dm', self: true }}
 */
export function parseChatSidebarPathname(pathname) {
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
		if (/^\d+$/.test(rawSeg)) {
			const uid = Number(rawSeg);
			if (Number.isFinite(uid) && uid > 0) return { kind: 'dm', userId: uid };
			return { kind: 'invalid' };
		}
		const un = normalizeDmPathUsernameForSidebar(rawSeg);
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
 * @param {string} href
 * @returns {string}
 */
function chatSidebarHrefPathnameOnly(href) {
	if (typeof href !== 'string') return '';
	const h = href.trim();
	if (!h) return '';
	if (h.startsWith('/')) {
		return h.split('?')[0].split('#')[0];
	}
	if (typeof window === 'undefined' || !window.location?.origin) return '';
	try {
		return new URL(h, window.location.origin).pathname;
	} catch {
		return '';
	}
}

/**
 * @param {{ kind?: string, slug?: string, threadId?: number, userId?: number, userName?: string, self?: boolean }} parsed
 * @param {object[]} threads
 * @param {unknown} viewerId
 * @returns {number | null}
 */
function resolveSidebarThreadIdForParsed(parsed, threads, viewerId) {
	if (!parsed || parsed.kind === 'invalid' || parsed.kind === 'empty') return null;
	if (parsed.kind === 'thread') {
		const id = Number(parsed.threadId);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
	const list = Array.isArray(threads) ? threads : [];
	if (parsed.kind === 'channel') {
		const slug = String(parsed.slug || '').trim().toLowerCase();
		if (!slug) return null;
		const ch = list.find(
			(t) =>
				t &&
				t.type === 'channel' &&
				String(t.channel_slug || '')
					.trim()
					.toLowerCase() === slug
		);
		if (!ch) return null;
		const id = Number(ch.id);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
	if (parsed.kind === 'dm') {
		if ('self' in parsed && parsed.self === true) {
			const selfDm = list.find((t) => isSelfDmThread(t, viewerId));
			if (!selfDm) return null;
			const id = Number(selfDm.id);
			return Number.isFinite(id) && id > 0 ? id : null;
		}
		const uid = 'userId' in parsed && parsed.userId != null ? Number(parsed.userId) : null;
		const userName =
			'userName' in parsed && parsed.userName ? String(parsed.userName).toLowerCase() : '';
		const dm = list.find((t) => {
			if (!t || t.type !== 'dm') return false;
			if (uid != null && Number.isFinite(uid) && uid > 0) {
				return Number(getDmOtherUserId(t)) === uid;
			}
			if (userName) {
				const o = String(t.other_user?.user_name || '').toLowerCase();
				return o === userName;
			}
			return false;
		});
		if (!dm) return null;
		const id = Number(dm.id);
		return Number.isFinite(id) && id > 0 ? id : null;
	}
	return null;
}

/**
 * Whether `href` points at the current chat location, including when the URL was canonicalized to `/chat/t/:id`
 * while the sidebar still links via `/chat/dm/…` or `/chat/c/:slug`.
 *
 * @param {string} href
 * @param {{ pathname?: string, threads?: object[], viewerId?: unknown }} [ctx]
 */
export function isChatSidebarHrefActive(href, ctx = {}) {
	const pathnameRaw =
		typeof ctx.pathname === 'string'
			? ctx.pathname
			: typeof window !== 'undefined'
				? window.location.pathname
				: '';
	const curPath = String(pathnameRaw || '').replace(/\/+$/, '') || '/';
	const hrefPathRaw = chatSidebarHrefPathnameOnly(href);
	const hrefPath = String(hrefPathRaw || '').replace(/\/+$/, '') || '/';
	if (!hrefPathRaw) return false;

	if (normalizeChatNavPathForCompare(curPath) === normalizeChatNavPathForCompare(hrefPath)) {
		return true;
	}

	const cur = parseChatSidebarPathname(curPath);
	const target = parseChatSidebarPathname(hrefPath);
	if (cur.kind === 'invalid' || target.kind === 'invalid') return false;

	if (cur.kind === 'channel' && target.kind === 'channel') {
		return String(cur.slug || '').toLowerCase() === String(target.slug || '').toLowerCase();
	}

	if (cur.kind === 'thread' && target.kind === 'thread') {
		return Number(cur.threadId) === Number(target.threadId);
	}

	const threads = Array.isArray(ctx.threads) ? ctx.threads : [];
	const viewerId = ctx.viewerId;
	const curTid = resolveSidebarThreadIdForParsed(cur, threads, viewerId);
	const targetTid = resolveSidebarThreadIdForParsed(target, threads, viewerId);
	if (
		curTid != null &&
		targetTid != null &&
		Number.isFinite(curTid) &&
		Number.isFinite(targetTid) &&
		curTid > 0 &&
		targetTid > 0
	) {
		return curTid === targetTid;
	}

	return false;
}

/** Whether `href` is the current chat pseudo thread (standalone or in-app). */
export function isChatPseudoStripHrefActive(href) {
	if (typeof window === 'undefined') return false;
	const cur = normalizeChatNavPathForCompare(window.location.pathname);
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
	return normalizeChatNavPathForCompare(pathOnly) === cur;
}

/**
 * When the pseudo list was SSR’d or pre-filled with the same strip rows, update href / active /
 * unread in place. Does not replace avatars (avoids hydrate flash); does not set innerHTML.
 * @param {HTMLElement} listEl
 * @param {object[]} stripRows from {@link getSidebarPseudoStripRowsMerged}
 * @param {{ normalizePathForCompare: (p: string) => string, isChatHrefActive: (href: string) => boolean }} nav
 * @returns {boolean}
 */
export function tryPatchPseudoStripDomInPlace(listEl, stripRows, nav) {
	const { normalizePathForCompare, isChatHrefActive } = nav;
	if (
		!(listEl instanceof HTMLElement) ||
		!nav ||
		typeof nav.normalizePathForCompare !== 'function' ||
		typeof nav.isChatHrefActive !== 'function'
	) {
		return false;
	}
	const rows = Array.isArray(stripRows) ? stripRows : [];
	const anchors = [
		...listEl.querySelectorAll(':scope > a.chat-page-sidebar-row:not([data-chat-sidebar-strip-create])')
	];
	if (anchors.length !== rows.length) return false;
	const hrefBase =
		typeof window !== 'undefined' && window.location?.href ? window.location.href : 'http://localhost/';
	const navDupSlugs = SIDEBAR_STRIP_SLUGS_ALSO_IN_APP_PRIMARY_NAV;
	for (let i = 0; i < rows.length; i++) {
		const t = rows[i];
		const a = anchors[i];
		if (t?.type === 'sidebar_notes') {
			if (a.getAttribute('data-chat-sidebar-notes') !== '1') return false;
			let wantPath;
			let curPath;
			try {
				wantPath = normalizePathForCompare(new URL(buildChatThreadUrl(t), hrefBase).pathname);
				curPath = normalizePathForCompare(new URL(a.getAttribute('href') || '', hrefBase).pathname);
			} catch {
				return false;
			}
			if (curPath !== wantPath) return false;
		} else {
			const wantSlug =
				t?.type === 'channel' && typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
			if (!wantSlug) return false;
			const fromDom = a.getAttribute('data-chat-pseudo-slug');
			if (fromDom) {
				if (fromDom.toLowerCase() !== wantSlug) return false;
			} else {
				let wantPath;
				let curPath;
				try {
					wantPath = normalizePathForCompare(new URL(buildChatThreadUrl(t), hrefBase).pathname);
					curPath = normalizePathForCompare(new URL(a.getAttribute('href') || '', hrefBase).pathname);
				} catch {
					return false;
				}
				if (curPath !== wantPath) return false;
			}
		}
		const titleLine = a.querySelector(':scope > .chat-page-sidebar-row-body .chat-page-sidebar-row-title-line');
		if (!titleLine) return false;
	}
	for (let i = 0; i < rows.length; i++) {
		const t = rows[i];
		const a = anchors[i];
		const href = buildChatThreadUrl(t);
		const active = typeof isChatHrefActive === 'function' ? isChatHrefActive(href) : false;
		const slug =
			t?.type === 'channel' && typeof t.channel_slug === 'string' ? t.channel_slug.trim().toLowerCase() : '';
		a.setAttribute('href', href);
		if (t?.type === 'sidebar_notes') {
			a.setAttribute('data-chat-sidebar-notes', '1');
			a.removeAttribute('data-chat-pseudo-slug');
		} else if (slug) {
			a.setAttribute('data-chat-pseudo-slug', slug);
			a.removeAttribute('data-chat-sidebar-notes');
		}
		a.classList.toggle('is-active', active);
		a.classList.toggle('chat-page-sidebar-row--also-in-app-primary-nav', Boolean(slug && navDupSlugs.has(slug)));
		const titleLine = a.querySelector(':scope > .chat-page-sidebar-row-body .chat-page-sidebar-row-title-line');
		if (!titleLine) return false;
		titleLine.querySelectorAll('.chat-page-sidebar-unread').forEach((el) => el.remove());
		const unc = Number(t.unread_count);
		const showUnread = t?.type === 'channel' && !active && Number.isFinite(unc) && unc > 0;
		if (showUnread) {
			const unreadLabel = unc > 99 ? '99+' : String(unc);
			const span = typeof document !== 'undefined' ? document.createElement('span') : null;
			if (span) {
				span.className = 'chat-page-sidebar-unread';
				span.setAttribute('aria-label', `${unc} unread`);
				span.textContent = unreadLabel;
				titleLine.appendChild(span);
			}
		}
	}
	return true;
}

/**
 * Merge GET /api/chat/threads with joined-server channel suggestions (same rules as Connect tab).
 * @param {object[]} threads
 * @param {{ id: number, name: string }[]} joinedServers
 */
export function mergeThreadRowsWithJoinedServers(threads, joinedServers) {
	const list = Array.isArray(threads) ? threads : [];
	const existingSlugs = new Set();
	for (const t of list) {
		if (t && t.type === 'channel' && t.channel_slug) {
			existingSlugs.add(String(t.channel_slug).toLowerCase());
		}
	}
	const joined = Array.isArray(joinedServers) ? joinedServers : [];
	const joinedSorted = [...joined].sort((a, b) => Number(a.id) - Number(b.id));
	const extras = [];
	const usedExtraSlugs = new Set();
	for (const s of joinedSorted) {
		const nameRaw = typeof s?.name === 'string' ? s.name : '';
		const slug = serverChannelTagFromServerName(nameRaw);
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
	return [...list, ...extras];
}

/**
 * Avatar HTML for a thread row (channel # or DM avatar).
 * @param {object} t
 * @param {{ renderCommentAvatarHtml: Function, getAvatarColor: Function }} deps
 */
export function buildChatThreadRowAvatarHtml(t, deps) {
	const { renderCommentAvatarHtml, getAvatarColor } = deps;
	if (t?.type === 'sidebar_notes') {
		return sidebarNotesStripAvatarHtml();
	}
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
	const serverAvatarUrl =
		typeof t?.server_avatar_url === 'string' ? t.server_avatar_url.trim() : '';
	if (serverAvatarUrl) {
		const channelDisplayName =
			(typeof t?.title === 'string' && t.title.trim()) ||
			(typeof t?.channel_slug === 'string' && t.channel_slug.trim()) ||
			'Server';
		return renderCommentAvatarHtml({
			avatarUrl: serverAvatarUrl,
			displayName: channelDisplayName,
			color: getAvatarColor(String(channelDisplayName).toLowerCase()),
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
	const slugKey = slugRaw.toLowerCase();
	if (SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slugKey)) {
		const iconAvatarHtml = pseudoStripRouteIconAvatarHtml(slugKey);
		if (iconAvatarHtml) return iconAvatarHtml;
	}
	const color = getAvatarColor(slugRaw.toLowerCase() || 'channel');
	return `<div class="comment-avatar connect-chat-thread-row-channel-avatar chat-page-sidebar-channel-avatar" style="background: ${color};" aria-hidden="true">#</div>`;
}

/** @param {object} t */
export function getDmOtherUserId(t) {
	if (!t || t.type !== 'dm') return null;
	const ou = t.other_user;
	if (ou && ou.id != null) {
		const n = Number(ou.id);
		if (Number.isFinite(n) && n > 0) return n;
	}
	const raw = t.other_user_id;
	if (raw != null) {
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

/**
 * DM thread whose counterparty is the viewer (notes-to-self / same user id in pair key).
 * @param {object} t
 * @param {number | null | undefined} viewerId
 */
export function isSelfDmThread(t, viewerId) {
	const vid = Number(viewerId);
	if (!Number.isFinite(vid) || vid <= 0 || !t || t.type !== 'dm') return false;
	const pk = typeof t.dm_pair_key === 'string' ? t.dm_pair_key.trim() : '';
	if (pk) {
		const parts = pk.split(':').map((p) => Number(p));
		if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
			if (parts[0] === vid && parts[1] === vid) return true;
		}
	}
	const oid = getDmOtherUserId(t);
	return Number.isFinite(Number(oid)) && Number(oid) === vid;
}

/**
 * @param {{ display_name?: string | null, user_name?: string | null, avatar_url?: string | null } | null | undefined} profile
 * @param {number} viewerId
 */
function dmTitleForSelfPlaceholder(profile, viewerId) {
	const un = typeof profile?.user_name === 'string' ? profile.user_name.trim() : '';
	if (un) return `@${un}`;
	const dn = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
	if (dn) return dn;
	const vid = Number(viewerId);
	if (Number.isFinite(vid) && vid > 0) return `User ${vid}`;
	return 'You';
}

/**
 * UI-only DM row when the user has never opened a notes-to-self thread (no row from GET /api/chat/threads yet).
 * @param {number} viewerId
 * @param {{ display_name?: string | null, user_name?: string | null, avatar_url?: string | null } | null | undefined} profile
 */
export function buildSelfDmPlaceholderThread(viewerId, profile) {
	const vid = Number(viewerId);
	const un = typeof profile?.user_name === 'string' ? profile.user_name.trim() : '';
	const dn = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
	const avatarUrl = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
	return {
		id: null,
		type: 'dm',
		dm_pair_key: `${vid}:${vid}`,
		other_user_id: vid,
		title: dmTitleForSelfPlaceholder(profile, viewerId),
		other_user: {
			id: vid,
			display_name: dn || null,
			user_name: un || null,
			avatar_url: avatarUrl || null
		},
		last_message: null,
		unread_count: 0,
		last_read_message_id: null,
		_self_dm_placeholder: true
	};
}

/**
 * Ensure a notes-to-self DM appears first, inserting a placeholder if the API has not returned that thread yet.
 * @param {object[]} dms
 * @param {number | null | undefined} viewerId
 * @param {{ display_name?: string | null, user_name?: string | null, avatar_url?: string | null } | null | undefined} profile
 */
export function normalizeDmListWithSelfFirst(dms, viewerId, profile) {
	const vid = Number(viewerId);
	if (!Number.isFinite(vid) || vid <= 0) return Array.isArray(dms) ? [...dms] : [];
	const list = Array.isArray(dms) ? [...dms] : [];
	const hasSelf = list.some((t) => isSelfDmThread(t, vid));
	if (!hasSelf) {
		list.unshift(buildSelfDmPlaceholderThread(vid, profile));
	}
	const idx = list.findIndex((t) => isSelfDmThread(t, vid));
	if (idx > 0) {
		const [row] = list.splice(idx, 1);
		list.unshift(row);
	}
	return list;
}

/**
 * Stable storage key for pinning a DM row (pair key preferred; else numeric thread id).
 * @param {object | null | undefined} t
 * @returns {string | null}
 */
export function dmStablePinStorageKey(t) {
	if (!t || t.type !== 'dm') return null;
	const pk = typeof t.dm_pair_key === 'string' ? t.dm_pair_key.trim() : '';
	if (pk) return `pair:${pk}`;
	const id = Number(t.id);
	if (Number.isFinite(id) && id > 0) return `thread:${id}`;
	return null;
}

/**
 * Keep notes-to-self first; then pinned DMs in saved order; then the rest (stable original order).
 * @param {object[]} dms — output of {@link normalizeDmListWithSelfFirst}
 * @param {number | null | undefined} viewerId
 * @param {string[] | null | undefined} pinKeysOrdered — omit to read from localStorage
 */
export function sortDmsWithPinnedOrder(dms, viewerId, pinKeysOrdered) {
	const raw = Array.isArray(dms) ? dms : [];
	const vid = Number(viewerId);
	const keys = Array.isArray(pinKeysOrdered) ? pinKeysOrdered : readDmPinKeysOrdered();
	const rank = new Map(keys.map((k, i) => [k, i]));

	const selfI = Number.isFinite(vid) && vid > 0 ? raw.findIndex((t) => isSelfDmThread(t, vid)) : -1;
	const self = selfI >= 0 ? raw[selfI] : null;
	const rest = raw.filter((_, i) => i !== selfI);

	const keyed = rest.map((t, i) => ({ t, i, k: dmStablePinStorageKey(t) }));
	keyed.sort((a, b) => {
		const ra = a.k != null && rank.has(a.k) ? rank.get(a.k) : Infinity;
		const rb = b.k != null && rank.has(b.k) ? rank.get(b.k) : Infinity;
		if (ra !== rb) return ra - rb;
		return a.i - b.i;
	});
	const out = keyed.map((x) => x.t);
	return self ? [self, ...out] : out;
}

/** Max rows per sidebar list before Show more / Show less (DMs, server channels, channels). */
export const CHAT_SIDEBAR_COLLAPSE_LIST_CAP = 5;

/** @deprecated Use CHAT_SIDEBAR_COLLAPSE_LIST_CAP */
export const CHAT_SIDEBAR_DM_VISIBLE_CAP = CHAT_SIDEBAR_COLLAPSE_LIST_CAP;

/**
 * Sidebar list: empty HTML, full list if short, or first N rows + expander + hidden rest.
 * @param {object[]} rows
 * @param {(t: object) => string} rowHtml
 * @param {string} emptyHtml — full inner HTML when there are no rows (e.g. `<p class="chat-page-sidebar-empty">…</p>`)
 */
export function buildCollapsibleChatSidebarListHtml(rows, rowHtml, emptyHtml) {
	const list = Array.isArray(rows) ? rows : [];
	if (list.length === 0) {
		return emptyHtml;
	}
	const cap = CHAT_SIDEBAR_COLLAPSE_LIST_CAP;
	if (list.length <= cap) {
		return list.map((t) => rowHtml(t)).join('');
	}
	const visible = list.slice(0, cap).map((t) => rowHtml(t)).join('');
	const rest = list.slice(cap).map((t) => rowHtml(t)).join('');
	return `<div class="chat-page-sidebar-collapsible" data-chat-sidebar-collapsible>
	<div class="chat-page-sidebar-collapsible-visible">${visible}</div>
	<div class="chat-page-sidebar-collapsible-expander-wrap chat-page-sidebar-collapsible-expander-wrap--more">
		<button type="button" class="chat-page-sidebar-collapsible-expander" data-chat-collapsible="more" aria-expanded="false">
			<span class="chat-page-sidebar-collapsible-expander-text">Show more</span>
		</button>
	</div>
	<div class="chat-page-sidebar-collapsible-rest" hidden>${rest}
		<div class="chat-page-sidebar-collapsible-expander-wrap chat-page-sidebar-collapsible-expander-wrap--less">
			<button type="button" class="chat-page-sidebar-collapsible-expander" data-chat-collapsible="less" aria-expanded="false">
				<span class="chat-page-sidebar-collapsible-expander-text">Show less</span>
			</button>
		</div>
	</div>
</div>`;
}

/**
 * DM list — same as {@link buildCollapsibleChatSidebarListHtml} with DM empty copy.
 * @param {object[]} dms
 * @param {(t: object) => string} rowHtml
 */
export function buildChatSidebarDmListHtml(dms, rowHtml) {
	return buildCollapsibleChatSidebarListHtml(
		dms,
		rowHtml,
		'<p class="chat-page-sidebar-empty">No direct messages yet.</p>'
	);
}

/**
 * Show more / show less for any `[data-chat-sidebar-collapsible]` block.
 * @param {HTMLButtonElement} btn
 */
export function toggleChatSidebarCollapsibleList(btn) {
	if (!(btn instanceof HTMLButtonElement)) return;
	const expandable = btn.closest('[data-chat-sidebar-collapsible]');
	if (!expandable) return;
	const rest = expandable.querySelector('.chat-page-sidebar-collapsible-rest');
	const moreBtn = expandable.querySelector('[data-chat-collapsible="more"]');
	const lessBtn = expandable.querySelector('[data-chat-collapsible="less"]');
	const kind = btn.getAttribute('data-chat-collapsible');
	if (kind === 'more') {
		if (rest instanceof HTMLElement) rest.hidden = false;
		expandable.classList.add('is-expanded');
		moreBtn?.setAttribute('aria-expanded', 'true');
		lessBtn?.setAttribute('aria-expanded', 'true');
		return;
	}
	if (kind === 'less') {
		if (rest instanceof HTMLElement) rest.hidden = true;
		expandable.classList.remove('is-expanded');
		moreBtn?.setAttribute('aria-expanded', 'false');
		lessBtn?.setAttribute('aria-expanded', 'false');
	}
}

/** @deprecated Use {@link toggleChatSidebarCollapsibleList} */
export function toggleChatSidebarDmExpander(btn) {
	toggleChatSidebarCollapsibleList(btn);
}
