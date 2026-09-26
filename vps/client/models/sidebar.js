import { navigationItems, sidebarMenus } from '../config/sidebar.js';

function rosterModel(roster = {}) {
	const threads = Array.isArray(roster.threads) ? roster.threads : [];
	const serversFromApi = Array.isArray(roster.servers) ? roster.servers : [];
	const navigation = structuredClone(navigationItems);
	const challenges = navigation.find((item) => item.id === 'challenges');
	if (challenges) challenges.unread = Number(roster.unreadSummary?.challenges_unread) || 0;
	const hiddenIds = new Set(Array.isArray(roster.hiddenIds) ? roster.hiddenIds.map(String) : []);
	const pinnedIds = new Set(Array.isArray(roster.pinnedIds) ? roster.pinnedIds.map(String) : []);
	const directMessages = threads.filter((row) => row?.type === 'dm' && !hiddenIds.has(`dm-${row.id}`)).map((row) => {
		const other = row.other_user || {};
		const username = String(other.user_name || row.title || 'user');
		return {
			id: `dm-${row.id}`, label: `@${username}`,
			path: row.beta_sidebar_path || `/chat/dm/${encodeURIComponent(username)}`,
			avatarUrl: other.avatar_url || '', color: row.beta_sidebar_color || '', online: row.beta_presence === true,
			unread: Number(row.unread_count) || 0,
			route: { kind: 'dm', userName: username, threadId: Number(row.id) }
		};
	});
	const channelRows = threads.filter((row) => row?.type === 'channel' && !hiddenIds.has(`channel-${row.id}`)).map((row) => {
		const slug = String(row.channel_slug || row.title || 'channel').replace(/^#/, '');
		return {
			id: `channel-${row.id}`, label: `#${slug}`,
			path: row.beta_sidebar_path || `/chat/c/${encodeURIComponent(slug)}`,
			text: row.beta_sidebar_text || '#', color: row.beta_sidebar_color || '', unread: Number(row.unread_count) || 0,
			route: { kind: 'channel', slug, threadId: Number(row.id) }
		};
	});
	const threadById = new Map(threads.map((row) => [Number(row.id), row]));
	const servers = serversFromApi.filter((row) => !hiddenIds.has(`server-${row.id}`)).map((row) => {
		const thread = threadById.get(Number(row.beta_sidebar_thread_id));
		const slug = String(thread?.channel_slug || row.slug || row.name || 'server').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
		const path = row.beta_sidebar_path || thread?.beta_sidebar_path || `/servers/${row.id}`;
		const hasThread = Number.isFinite(Number(row.beta_sidebar_thread_id));
		return {
			id: `server-${row.id}`, label: `#${row.name || slug}`, path,
			text: row.beta_sidebar_text || String(row.name || 'S').slice(0, 1), color: row.beta_sidebar_color || '',
			unread: Number(thread?.unread_count) || 0,
			route: hasThread ? { kind: 'channel', slug, threadId: Number(row.beta_sidebar_thread_id) } : { kind: 'path', path }
		};
	});
	const serverThreadIds = new Set(serversFromApi.map((row) => Number(row.beta_sidebar_thread_id)).filter(Number.isFinite));
	const pinnedFirst = (rows) => [...rows].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)));
	return {
		navigation, directMessages: pinnedFirst(directMessages), servers: pinnedFirst(servers),
		channels: pinnedFirst(channelRows.filter((row) => !serverThreadIds.has(Number(row.route.threadId))))
	};
}

export function createSidebarModel(preference = {}, roster = null) {
	const model = {
		...rosterModel(roster || {}),
		menus: structuredClone(sidebarMenus),
		footer: { credits: '' }
	};
	if (preference.mode !== 'minimal') return model;
	for (const key of ['directMessages', 'servers', 'channels']) {
		model[key] = preference[key] === 'minimal' ? model[key].slice(0, 2) : [];
	}
	return model;
}
