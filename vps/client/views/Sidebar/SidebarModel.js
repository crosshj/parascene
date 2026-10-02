import { navigationItems, sidebarMenus } from '../../config/sidebar.js';
import { formatCredits } from '../../utils/format.js';
import { SIDEBAR_TOP_STRIP_CHANNEL_SLUGS, mergeThreadRowsWithJoinedServers, isSelfDmThread,
 buildChatThreadUrl, buildChatThreadRowAvatarHtml, sortChannelRowsByLastActivity,
 prioritizeUnreadRowsInVisibleWindow } from '../../shared/chatSidebarRoster.js';
import { serverChannelTagFromServerName } from '../../shared/serverChatTag.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';

function rosterModel(roster = {}) {
	const serversFromApi = (Array.isArray(roster.servers) ? roster.servers : []).filter(row => row?.is_member);
	const threads = mergeThreadRowsWithJoinedServers(roster.threads, serversFromApi);
	const joinedBySlug = new Map();
	for (const server of [...serversFromApi].sort((a, b) => Number(a.id) - Number(b.id))) {
		const slug = serverChannelTagFromServerName(server.name);
		if (!joinedBySlug.has(slug)) joinedBySlug.set(slug, server);
	}
	const avatar = row => buildChatThreadRowAvatarHtml(row, { getAvatarColor, renderCommentAvatarHtml });
	const navigation = structuredClone(navigationItems);
	const challenges = navigation.find((item) => item.id === 'challenges');
	if (challenges) challenges.unread = Number(roster.unreadSummary?.challenges_unread) || 0;
	const hiddenIds = new Set(Array.isArray(roster.hiddenIds) ? roster.hiddenIds.map(String) : []);
	const pinnedIds = new Set(Array.isArray(roster.pinnedIds) ? roster.pinnedIds.map(String) : []);
	const directMessages = threads.filter((row) => row?.type === 'dm' && !isSelfDmThread(row, roster.viewerId) && !hiddenIds.has(`dm-${row.id}`)).map((row) => {
		const other = row.other_user || {};
		const username = String(other.user_name || row.other_user_id || 'user');
		return {
			id: `dm-${row.id}`, label: `@${username}`,
			path: buildChatThreadUrl(row), avatarHtml: avatar(row), online: false,
			unread: Number(row.unread_count) || 0,
			route: { kind: 'dm', userName: username, threadId: Number(row.id) }
		};
	});
	const visibleChannels = threads.filter(row => row?.type === 'channel' && !SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(String(row.channel_slug || '').trim().toLowerCase()));
	const ordered = rows => prioritizeUnreadRowsInVisibleWindow(sortChannelRowsByLastActivity(rows));
	function channelItem(row, kind = 'channel', server = null) {
		const slug = String(row.channel_slug || row.title || 'channel').replace(/^#/, '');
		return {
			id: `${kind}-${row.id || slug}`, label: row.title || `#${slug}`,
			path: buildChatThreadUrl(row),
			avatarHtml: avatar(server?.avatar_url?.trim() ? { ...row, server_avatar_url: server.avatar_url.trim() } : row), unread: Number(row.unread_count) || 0,
			route: { kind: 'channel', slug, threadId: Number(row.id) }
		};
	}
	const isServer = row => joinedBySlug.has(String(row.channel_slug || '').trim().toLowerCase());
	const channelRows = ordered(visibleChannels.filter(row => !isServer(row))).map(row => channelItem(row)).filter(row => !hiddenIds.has(row.id));
	const servers = ordered(visibleChannels.filter(isServer)).map(row => channelItem(row, 'server', joinedBySlug.get(String(row.channel_slug).trim().toLowerCase()))).filter(row => !hiddenIds.has(row.id));
	const pinnedFirst = (rows) => [...rows].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)));
	return {
		navigation, directMessages: pinnedFirst(directMessages), servers,
		channels: channelRows,
		footer: { credits: roster?.credits == null ? '' : formatCredits(roster.credits) }
	};
}

export function createSidebarModel(preference = {}, roster = null) {
	const model = {
		...rosterModel(roster || {}),
		menus: structuredClone(sidebarMenus),
		footer: { credits: roster?.credits == null ? '' : formatCredits(roster.credits) }
	};
	if (preference.mode !== 'minimal') return model;
	for (const key of ['directMessages', 'servers', 'channels']) {
		model[key] = preference[key] === 'minimal' ? model[key].slice(0, 2) : [];
	}
	return model;
}
