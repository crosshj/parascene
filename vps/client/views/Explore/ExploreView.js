import { renderComingSoonView } from '../ComingSoonView.js';

export const ExploreView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = renderComingSoonView('Explore', 'Discover creations and find inspiration from the community.');
		document.title = 'Explore - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
