import { navigationItems } from '../../config/sidebar.js';
import { formatCredits } from '../../utils/format.js';
import { buildProfilePath } from '../../shared/profileLinks.js';
import { isDmPinKeyActive } from '../../shared/chatDmPins.js';
import { SIDEBAR_TOP_STRIP_CHANNEL_SLUGS, mergeThreadRowsWithJoinedServers, isSelfDmThread, getDmOtherUserId,
 buildChatThreadUrl, buildChatThreadRowAvatarHtml, sortChannelRowsByLastActivity,
 prioritizeUnreadRowsInVisibleWindow, sortDmsWithPinnedOrder, dmStablePinStorageKey, CHAT_SIDEBAR_COLLAPSE_LIST_CAP } from '../../shared/chatSidebarRoster.js';
import { prioritizeOnlineDmsInVisibleWindow } from './presenceOrder.js';
import { serverChannelTagFromServerName } from '../../shared/serverChatTag.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { renderCommentAvatarHtml } from '../../shared/commentItem.js';

function rosterModel(roster = {}, presence) {
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
	const feedback = navigation.find((item) => item.id === 'feedback');
	if (feedback) {
		const row = threads.find((entry) => entry?.type === 'channel' && String(entry.channel_slug || '').trim().toLowerCase() === 'feedback');
		feedback.unread = Number(row?.unread_count) || 0;
	}
	const dms = threads.filter((row) => row?.type === 'dm' && !isSelfDmThread(row, roster.viewerId));
	const pinned = sortDmsWithPinnedOrder(dms, roster.viewerId);
	const isOnline = row => presence?.isOnline(getDmOtherUserId(row)) || false;
	const lastInteracted = row => {
		const ms = Date.parse(String(row?.last_message?.created_at || ''));
		return Number.isFinite(ms) ? ms : 0;
	};
	const presenceOrdered = prioritizeOnlineDmsInVisibleWindow(pinned, {
		visibleCap: CHAT_SIDEBAR_COLLAPSE_LIST_CAP, isOnline,
		getLastSeenMs: row => presence?.lastActiveMs(getDmOtherUserId(row)) || 0,
		getLastInteractedMs: lastInteracted,
	});
	const orderedDms = prioritizeUnreadRowsInVisibleWindow(presenceOrdered, {
		visibleCap: CHAT_SIDEBAR_COLLAPSE_LIST_CAP, getLastActivityMs: lastInteracted,
	});
	const directMessages = orderedDms.map((row) => {
		const other = row.other_user || {};
		const username = String(other.user_name || row.other_user_id || 'user');
		const pinKey = dmStablePinStorageKey(row);
		return {
			id: `dm-${row.id}`, section: 'dm', label: `@${username}`,
			path: buildChatThreadUrl(row), avatarHtml: avatar(row), online: isOnline(row),
			unread: Number(row.unread_count) || 0,
			lastMessageId: Number(row.last_message?.id) || 0,
			pinKey, pinned: Boolean(pinKey && isDmPinKeyActive(pinKey)),
			profilePath: buildProfilePath({ userName: other.user_name, userId: row.other_user_id }),
			route: { kind: 'dm', userName: username.toLowerCase(), threadId: Number(row.id) }
		};
	});
	const visibleChannels = threads.filter(row => row?.type === 'channel' && !SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(String(row.channel_slug || '').trim().toLowerCase()));
	const ordered = rows => prioritizeUnreadRowsInVisibleWindow(sortChannelRowsByLastActivity(rows));
	function channelItem(row, kind = 'channel', server = null) {
		const slug = String(row.channel_slug || row.title || 'channel').replace(/^#/, '');
		return {
			id: `${kind}-${row.id || slug}`, section: kind, label: row.title || `#${slug}`,
			path: buildChatThreadUrl(row),
			avatarHtml: avatar(server?.avatar_url?.trim() ? { ...row, server_avatar_url: server.avatar_url.trim() } : row), unread: Number(row.unread_count) || 0,
			lastMessageId: Number(row.last_message?.id) || 0,
			server: server ? { id: Number(server.id), name: server.name || row.title || slug, description: typeof server.description === 'string' ? server.description : '', canManage: server.can_manage === true } : null,
			route: { kind: 'channel', slug, threadId: Number(row.id) || 0, serverId: server ? Number(server.id) : 0 }
		};
	}
	const isServer = row => joinedBySlug.has(String(row.channel_slug || '').trim().toLowerCase());
	const channelRows = ordered(visibleChannels.filter(row => !isServer(row))).map(row => channelItem(row));
	const servers = ordered(visibleChannels.filter(isServer)).map(row => channelItem(row, 'server', joinedBySlug.get(String(row.channel_slug).trim().toLowerCase())));
	return {
		navigation, directMessages, servers,
		channels: channelRows,
		footer: { credits: roster?.credits == null ? '' : formatCredits(roster.credits) }
	};
}

export function createSidebarModel(preference = {}, roster = null, presence) {
	const model = {
		...rosterModel(roster || {}, presence),
		footer: { credits: roster?.credits == null ? '' : formatCredits(roster.credits) }
	};
	if (preference.mode !== 'minimal') return model;
	for (const key of ['directMessages', 'servers', 'channels']) {
		model[key] = preference[key] === 'minimal' ? model[key].slice(0, 2) : [];
	}
	return model;
}
