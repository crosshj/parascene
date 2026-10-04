import { renderComingSoonView } from '../ComingSoonView.js';

export const LibraryView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = renderComingSoonView('Library', 'Keep your saved creations and collections together.');
		document.title = 'Library - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
