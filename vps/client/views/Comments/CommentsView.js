import { renderComingSoonView } from '../ComingSoonView.js';

export const CommentsView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = renderComingSoonView('Comments', 'Join the conversation around creations and community posts.');
		document.title = 'Comments - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
