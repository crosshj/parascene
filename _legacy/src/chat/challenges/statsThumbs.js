/**
 * Thumbnail hydration for organizer stats-style tables. Same authorization
 * path as blind voting: `?challenge_message_id=` unlocks unpublished entries.
 * Consumers: mountOrganizerSidebar.js (stats modal), organizeResults.js (payout tab).
 */

/** Creation payload from GET /api/create/images/:id (with optional challenge_message_id). */
export function statsThumbSrcFromCreationPayload(c) {
	if (!c || c._error) return '';
	const mediaType = typeof c.media_type === 'string' ? c.media_type : 'image';
	const videoUrl = typeof c.video_url === 'string' ? c.video_url.trim() : '';
	const url = typeof c.url === 'string' ? c.url.trim() : '';
	const thumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';
	if (mediaType === 'video') return (thumb || url || videoUrl).trim();
	return (url || thumb).trim();
}

function escapeHtmlAttr(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * @param {HTMLElement} rootEl — element containing `[data-challenge-stats-thumb-slot]`
 */
export async function hydrateChallengeOrganizerStatsThumbs(rootEl) {
	const slots = rootEl.querySelectorAll('[data-challenge-stats-thumb-slot]');
	await Promise.all(
		[...slots].map(async (slot) => {
			const cid = Number(slot.getAttribute('data-creation-id'));
			const midRaw = slot.getAttribute('data-challenge-message-id');
			const mid = Number(midRaw);
			if (!Number.isFinite(cid) || cid <= 0) return;
			const qs =
				Number.isFinite(mid) && mid > 0
					? `?challenge_message_id=${encodeURIComponent(String(mid))}`
					: '';
			let src = '';
			try {
				const res = await fetch(`/api/create/images/${encodeURIComponent(String(cid))}${qs}`, {
					credentials: 'include'
				});
				const c = res.ok ? await res.json().catch(() => null) : null;
				src = statsThumbSrcFromCreationPayload(c);
			} catch {
				src = '';
			}
			if (src && slot.isConnected) {
				slot.innerHTML = `<img class="challenge-pane-organizer-stats-thumb" src="${escapeHtmlAttr(src)}" alt="" width="40" height="40" decoding="async" loading="lazy" />`;
			}
		})
	);
}
