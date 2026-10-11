/**
 * Keep triggered-suggest local caches in sync with the open conversation.
 * Hashtags come from the inbox roster; @candidates come from thread peers and message senders.
 *
 * Sidebar slug lists are duplicated here (not imported from chatSidebarRoster) so Node tests
 * that load ConversationController stay CSS-free.
 */

import {
	addPageHashtagTargets,
	addPageUsers,
	clearPageHashtagTargets
} from './triggeredSuggest.js';
import { serverChannelTagFromServerName } from './serverChatTag.js';

const SIDEBAR_PSEUDO_STRIP_ORDER = [
	'feed',
	'challenges',
	'creations',
	'comments',
	'explore',
	'prompt-library',
	'feedback',
];

const SIDEBAR_PSEUDO_STRIP_TITLES = {
	feed: 'Feed',
	challenges: 'Challenges',
	explore: 'Explore',
	'prompt-library': 'Prompt Library',
	creations: 'My Creations',
	comments: 'Comments',
	feedback: 'Feedback',
};

const SIDEBAR_TOP_STRIP_CHANNEL_SLUGS = new Set(
	SIDEBAR_PSEUDO_STRIP_ORDER.map((slug) => slug.toLowerCase())
);

function getSidebarPseudoChannelTitle(channelSlug) {
	const slug = String(channelSlug ?? '')
		.toLowerCase()
		.trim();
	return SIDEBAR_PSEUDO_STRIP_TITLES[slug] || null;
}

/**
 * @param {{
 *   thread?: object | null,
 *   inbox?: { threads?: object[], servers?: object[] } | null,
 *   messages?: object[] | null,
 * }} [opts]
 */
export function syncChatComposerSuggestCaches(opts = {}) {
	const thread = opts.thread && typeof opts.thread === 'object' ? opts.thread : null;
	const inbox = opts.inbox && typeof opts.inbox === 'object' ? opts.inbox : null;
	const messages = Array.isArray(opts.messages) ? opts.messages : [];

	clearPageHashtagTargets();
	const items = [];
	const seen = new Set();
	const servers = Array.isArray(inbox?.servers) ? inbox.servers : [];
	const joinedServerSlugs = new Set(
		servers
			.map((server) => serverChannelTagFromServerName(typeof server?.name === 'string' ? server.name : ''))
			.filter(Boolean)
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
		items.push({ ...item, type, slug });
	};

	for (const row of Array.isArray(inbox?.threads) ? inbox.threads : []) {
		if (!row || row.type !== 'channel') continue;
		const slug = typeof row.channel_slug === 'string' ? row.channel_slug.trim().toLowerCase() : '';
		if (!slug || SIDEBAR_TOP_STRIP_CHANNEL_SLUGS.has(slug) || joinedServerSlugs.has(slug)) continue;
		const rawTitle = typeof row.title === 'string' ? row.title.trim() : '';
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

	for (const slugRaw of SIDEBAR_PSEUDO_STRIP_ORDER) {
		const slug = String(slugRaw || '').trim().toLowerCase();
		if (!slug) continue;
		addTarget({
			type: 'pseudo_channel',
			id: `pseudo_channel:${slug}`,
			label: getSidebarPseudoChannelTitle(slug) || `#${slug}`,
			sublabel: `#${slug}`,
			slug,
			badge: 'Default'
		});
	}
	addTarget({ type: 'pseudo_channel', id: 'pseudo_channel:create', label: 'Create', sublabel: '#create', slug: 'create', badge: 'Default' });
	addTarget({ type: 'pseudo_channel', id: 'pseudo_channel:notes', label: 'My Notes', sublabel: '#notes', slug: 'notes', badge: 'Default' });
	addTarget({ type: 'pseudo_channel', id: 'pseudo_channel:help', label: 'Help', sublabel: '#help', slug: 'help', badge: 'Default' });

	for (const server of servers) {
		const id = Number(server?.id);
		const name = typeof server?.name === 'string' ? server.name.trim() : '';
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

	const users = [];
	if (thread?.type === 'dm' && thread.other_user) {
		users.push({
			id: thread.other_user_id ?? thread.other_user.id,
			user_name: thread.other_user.user_name,
			display_name: thread.other_user.display_name,
			avatar_url: thread.other_user.avatar_url
		});
	}
	for (const message of messages) {
		if (!message) continue;
		users.push({
			id: message.sender_id,
			user_name: message.sender_user_name,
			display_name: message.sender_display_name,
			avatar_url: message.sender_avatar_url
		});
	}
	if (users.length) addPageUsers(users);
}
