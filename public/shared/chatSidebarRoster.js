/**
 * Shared roster logic for Connect chat list and full-page chat sidebar (channels + DMs).
 */

import { serverChannelTagFromServerName } from './serverChatTag.js';

/** @param {object} meta */
export function buildChatThreadUrl(meta) {
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
			last_message: null
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
