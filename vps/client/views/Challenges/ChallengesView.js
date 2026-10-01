import './ChallengesView.css';

export const ChallengesView = Object.freeze({
	mount({ outlet, title = 'Challenges', viewName = 'Challenges', challengeId }) {
		const detail = viewName.includes('Details');
		const heading = detail ? `Challenge ${escapeHtml(challengeId || '')}` : viewName.includes('Organize') ? 'Organize challenges' : 'Challenges';
		outlet.innerHTML = `<section class="challenges-view">
			<div class="challenges-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>${escapeHtml(heading)}</h2>
			<nav aria-label="Challenge routes"><a href="/challenges" data-spa-link>Challenges</a><a href="/challenges/organize" data-spa-link>Organize challenges</a><a href="/challenges/details/demo" data-spa-link>Challenge details</a><a href="/feed" data-spa-link>Feed</a></nav>
		</section>`;
		document.title = `${title} - parascene beta`;
		return { destroy() { outlet.replaceChildren(); } };
	},
});
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
