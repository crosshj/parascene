// Server-owned fixture data that intentionally follows the www API vocabulary.
// The browser only consumes the serialized endpoints; it never imports these
// mock records or manufactures a fallback roster.
const mockDmUsers = [
	['girlwatchinggeek', '#a65b79', true], ['quinsy', '#5c4931', true], ['tonygen', '#b9afa9', false],
	['spirited_experiment', '#77757d', true], ['simonkennedybackup', '#6f6755', false],
	['lexica', '#3b82f6', true], ['neonpilot', '#ec4899', true]
];
const mockChannels = [
	['parascene', 'p', '#321080', true], ['sharkgod-gens', '🦈', '#05c76f', true],
	['parascene-blue', '🔥', '#1677d2', true], ['croskie', 'C', '#268ec1', true],
	['para-flix', '#', '#05c76f', false], ['suno-tics', '#', '#3b82f6', false],
	['desktop-client', '#', '#f59e0b', false], ['founders', '♙', '#f43f5e', false],
	['general', '#', '#8b5cf6', false], ['showcase', '#', '#06b6d4', false], ['music', '#', '#ec4899', false]
];

export function mockThreads(viewerId) {
	const now = Date.parse('2026-09-24T12:00:00.000Z');
	const dms = mockDmUsers.map(([username, color, online], index) => ({
		id: 101 + index, type: 'dm', dm_pair_key: `${Math.min(Number(viewerId), 1001 + index)}:${Math.max(Number(viewerId), 1001 + index)}`,
		other_user_id: 1001 + index, title: username,
		other_user: { id: 1001 + index, display_name: username, user_name: username, avatar_url: null },
		last_message: index < 2 ? { id: 9000 + index, body: index ? 'Are you around?' : 'Just shared a new creation', created_at: new Date(now - index * 60_000).toISOString(), sender_id: 1001 + index } : null,
		last_read_message_id: null, unread_count: index === 1 ? 2 : 0, beta_presence: online,
		beta_sidebar_path: `/chat/dm/${username}`, beta_sidebar_color: color
	}));
	const channels = mockChannels.map(([slug, text, color, isServer], index) => ({
		id: isServer ? 201 + index : 297 + index,
		type: 'channel', channel_slug: slug, title: `#${slug}`,
		last_message: null, last_read_message_id: null, unread_count: index === 0 ? 3 : 0, visibility: 'public',
		beta_sidebar_path: `/chat/c/${slug}`, beta_sidebar_text: text, beta_sidebar_color: color,
		beta_sidebar_is_server: isServer
	}));
	return [...dms, ...channels];
}

export function mockServers() {
	return mockChannels.filter(([, , , isServer]) => isServer).map(([name, text, color], index) => ({
		id: 201 + index, name, description: '', status: 'active', icon: text,
		beta_sidebar_path: `/chat/c/${name}`, beta_sidebar_color: color, beta_sidebar_text: text,
		beta_sidebar_thread_id: 201 + index, can_manage: false, can_join: false, is_member: true
	}));
}
