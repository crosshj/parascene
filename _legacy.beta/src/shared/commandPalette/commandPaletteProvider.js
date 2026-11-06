/**
 * Command palette data: normalize chat destinations into searchable items (no DOM).
 */

import { getAvatarColor } from '../avatar.js';
import { renderCommentAvatarHtml } from '../commentItem.js';
import { readCachedChatThreads } from '../chatThreadsCache.js';
import {
	SIDEBAR_TOP_STRIP_CHANNEL_SLUGS,
	appendReservedPseudoChannels,
	buildChatThreadUrl,
	buildChatThreadRowAvatarHtml,
	getSidebarPseudoStripRowsMerged,
	mergeThreadRowsWithJoinedServers,
	rowLastActivityMs,
	rowUnreadCount,
} from '../chatSidebarRoster.js';

const RECENT_CAP = 10;
const RESULT_CAP = 50;

const avatarDeps = { renderCommentAvatarHtml, getAvatarColor };

/**
 * @param {object} t
 * @returns {'thread' | 'pseudo' | 'notes'}
 */
function itemKindForRow(t) {
	if (t?.type === 'sidebar_notes') return 'notes';
	if (t?.type === 'channel') {
		const slug = String(t.channel_slug || '').trim().toLowerCase();
		if (slug && SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) return 'pseudo';
	}
	return 'thread';
}

/**
 * @param {object} t
 * @returns {{ title: string, subtitle: string, searchText: string }}
 */
function labelsForRow(t) {
	if (t?.type === 'sidebar_notes') {
		return { title: 'My Notes', subtitle: 'Notes to self', searchText: 'notes my notes' };
	}
	if (t?.type === 'dm') {
		const ou = t.other_user && typeof t.other_user === 'object' ? t.other_user : null;
		const displayName =
			(typeof ou?.display_name === 'string' && ou.display_name.trim()) ||
			(typeof ou?.user_name === 'string' && ou.user_name.trim()) ||
			(typeof t.title === 'string' && t.title.trim().startsWith('@')
				? t.title.trim().slice(1)
				: String(t.title || '').trim()) ||
			'User';
		const userName = typeof ou?.user_name === 'string' ? ou.user_name.trim() : '';
		return {
			title: displayName,
			subtitle: 'Direct message',
			searchText: [displayName, userName, t.title].filter(Boolean).join(' '),
		};
	}
	if (t?.type === 'channel') {
		const slugRaw =
			(typeof t.channel_slug === 'string' && t.channel_slug.trim()) ||
			(typeof t.title === 'string' && t.title.trim().startsWith('#') ? t.title.trim().slice(1) : '');
		const slug = slugRaw.toLowerCase();
		const isPrivate = String(t.visibility || '').trim().toLowerCase() === 'private';
		let title =
			(typeof t.title === 'string' && t.title.trim()) ||
			(slugRaw ? `#${slugRaw}` : 'Channel');
		if (title.startsWith('#')) title = title.slice(1);
		const kind = itemKindForRow(t);
		if (kind === 'pseudo') {
			return {
				title,
				subtitle: slug ? `#${slug}` : 'Place',
				searchText: [title, slug, t.channel_slug].filter(Boolean).join(' '),
			};
		}
		return {
			title,
			subtitle: isPrivate ? 'Private channel' : slugRaw ? `#${slugRaw}` : 'Channel',
			searchText: [title, slugRaw, t.channel_slug, isPrivate ? 'private' : ''].filter(Boolean).join(' '),
		};
	}
	const fallbackTitle = typeof t?.title === 'string' && t.title.trim() ? t.title.trim() : 'Chat';
	return { title: fallbackTitle, subtitle: '', searchText: fallbackTitle };
}

/**
 * @param {object} t
 * @returns {string}
 */
function stableItemId(t) {
	if (t?.type === 'sidebar_notes') return 'notes';
	if (t?.type === 'dm') {
		const ou = t.other_user;
		const un = typeof ou?.user_name === 'string' ? ou.user_name.trim().toLowerCase() : '';
		if (un) return `dm:user:${un}`;
		const oid = Number(t.other_user_id ?? ou?.id);
		if (Number.isFinite(oid) && oid > 0) return `dm:id:${oid}`;
		const id = Number(t.id);
		if (Number.isFinite(id) && id > 0) return `dm:thread:${id}`;
		return 'dm:unknown';
	}
	if (t?.type === 'channel') {
		const slug = String(t.channel_slug || '').trim().toLowerCase();
		if (slug) return `channel:${slug}`;
		const id = Number(t.id);
		if (Number.isFinite(id) && id > 0) return `channel:thread:${id}`;
		return 'channel:unknown';
	}
	const id = Number(t?.id);
	if (Number.isFinite(id) && id > 0) return `thread:${id}`;
	return `row:${String(t?.title || 'unknown')}`;
}

