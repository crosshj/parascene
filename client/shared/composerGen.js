/**
 * Shared /gen helpers for chat composer (and similar slash surfaces).
 * Starts the same create job as WWW chat /gen, then callers poll for completion.
 */

const DEFAULT_SERVER_ID = 1;
const DEFAULT_METHOD = 'replicate';
const DEFAULT_MODEL = 'xai/grok-imagine-image';
export const COMPOSER_GEN_POLL_MS = 2400;
export const COMPOSER_GEN_PREVIEW_PLACEHOLDER =
	'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const MENTION_FAILURE_LABELS = {
	not_found: 'User not found',
	ambiguous: 'Ambiguous mention',
	self: 'Cannot mention yourself here',
};

function formatMentionsFailureForDialog(data) {
	const failed = Array.isArray(data?.failed_mentions) ? data.failed_mentions : [];
	if (failed.length === 0) {
		const fallback = data?.message || data?.error || 'Mentions could not be validated.';
		return `${fallback}\n\nIf you submit, @mentions will not be expanded or understood by the image generator.`;
	}
	const lines = failed.map((f) => {
		const m = typeof f?.mention === 'string' ? f.mention : '';
		const r = MENTION_FAILURE_LABELS[f?.reason] || f?.reason || 'Unknown';
		return m ? `• ${m} — ${r}` : `• ${r}`;
	}).filter(Boolean);
	return `Some @mentions couldn't be validated:\n\n${lines.join('\n')}\n\nIf you submit, @mentions will not be expanded or understood by the image generator.`;
}

export function parseGenCommand(text) {
	const m = String(text || '').trim().match(/^\/gen(?:\s+(.+))?$/i);
	if (!m) return null;
	return { prompt: String(m[1] || '').trim() };
}

export function extractStyleKeyFromGenPrompt(prompt) {
	const tokens = String(prompt || '').match(/\$[a-z0-9_-]+/gi) || [];
	if (tokens.length === 0) return { styleKey: '', promptWithoutStyle: String(prompt || '').trim() };
	const last = String(tokens[tokens.length - 1] || '').replace(/^\$/, '').trim().toLowerCase();
	const promptWithoutStyle = String(prompt || '')
		.replace(/\$[a-z0-9_-]+/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return { styleKey: last === 'none' ? '' : last, promptWithoutStyle };
}

function extractMentionsForGen(prompt) {
	const text = typeof prompt === 'string' ? prompt : '';
	if (!text) return [];
	const out = [];
	const seen = new Set();
	const re = /@([a-zA-Z0-9_]+)/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		const full = `@${match[1]}`;
		if (seen.has(full)) continue;
		seen.add(full);
		out.push(full);
	}
	return out;
}

function buildCreationToken() {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 10);
	return `crt_${ts}_${rand}`;
}

async function validateMentionsForGen(prompt) {
	const mentions = extractMentionsForGen(prompt);
	if (mentions.length === 0) return { ok: true, mentions, data: null };
	const res = await fetch('/api/create/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ args: { prompt } }),
	});
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, mentions, data };
}

/**
 * @param {string} promptText
 * @returns {Promise<number>} creation id
 */
export async function startComposerGenFromPrompt(promptText) {
	const fullPrompt = String(promptText || '').trim();
	if (!fullPrompt) throw new Error('Usage: /gen <prompt>');
	const { styleKey, promptWithoutStyle } = extractStyleKeyFromGenPrompt(fullPrompt);
	if (!promptWithoutStyle) throw new Error('Usage: /gen <prompt>');

	const mentionsResult = await validateMentionsForGen(promptWithoutStyle);
	let hydrateMentions = false;
	if (!mentionsResult.ok) {
		let message = 'Mentions could not be validated. Submit anyway?';
		try {
			message = `${formatMentionsFailureForDialog(mentionsResult.data)}\n\nSubmit anyway?`;
		} catch {
			// ignore
		}
		if (!window.confirm(message)) {
			throw new Error('Cancelled /gen.');
		}
	} else if (mentionsResult.mentions.length > 0) {
		hydrateMentions = true;
	}

	const body = {
		server_id: DEFAULT_SERVER_ID,
		method: DEFAULT_METHOD,
		args: {
			prompt: promptWithoutStyle,
			model: DEFAULT_MODEL,
		},
		creation_token: buildCreationToken(),
		...(hydrateMentions ? { hydrate_mentions: true } : {}),
		...(styleKey ? { style_key: styleKey } : {}),
	};

	const res = await fetch('/api/create', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.error || data?.message || 'Failed to start /gen.');
	}
	const creationId = Number(data?.id);
	if (!Number.isFinite(creationId) || creationId <= 0) {
		throw new Error('Generation started but no creation id returned.');
	}
	return creationId;
}

/**
 * One poll of a creation job for a composer gen attachment.
 * @returns {Promise<'pending' | 'ready' | 'error'>}
 */
export async function pollComposerGenOnce(generationId) {
	const id = Number(generationId);
	if (!Number.isFinite(id) || id <= 0) return { state: 'error', error: 'Invalid generation id' };
	try {
		const res = await fetch(`/api/create/images/${id}`, { credentials: 'include' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return { state: 'pending' };
		const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
		if (status === 'creating' || status === 'pending' || status === 'queued' || status === 'processing') {
			return { state: 'pending' };
		}
		if (status === 'completed') {
			return {
				state: 'ready',
				url: `/creations/${id}`,
				thumbnailUrl:
					typeof data.thumbnail_url === 'string' && data.thumbnail_url.trim()
						? data.thumbnail_url.trim()
						: typeof data.url === 'string'
							? data.url.trim()
							: '',
				fullImageUrl: typeof data.url === 'string' && data.url.trim() ? data.url.trim() : '',
			};
		}
		return {
			state: 'error',
			error: typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'Generation failed',
		};
	} catch {
		return { state: 'pending' };
	}
}
