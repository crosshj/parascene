function cleanPath(pathname) {
	const path = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
	return path || '/';
}

function decodeSegment(value) {
	try { return decodeURIComponent(value); } catch { return value; }
}

export function parseSidebarPath(pathname) {
	const path = cleanPath(pathname);
	if (path === '/' || path === '/index.html' || path === '/feed' || path === '/chat') return { kind: 'channel', slug: 'feed' };
	if (path === '/explore') return { kind: 'channel', slug: 'explore' };
	if (path === '/creations') return { kind: 'channel', slug: 'creations' };
	if (path === '/prompt-library') return { kind: 'channel', slug: 'prompt-library' };
	if (path === '/challenges' || path.startsWith('/challenges/')) return { kind: 'channel', slug: 'challenges' };
	const parts = path.split('/').filter(Boolean);
	if (parts[0] !== 'chat') return { kind: 'path', path };
	if (parts[1] === 'notes' && parts.length === 2) return { kind: 'dm', self: true };
	if (parts[1] === 'c' && parts[2]) return { kind: 'channel', slug: decodeSegment(parts[2]).toLowerCase() };
	if (parts[1] === 'dm' && parts[2]) return { kind: 'dm', userName: decodeSegment(parts[2]).replace(/^@/, '').toLowerCase() };
	if (parts[1] === 't' && /^\d+$/.test(parts[2] || '')) return { kind: 'thread', threadId: Number(parts[2]) };
	return { kind: 'path', path };
}

export function isSidebarRouteActive(item, pathname) {
	if (!item?.path) return false;
	const current = parseSidebarPath(pathname);
	const target = item.route || parseSidebarPath(item.path);
	if (current.kind === 'channel' && target.kind === 'channel') return current.slug === target.slug;
	if (current.kind === 'dm' && target.kind === 'dm') {
		if (current.self || target.self) return current.self === true && target.self === true;
		return current.userName === target.userName;
	}
	if (current.kind === 'thread') return Number(item.route?.threadId) === current.threadId;
	return current.kind === 'path' && target.kind === 'path' && current.path === target.path;
}
