const fullSidebarModel = {
	navigation: [
		{ id: 'feed', label: 'Feed', path: '/', icon: 'home', route: { kind: 'channel', slug: 'feed' } },
		{ id: 'challenges', label: 'Challenges', path: '/challenges', icon: 'trophy', route: { kind: 'channel', slug: 'challenges' } },
		{ id: 'creations', label: 'My Creations', path: '/creations', icon: 'picture', route: { kind: 'channel', slug: 'creations' } },
		{ id: 'files', label: 'My Files', path: '/files', icon: 'files', route: { kind: 'path', path: '/files' } },
		{ id: 'notes', label: 'My Notes', path: '/chat/notes', icon: 'notes', route: { kind: 'dm', self: true } },
		{ id: 'comments', label: 'Comments', path: '/chat/c/comments', icon: 'comments', route: { kind: 'channel', slug: 'comments' } },
		{ id: 'explore', label: 'Explore', path: '/explore', icon: 'globe', route: { kind: 'channel', slug: 'explore' } },
		{ id: 'prompt-library', label: 'Prompt Library', path: '/prompt-library', icon: 'book', route: { kind: 'channel', slug: 'prompt-library' } },
		{ id: 'feedback', label: 'Feedback', path: '/chat/c/feedback', icon: 'megaphone', route: { kind: 'channel', slug: 'feedback' } }
	],
	directMessages: [
		{ id: 'dm-girlwatchinggeek', label: '@girlwatchinggeek', path: '/chat/dm/girlwatchinggeek', color: '#a65b79', route: { kind: 'dm', userName: 'girlwatchinggeek', threadId: 101 } },
		{ id: 'dm-quinsy', label: '@quinsy', path: '/chat/dm/quinsy', color: '#5c4931', route: { kind: 'dm', userName: 'quinsy', threadId: 102 } },
		{ id: 'dm-tonygen', label: '@tonygen', path: '/chat/dm/tonygen', color: '#b9afa9', route: { kind: 'dm', userName: 'tonygen', threadId: 103 } },
		{ id: 'dm-spirited', label: '@spirited_experiment', path: '/chat/dm/spirited_experiment', color: '#77757d', route: { kind: 'dm', userName: 'spirited_experiment', threadId: 104 } },
		{ id: 'dm-simon', label: '@simonkennedybackup', path: '/chat/dm/simonkennedybackup', color: '#6f6755', route: { kind: 'dm', userName: 'simonkennedybackup', threadId: 105 } },
		{ id: 'dm-lex', label: '@lexica', path: '/chat/dm/lexica', color: '#3b82f6', route: { kind: 'dm', userName: 'lexica', threadId: 106 } },
		{ id: 'dm-neon', label: '@neonpilot', path: '/chat/dm/neonpilot', color: '#ec4899', route: { kind: 'dm', userName: 'neonpilot', threadId: 107 } }
	],
	servers: [
		{ id: 'server-parascene', label: '#parascene', path: '/chat/c/parascene', text: 'p', color: '#321080', route: { kind: 'channel', slug: 'parascene', threadId: 201 } },
		{ id: 'server-sharkgod', label: '#sharkgod-gens', path: '/chat/c/sharkgod-gens', text: '🦈', color: '#05c76f', route: { kind: 'channel', slug: 'sharkgod-gens', threadId: 202 } },
		{ id: 'server-blue', label: '#parascene-blue', path: '/chat/c/parascene-blue', text: '🔥', color: '#1677d2', route: { kind: 'channel', slug: 'parascene-blue', threadId: 203 } },
		{ id: 'server-croskie', label: '#croskie', path: '/chat/c/croskie', text: 'C', color: '#268ec1', route: { kind: 'channel', slug: 'croskie', threadId: 204 } }
	],
	channels: [
		{ id: 'channel-para-flix', label: '#para-flix', path: '/chat/c/para-flix', text: '#', color: '#05c76f', route: { kind: 'channel', slug: 'para-flix', threadId: 301 } },
		{ id: 'channel-suno-tics', label: '#suno-tics', path: '/chat/c/suno-tics', text: '#', color: '#3b82f6', route: { kind: 'channel', slug: 'suno-tics', threadId: 302 } },
		{ id: 'channel-desktop', label: '#desktop-client', path: '/chat/c/desktop-client', text: '#', color: '#f59e0b', route: { kind: 'channel', slug: 'desktop-client', threadId: 303 } },
		{ id: 'channel-founders', label: '#founders', path: '/chat/c/founders', text: '♙', color: '#f43f5e', route: { kind: 'channel', slug: 'founders', threadId: 304 } },
		{ id: 'channel-general', label: '#general', path: '/chat/c/general', text: '#', color: '#8b5cf6', route: { kind: 'channel', slug: 'general', threadId: 305 } },
		{ id: 'channel-showcase', label: '#showcase', path: '/chat/c/showcase', text: '#', color: '#06b6d4', route: { kind: 'channel', slug: 'showcase', threadId: 306 } },
		{ id: 'channel-music', label: '#music', path: '/chat/c/music', text: '#', color: '#ec4899', route: { kind: 'channel', slug: 'music', threadId: 307 } }
	],
	menus: {
		addDm: { label: 'Direct messages', items: [{ label: 'New direct message', href: '/chat/new/dm', icon: 'plus' }, { label: 'Browse people', href: '/people', icon: 'user' }] },
		addServer: { label: 'Servers', items: [{ label: 'Create a server', href: '/servers/new', icon: 'plus' }, { label: 'Browse servers', href: '/servers', icon: 'globe' }] },
		addChannel: { label: 'Channels', items: [{ label: 'Create a channel', href: '/chat/new/channel', icon: 'plus' }, { label: 'Browse channels', href: '/channels', icon: 'globe' }] },
		dmRow: { label: 'Direct message', items: [{ label: 'View profile', href: '/people', icon: 'user' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin conversation', action: 'pin' }, { separator: true }, { label: 'Hide conversation', action: 'hide', danger: true }] },
		serverRow: { label: 'Server', items: [{ label: 'Server details', action: 'details', icon: 'settings' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin server', action: 'pin' }, { separator: true }, { label: 'Leave server', action: 'leave', danger: true }] },
		channelRow: { label: 'Channel', items: [{ label: 'Channel details', action: 'details', icon: 'settings' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin channel', action: 'pin' }, { separator: true }, { label: 'Leave channel', action: 'leave', danger: true }] },
		account: { label: 'Account', items: [{ label: 'Profile and settings', href: '/account', icon: 'user' }, { separator: true }, { label: 'Log out', action: 'logout', icon: 'logout', danger: true }] },
		notifications: { label: 'Notifications', items: [{ label: 'No new notifications', action: 'notifications-empty' }, { separator: true }, { label: 'View all notifications', href: '/notifications' }] },
		credits: { label: 'Credits', items: [{ label: '2,912 credits available', action: 'credits-summary' }, { label: 'Get more credits', href: '/credits', icon: 'credits' }] }
	},
	footer: { credits: '2912+' }
};

export const sidebarModel = fullSidebarModel;

export function createSidebarModel(preference = {}) {
	const model = structuredClone(fullSidebarModel);
	if (preference.mode !== 'minimal') return model;
	for (const key of ['directMessages', 'servers', 'channels']) {
		model[key] = preference[key] === 'minimal' ? model[key].slice(0, 2) : [];
	}
	return model;
}

export const mobileNavigationItems = [
	{ label: 'Home', path: '/' },
	{ label: 'Files', path: '/files' }
];
