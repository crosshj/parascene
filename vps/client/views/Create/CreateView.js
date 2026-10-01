import './CreateView.css';

export const CreateView = Object.freeze({
	mount({ outlet }) {
		outlet.innerHTML = `<section class="create-view">
			<div class="create-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Create</h2><nav aria-label="Create navigation"><a href="/feed" data-spa-link>Back to Feed</a><a href="/creations/1" data-spa-link>Open a creation</a></nav>
		</section>`;
		document.title = 'Create - parascene beta';
		return { backgroundReady: Promise.resolve(), destroy() { outlet.replaceChildren(); } };
	},
});
