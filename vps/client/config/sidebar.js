// Static product navigation and interaction definitions. Conversation and
// server data comes from the chat provider; this module holds sidebar options.
export const navigationItems = [
	{ id: 'feed', label: 'Feed', path: '/feed', icon: 'home' },
	{ id: 'challenges', label: 'Challenges', path: '/challenges', icon: 'trophy' },
	{ id: 'creations', label: 'My Creations', path: '/creations', icon: 'picture' },
	{ id: 'files', label: 'My Files', path: '/files', icon: 'files' },
	{ id: 'notes', label: 'My Notes', path: '/notes', icon: 'notes' },
	{ id: 'comments', label: 'Comments', path: '/comments', icon: 'comments' },
	{ id: 'explore', label: 'Explore', path: '/explore', icon: 'globe' },
	{ id: 'library', label: 'Library', path: '/library', icon: 'book' },
	{ id: 'feedback', label: 'Feedback', path: '/feedback', icon: 'megaphone' }
];

export function sidebarRowMenuItems(item) {
	if (item?.section === 'dm') {
		const items = [];
		if (item.profilePath) items.push({ label: 'View Profile', action: 'profile' });
		items.push({ label: 'Mark as Read', action: 'mark-read' });
		if (item.pinKey) items.push({ label: item.pinned ? 'Unpin Chat' : 'Pin Chat', action: item.pinned ? 'unpin' : 'pin' });
		items.push({ separator: true }, { label: 'Close DM', action: 'hide', danger: true });
		return items;
	}
	const items = [{ label: 'Mark as Read', action: 'mark-read' }];
	if (item?.section === 'server' && item.server?.id) items.push({ label: 'Server details', action: 'server-details' });
	if (item?.section === 'channel' && Number(item.route?.threadId) > 0) {
		items.push({ separator: true }, { label: 'Leave channel', action: 'leave', danger: true });
	}
	return items;
}
