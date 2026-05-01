function isCanvasMessageRow(m) {
	const meta = m?.meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
	const canvas = meta.canvas;
	return Boolean(canvas && typeof canvas === 'object');
}

/**
 * Fetch entire thread history oldest → newest (paginates `before`).
 * @param {number} threadId
 */
export async function fetchAllChatThreadMessages(threadId) {
	const tid = Number(threadId);
	if (!Number.isFinite(tid) || tid <= 0) return [];

	let before = /** @type {string | null} */ (null);
	let aggregated = /** @type {object[]} */ ([]);

	for (;;) {
		const qs = new URLSearchParams();
		qs.set('limit', '100');
		if (before) qs.set('before', before);
		const res = await fetch(`/api/chat/threads/${tid}/messages?${qs.toString()}`, {
			credentials: 'include'
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const fromApi = data?.message || data?.error;
			const statusMsg =
				res.status === 401 || res.status === 403
					? 'You may need to sign in to view this channel.'
					: res.status === 404
						? 'This conversation could not be found.'
						: res.status >= 500
							? 'The server could not load messages. Try again shortly.'
							: '';
			throw new Error(
				(typeof fromApi === 'string' && fromApi.trim() ? fromApi.trim() : '') || statusMsg || 'Failed to load challenge messages'
			);
		}
		const chunk = Array.isArray(data.messages) ? data.messages : [];
		aggregated = [...chunk, ...aggregated];
		if (!data.hasMore) break;
		const nb = data.nextBefore;
		if (typeof nb !== 'string' || !nb.trim()) break;
		before = nb.trim();
	}

	return aggregated.filter((m) => !isCanvasMessageRow(m));
}
