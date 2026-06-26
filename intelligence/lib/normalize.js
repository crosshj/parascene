/**
 * Normalize raw creation rows into a consistent analysis shape.
 */

/**
 * @typedef {object} NormalizedCreation
 * @property {number|string} id
 * @property {string} title
 * @property {string} prompt
 * @property {string} caption
 * @property {string} media_type
 * @property {number|null} creator_id
 * @property {string|null} created_date ISO date string
 * @property {string|null} challenge_event
 * @property {string|null} model_used
 * @property {number} likes
 * @property {number} comments
 * @property {number} remixes
 * @property {number} shares
 * @property {number|null} views
 * @property {number} attention_score
 * @property {number|null} attention_rate
 * @property {{ terms: string[], phrases: string[] }} text_signals
 */

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function pickPrompt(meta, row) {
	const args = meta?.args && typeof meta.args === 'object' ? meta.args : null;
	const fromArgs = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
	if (fromArgs) return fromArgs;
	const fromMeta = typeof meta?.prompt === 'string' ? meta.prompt.trim() : '';
	if (fromMeta) return fromMeta;
	const fromRow = typeof row?.prompt === 'string' ? row.prompt.trim() : '';
	return fromRow;
}

function pickCaption(meta, row) {
	const desc = typeof row?.description === 'string' ? row.description.trim() : '';
	if (desc) return desc;
	const summary = typeof row?.summary === 'string' ? row.summary.trim() : '';
	if (summary) return summary;
	const fromMeta = typeof meta?.description === 'string' ? meta.description.trim() : '';
	return fromMeta;
}

function pickMediaType(meta, row) {
	const mt = row?.media_type ?? meta?.media_type;
	return typeof mt === 'string' && mt.trim() ? mt.trim() : 'image';
}

function pickModel(meta) {
	const method = typeof meta?.method_name === 'string' ? meta.method_name.trim() : '';
	const server = typeof meta?.server_name === 'string' ? meta.server_name.trim() : '';
	const args = meta?.args && typeof meta.args === 'object' ? meta.args : null;
	const modelArg = typeof args?.model === 'string' ? args.model.trim() : '';
	const parts = [method, server, modelArg].filter(Boolean);
	return parts.length ? parts.join(' / ') : null;
}

function pickChallenge(meta, row) {
	const subs = Array.isArray(meta?.challenge_submissions) ? meta.challenge_submissions : [];
	if (subs.length) {
		const ids = subs
			.map((s) => (typeof s?.challenge_id === 'string' ? s.challenge_id.trim() : ''))
			.filter(Boolean);
		if (ids.length) return ids.join(', ');
	}
	const fromRow = row?.challenge_event ?? row?.challenge ?? row?.event;
	if (typeof fromRow === 'string' && fromRow.trim()) return fromRow.trim();
	return null;
}

function pickDate(row) {
	const d = row?.published_at ?? row?.created_at ?? row?.created_date ?? row?.date;
	if (!d) return null;
	const parsed = new Date(d);
	return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * @param {object} row
 * @param {{ likeCount?: number, commentCount?: number, remixCount?: number, shareCount?: number, viewCount?: number|null }} counts
 * @param {{ computeAttention: (c: object) => { attention_score: number, attention_rate: number|null } }} attention
 * @param {{ extractTextSignals: (c: object) => { terms: string[], phrases: string[] } }} signals
 * @returns {NormalizedCreation}
 */
export function normalizeCreation(row, counts, attention, signals) {
	const meta = parseMeta(row?.meta);
	const prompt = pickPrompt(meta, row);
	const caption = pickCaption(meta, row);
	const titleRaw = row?.title ?? '';
	const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : 'Untitled';

	const base = {
		id: row?.id ?? row?.created_image_id,
		title,
		prompt,
		caption,
		media_type: pickMediaType(meta, row),
		creator_id: row?.user_id != null ? Number(row.user_id) : null,
		created_date: pickDate(row),
		challenge_event: pickChallenge(meta, row),
		model_used: pickModel(meta),
		likes: Number(counts.likeCount ?? 0) || 0,
		comments: Number(counts.commentCount ?? 0) || 0,
		remixes: Number(counts.remixCount ?? 0) || 0,
		shares: Number(counts.shareCount ?? 0) || 0,
		views: counts.viewCount ?? null
	};

	const viewsNum = base.views != null ? Number(base.views) : null;
	if (viewsNum != null && !Number.isFinite(viewsNum)) base.views = null;

	const attn = attention.computeAttention(base);
	const text_signals = signals.extractTextSignals(base);

	return {
		...base,
		attention_score: attn.attention_score,
		attention_rate: attn.attention_rate,
		text_signals
	};
}
