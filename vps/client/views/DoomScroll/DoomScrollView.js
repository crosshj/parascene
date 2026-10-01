import './DoomScrollView.css';

export const DoomScrollView = Object.freeze({
	mount({ outlet, creationId }) {
		outlet.innerHTML = `<section class="doom-scroll-view">
			<div class="doom-scroll-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div>
			<h2>Doom Scroll · ${escapeHtml(creationId)}</h2><nav aria-label="Doom scroll navigation"><a href="/feed" data-spa-link>Back to Feed</a><a href="/create" data-spa-link>Create</a><a href="/creations/${encodeURIComponent(creationId)}" data-spa-link>Open creation</a></nav>
		</section>`;
		document.title = 'Doom Scroll - parascene beta';
		return { backgroundReady: Promise.resolve(), destroy() { outlet.replaceChildren(); } };
	},
});

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
