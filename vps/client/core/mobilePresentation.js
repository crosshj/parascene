// Route policy shared by shell visibility and the retained WWW footer.
export function mobilePresentation({ url = '/feed', backgroundUrl, overlay } = {}) {
	const path = new URL(backgroundUrl || url, 'https://app.invalid').pathname.replace(/\/+$/, '') || '/';
	const roster = path === '/chat';
	const conversation = /^\/(ch|dm)\//.test(path) || /^\/chat\/t\//.test(path) || path === '/notes' || path === '/feedback';
	const challengeSubpage = path === '/challenges/organize' || path === '/challenges/details' || path.startsWith('/challenges/details/');
	const chatSecondary = ['/files', '/comments', '/explore', '/library'].includes(path);
	const primary = ['/', '/feed', '/challenges', '/creations'].includes(path);
	const browse = path === '/chat' || path === '/explore' || path === '/feed' || path === '/' || path === '/creations' || path === '/comments' || path.startsWith('/challenges');
	return {
		mode: roster ? 'roster' : conversation ? 'conversation' : challengeSubpage ? 'challenge-subpage' : primary ? 'primary' : 'secondary',
		backButton: conversation || challengeSubpage || chatSecondary,
		footer: !overlay && (primary || roster),
		appHeader: !overlay && (primary || roster),
		scrollOwner: overlay ? 'overlay' : browse ? 'document' : 'outlet',
		backgroundScrollOwner: browse ? 'document' : 'outlet',
		active: roster || conversation ? 'connect' : path === '/' || path === '/feed' ? 'feed' : path.startsWith('/challenges') ? 'challenges' : path === '/creations' ? 'creations' : null,
	};
}
