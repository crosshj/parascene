// Static product navigation and interaction definitions. Roster data itself
// always comes from the sidebar API adapter in client/models/sidebar.js.
export const navigationItems = [
	{ id: 'feed', label: 'Feed', path: '/', icon: 'home' },
	{ id: 'challenges', label: 'Challenges', path: '/challenges', icon: 'trophy' },
	{ id: 'creations', label: 'My Creations', path: '/creations', icon: 'picture' },
	{ id: 'files', label: 'My Files', path: '/files', icon: 'files' },
	{ id: 'notes', label: 'My Notes', path: '/chat/notes', icon: 'notes' },
	{ id: 'comments', label: 'Comments', path: '/chat/c/comments', icon: 'comments' },
	{ id: 'explore', label: 'Explore', path: '/explore', icon: 'globe' },
	{ id: 'prompt-library', label: 'Prompt Library', path: '/prompt-library', icon: 'book' },
	{ id: 'feedback', label: 'Feedback', path: '/chat/c/feedback', icon: 'megaphone' }
];

export const sidebarMenus = {
	addDm: { label: 'Direct messages', items: [{ label: 'New direct message', href: '/chat/new/dm', icon: 'plus' }, { label: 'Browse people', href: '/people', icon: 'user' }] },
	addServer: { label: 'Servers', items: [{ label: 'Create a server', href: '/servers/new', icon: 'plus' }, { label: 'Browse servers', href: '/servers', icon: 'globe' }] },
	addChannel: { label: 'Channels', items: [{ label: 'Create a channel', href: '/chat/new/channel', icon: 'plus' }, { label: 'Browse channels', href: '/channels', icon: 'globe' }] },
	dmRow: { label: 'Direct message', items: [{ label: 'View profile', href: '/people', icon: 'user' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin conversation', action: 'pin' }, { separator: true }, { label: 'Hide conversation', action: 'hide', danger: true }] },
	serverRow: { label: 'Server', items: [{ label: 'Server details', action: 'details', icon: 'settings' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin server', action: 'pin' }, { separator: true }, { label: 'Leave server', action: 'leave', danger: true }] },
	channelRow: { label: 'Channel', items: [{ label: 'Channel details', action: 'details', icon: 'settings' }, { label: 'Mark as read', action: 'mark-read' }, { label: 'Pin channel', action: 'pin' }, { separator: true }, { label: 'Leave channel', action: 'leave', danger: true }] },
	account: { label: 'Account', items: [{ label: 'Profile and settings', href: '/account', icon: 'user' }, { separator: true }, { label: 'Log out', action: 'logout', icon: 'logout', danger: true }] },
	notifications: { label: 'Notifications', items: [{ label: 'No new notifications', action: 'notifications-empty' }, { separator: true }, { label: 'View all notifications', href: '/notifications' }] },
	credits: { label: 'Credits', items: [{ label: 'Credits available', action: 'credits-summary' }, { label: 'Get more credits', href: '/credits', icon: 'credits' }] }
};

export const mobileNavigationItems = [
	{ label: 'Home', path: '/' },
	{ label: 'Files', path: '/files' }
];
