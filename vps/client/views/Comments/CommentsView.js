import './CommentsView.css';

export const CommentsView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = `<section class="comments-view">
			<div class="comments-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Comments</h2><nav aria-label="Comments navigation"><a href="/feed" data-spa-link>Feed</a><a href="/challenges" data-spa-link>Challenges</a></nav>
		</section>`;
		document.title = 'Comments - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
