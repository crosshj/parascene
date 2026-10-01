import './LibraryView.css';

export const LibraryView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = `<section class="library-view">
			<div class="library-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Library</h2><nav aria-label="Library navigation"><a href="/feed" data-spa-link>Feed</a><a href="/create" data-spa-link>Create</a><a href="/creations" data-spa-link>My Creations</a></nav>
		</section>`;
		document.title = 'Library - parascene beta';
		return { destroy() { outlet.replaceChildren(); } };
	},
});
