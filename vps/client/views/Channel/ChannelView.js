import './ChannelView.css';

export const ChannelView = Object.freeze({
	mount({ outlet, title = 'Channel', slug = '' }) {
		outlet.innerHTML = `<section class="channel-view"><div class="channel-view__art" role="img" aria-label="Coming soon"><svg viewBox="0 0 240 180" aria-hidden="true"><ellipse cx="120" cy="91" rx="93" ry="59"/><rect x="76" y="46" width="90" height="91" rx="20" transform="rotate(-6 76 46)"/><circle cx="120" cy="92" r="15"/><path d="m112 92 6 6 12-14"/></svg></div><h2>#${escapeHtml(slug || title)}</h2><nav aria-label="Channel routes"><a href="/ch/general" data-spa-link>#general</a><a href="/feedback" data-spa-link>#feedback</a><a href="/feed" data-spa-link>Feed</a></nav></section>`;
		document.title = `${title} - parascene beta`;
		return { destroy() { outlet.replaceChildren(); } };
	},
});
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
