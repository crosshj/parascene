/** Static `../userText.js` can stay cached without `?v=` while `challengesChannel.js` updates — missing exports at runtime. */
const _qs = (() => {
	const v =
		typeof document !== 'undefined'
			? document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || ''
			: '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();
const {
	fetchCreationEmbedPayload,
	parseHeroCreationOrShareRef,
	parseHeroDirectMediaUrl
} = await import(`../userText.js${_qs}`);

/**
 * @param {object | null} data — GET /api/create/images/:id
 * @returns {string | null}
 */
function imageUrlFromCreationPayload(data) {
	if (!data || data._error) return null;
	const statusRaw =
		typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'completed';
	if (statusRaw !== 'completed') return null;
	const mediaType = typeof data.media_type === 'string' ? data.media_type : 'image';
	const url = typeof data.url === 'string' ? data.url.trim() : '';
	const thumb =
		typeof data.thumbnail_url === 'string' ? data.thumbnail_url.trim() : '';
	if (mediaType === 'video') {
		return thumb || url || null;
	}
	return url || thumb || null;
}

/**
 * Resolve challenge hero ref (creation/share URL or image URL) inside `.challenge-pane-root`.
 * @param {Element | null | undefined} rootEl
 */
export async function hydrateChallengeHeroImage(rootEl) {
	const wrap = rootEl?.querySelector?.('[data-challenge-hero-pending]');
	if (!(wrap instanceof HTMLElement)) return;

	const raw = wrap.getAttribute('data-challenge-hero-ref') || '';
	const img = wrap.querySelector('[data-challenge-hero-img]');
	const fallback = wrap.querySelector('[data-challenge-hero-fallback]');

	let src = null;
	const cref = parseHeroCreationOrShareRef(raw);
	if (cref?.kind === 'creation') {
		const data = await fetchCreationEmbedPayload(cref.creationId, cref.shareOpts);
		src = imageUrlFromCreationPayload(data);
	}
	if (!src) {
		src = parseHeroDirectMediaUrl(raw);
	}

	wrap.removeAttribute('data-challenge-hero-pending');
	wrap.classList.remove('challenge-pane-hero-image-wrap--pending');

	if (src && img instanceof HTMLImageElement) {
		img.src = src;
		img.hidden = false;
		if (fallback instanceof HTMLElement) fallback.hidden = true;
		return;
	}

	if (fallback instanceof HTMLElement) {
		fallback.hidden = false;
		fallback.textContent = 'Could not load challenge image.';
	}
	if (img instanceof HTMLImageElement) img.hidden = true;
}
