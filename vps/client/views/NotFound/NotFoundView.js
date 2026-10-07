import './NotFoundView.css';

export const NotFoundView = Object.freeze({
	mount({ outlet, services }) {
		outlet.innerHTML = `<section class="not-found-view">
			<div class="not-found-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Not found</h2><nav aria-label="Not found navigation"><a href="/feed" data-spa-link>Feed</a></nav>
		</section>`;
		services.providers.document.setTitle('Not found - parascene beta');
		return { destroy() { outlet.replaceChildren(); } };
	},
});
