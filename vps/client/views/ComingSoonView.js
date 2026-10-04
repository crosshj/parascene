import './ComingSoonView.css';

export function renderComingSoonView(title, description) {
	return `<section class="coming-soon-view" aria-labelledby="coming-soon-title">
		<div class="coming-soon-view__art" aria-hidden="true">
			<svg viewBox="0 0 240 180" focusable="false">
				<path class="coming-soon-view__orbit" d="M30 91c0-34 40-61 90-61s90 27 90 61-40 61-90 61S30 125 30 91Z"/>
				<rect class="coming-soon-view__card" x="69" y="45" width="102" height="94" rx="18" transform="rotate(-5 120 92)"/>
				<path class="coming-soon-view__line" d="M91 76h58M91 91h41M91 106h50"/>
				<path class="coming-soon-view__spark" d="m177 45 4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Z"/>
				<circle class="coming-soon-view__dot" cx="60" cy="123" r="5"/>
			</svg>
		</div>
		<p class="coming-soon-view__eyebrow">Coming Soon</p>
		<h1 id="coming-soon-title">${escapeHtml(title)}</h1>
		<p class="coming-soon-view__description">${escapeHtml(description)}</p>
	</section>`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
