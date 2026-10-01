import './ExploreView.css';

export const ExploreView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = `<section class="explore-view">
			<div class="explore-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Explore</h2><nav aria-label="Explore navigation"><a href="/feed" data-spa-link>Feed</a><a href="/challenges" data-spa-link>Challenges</a><a href="/library" data-spa-link>Library</a></nav>
		</section>`;
		document.title = 'Explore - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
