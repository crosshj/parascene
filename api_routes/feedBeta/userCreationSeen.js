/**
 * @param {unknown} raw
 * @returns {object}
 */
export function sanitizeFeedImpressionMeta(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out = {};
	const pool = typeof raw.pool === 'string' ? raw.pool.trim().slice(0, 64) : '';
	if (pool) out.pool = pool;
	const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, 64) : '';
	if (source) out.source = source;
	const surface = typeof raw.surface === 'string' ? raw.surface.trim().slice(0, 64) : '';
	if (surface) out.surface = surface;
	const thread = typeof raw.thread === 'string' ? raw.thread.trim().slice(0, 32) : '';
	if (thread) out.thread = thread;
	const feedSessionId =
		typeof raw.feed_session_id === 'string' ? raw.feed_session_id.trim().slice(0, 128) : '';
	if (feedSessionId) out.feed_session_id = feedSessionId;
	const pageIndex = Number(raw.page_index);
	if (Number.isFinite(pageIndex) && pageIndex >= 1) out.page_index = Math.floor(pageIndex);
	const position = Number(raw.position_in_page ?? raw.position);
	if (Number.isFinite(position) && position >= 1) out.position_in_page = Math.floor(position);
	const slotIndex = Number(raw.mobile_slot_index);
	if (Number.isFinite(slotIndex) && slotIndex >= 1) out.mobile_slot_index = Math.floor(slotIndex);
	const trigger = typeof raw.trigger === 'string' ? raw.trigger.trim().slice(0, 32) : '';
	if (trigger) out.trigger = trigger;
	return out;
}

/**
 * @param {object|null|undefined} body
 * @returns {{ creationId: number, meta: object } | null}
 */
export function parseFeedImpressionBody(body) {
	const creationId = Number(body?.creation_id ?? body?.creationId);
	if (!Number.isFinite(creationId) || creationId <= 0) return null;
	const dev =
		body?.attribution && typeof body.attribution === 'object'
			? body.attribution
			: body?.feed_beta_why?.developer && typeof body.feed_beta_why.developer === 'object'
				? body.feed_beta_why.developer
				: {};
	const meta = sanitizeFeedImpressionMeta({
		...dev,
		surface: body?.surface ?? dev?.surface,
		trigger: body?.trigger ?? dev?.trigger
	});
	return { creationId, meta };
}

const BATCH_IMPRESSION_MAX = 50;

/**
 * @param {object|null|undefined} body
 * @returns {{ creationId: number, meta: object }[]}
 */
export function parseFeedImpressionsBatchBody(body) {
	const raw = Array.isArray(body?.items) ? body.items : [];
	const out = [];
	for (const item of raw.slice(0, BATCH_IMPRESSION_MAX)) {
		const parsed = parseFeedImpressionBody(item);
		if (parsed) out.push(parsed);
	}
	return out;
}
