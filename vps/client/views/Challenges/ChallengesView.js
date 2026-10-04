import { renderComingSoonView } from '../ComingSoonView.js';

export const ChallengesView = Object.freeze({
	mount({ outlet, title = 'Challenges' }) {
		outlet.innerHTML = renderComingSoonView('Challenges', 'Take part in creative challenges and share what you make.');
		document.title = `${title} - parascene beta`;
		return { destroy() { outlet.replaceChildren(); } };
	},
});