/**
 * @param {object} t
 * @param {'recent' | 'channels' | 'dms' | 'places'} section
 * @returns {object}
 */
function threadMetaToItem(t, section) {
	const { title, subtitle, searchText } = labelsForRow(t);
	const href = buildChatThreadUrl(t);
	return {
		id: stableItemId(t),
		kind: itemKindForRow(t),
		title,
		subtitle,
		searchText,
		href,
		iconHtml: buildChatThreadRowAvatarHtml(t, avatarDeps),
		unreadCount: rowUnreadCount(t),
		lastActivityMs: rowLastActivityMs(t),
		section,
	};
}

/**
 * @param {{
 *   getThreads?: () => unknown[],
 *   getJoinedServers?: () => unknown[],
 *   getViewerId?: () => number | null,
 * }} deps
 * @returns {object[]}
 */
export function buildCommandPaletteItems(deps = {}) {
	const getThreads = typeof deps.getThreads === 'function' ? deps.getThreads : () => [];
	const getJoinedServers = typeof deps.getJoinedServers === 'function' ? deps.getJoinedServers : () => [];

	let threads = getThreads();
	if (!Array.isArray(threads) || threads.length === 0) {
		const cached = readCachedChatThreads();
		if (cached && Array.isArray(cached.threads)) threads = cached.threads;
	}
	threads = Array.isArray(threads) ? threads : [];
	const joined = getJoinedServers();
	const merged = appendReservedPseudoChannels(mergeThreadRowsWithJoinedServers(threads, joined));

	const items = [];
	const channelRows = merged.filter((t) => t && t.type === 'channel');
	const placeRows = getSidebarPseudoStripRowsMerged(channelRows);
	for (const row of placeRows) {
		items.push(threadMetaToItem(row, 'places'));
	}

	for (const row of merged) {
		if (!row) continue;
		if (row.type === 'dm') {
			items.push(threadMetaToItem(row, 'dms'));
			continue;
		}
		if (row.type !== 'channel') continue;
		const slug = String(row.channel_slug || '').trim().toLowerCase();
		if (slug && SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug)) continue;
		items.push(threadMetaToItem(row, 'channels'));
	}

	return items;
}

/**
 * @param {object} item
 * @returns {string}
 */
function searchHaystack(item) {
	return [item.title, item.subtitle, item.searchText].filter(Boolean).join(' ').toLowerCase();
}

/**
 * @param {object} item
 * @param {string} q
 * @returns {number}
 */
function scoreMatch(item, q) {
	const hay = searchHaystack(item);
	if (!q || !hay) return 0;
	if (hay === q) return 100;
	if (hay.startsWith(q)) return 80;
	const words = hay.split(/\s+/);
	if (words.some((w) => w.startsWith(q))) return 65;
	if (hay.includes(q)) return 50;
	return 0;
}

/**
 * @param {object[]} allItems
 * @param {string} [query]
 * @returns {{ grouped: boolean, groups: { id: string, label: string, items: object[] }[], flatItems: object[] }}
 */
export function filterCommandPaletteItems(allItems, query = '') {
	const list = Array.isArray(allItems) ? allItems : [];
	const q = String(query || '').trim().toLowerCase();

	if (!q) {
		const recentCandidates = list
			.filter((i) => i.section === 'dms' || i.section === 'channels')
			.sort((a, b) => (b.lastActivityMs || 0) - (a.lastActivityMs || 0))
			.slice(0, RECENT_CAP);
		const places = list.filter((i) => i.section === 'places');
		const groups = [{ id: 'recent', label: 'Recent', items: recentCandidates }];
		if (places.length) groups.push({ id: 'places', label: 'Places', items: places });
		return {
			grouped: true,
			groups,
			flatItems: [...recentCandidates, ...places],
		};
	}

	const scored = list
		.map((item) => ({ item, score: scoreMatch(item, q) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || (b.item.lastActivityMs || 0) - (a.item.lastActivityMs || 0))
		.slice(0, RESULT_CAP)
		.map((x) => x.item);

	return {
		grouped: false,
		groups: scored.length ? [{ id: 'results', label: '', items: scored }] : [],
		flatItems: scored,
	};
}
