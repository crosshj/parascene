/**
 * Shared roster logic for Connect chat list and full-page chat sidebar (channels + DMs).
 */

import { serverChannelTagFromServerName } from './serverChatTag.js';

/**
 * Pseudo-channels (UI-only roster rows; not backed by prsn_chat_threads).
 * Slugs must match client + API reserved list in api_routes/chat.js.
 * Always show both #comments and #feedback in the sidebar.
 */
export const RESERVED_PSEUDO_CHANNEL_SLUGS = ['comments', 'feedback'];

/**
 * Channel slugs that always sort to the top of the sidebar (order matters).
 * `#comments` is the reserved pseudo row; `#feedback` is an ordinary channel when present.
 */
export const SIDEBAR_CHANNEL_PRIORITY_FIRST = ['comments', 'feedback'];

/**
 * Put priority channel rows first (#comments, then #feedback, then the rest), stable order within each tier.
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

/** @param {object | null | undefined} t */
function channelLastActivityMs(t) {
	const lm = t?.last_message;
	if (!lm || lm.created_at == null) return 0;
	const ms = Date.parse(String(lm.created_at));
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * Order channel rows: #comments and #feedback first (see SIDEBAR_CHANNEL_PRIORITY_FIRST), then
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
 * Append fixed pseudo-channel rows so they always appear in the sidebar list.
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

/**
 * DM thread whose counterparty is the viewer (notes-to-self / same user id in pair key).
 * @param {object} t
 * @param {number | null | undefined} viewerId
 */
export function isSelfDmThread(t, viewerId) {
	const vid = Number(viewerId);
	if (!Number.isFinite(vid) || vid <= 0 || !t || t.type !== 'dm') return false;
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
