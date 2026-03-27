const _qs = (() => {
	const v = document.querySelector('meta[name="asset-version"]')?.getAttribute('content')?.trim() || '';
	return v ? `?v=${encodeURIComponent(v)}` : '';
})();
const { fetchJsonWithStatusDeduped } = await import(`/shared/api.js${_qs}`);

function toQuery(params) {
	const qs = new URLSearchParams();
	Object.entries(params || {}).forEach(([k, v]) => {
		if (v === undefined || v === null || v === '') return;
		qs.set(k, String(v));
	});
	const s = qs.toString();
	return s ? `?${s}` : '';
}

export function buildCreatedImageActivityUrl(createdImageId, { order, limit, offset } = {}) {
	return `/api/created-images/${encodeURIComponent(String(createdImageId))}/activity${toQuery({ order, limit, offset })}`;
}

export async function fetchCreatedImageActivity(createdImageId, { order = 'asc', limit = 50, offset = 0 } = {}) {
	const url = buildCreatedImageActivityUrl(createdImageId, { order, limit, offset });
	return fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 500 });
}

export function buildLatestCommentsUrl({ limit } = {}) {
	return `/api/comments/latest${toQuery({ limit })}`;
}

export async function fetchLatestComments({ limit = 10 } = {}) {
	const url = buildLatestCommentsUrl({ limit });
	return fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 2000 });
}

async function readResponsePayload(response) {
	const contentType = response.headers?.get?.('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			return await response.json();
		} catch {
			return null;
		}
	}
	try {
		return await response.text();
	} catch {
		return null;
	}
}

export async function postCreatedImageComment(createdImageId, text) {
	const url = `/api/created-images/${encodeURIComponent(String(createdImageId))}/comments`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
		credentials: 'include'
	});
	const data = await readResponsePayload(response);
	return { ok: response.ok, status: response.status, data };
}

/**
 * Toggle a reaction on a comment. POST /api/comments/:commentId/reactions with { emoji_key }.
 * @returns {Promise<{ ok: boolean, status: number, data?: { added: boolean, count: number } }>}
 */
export async function toggleCommentReaction(commentId, emojiKey) {
	const url = `/api/comments/${encodeURIComponent(String(commentId))}/reactions`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ emoji_key: emojiKey }),
		credentials: 'include'
	});
	const data = await readResponsePayload(response);
	return { ok: response.ok, status: response.status, data };
}

/** Admin-only: DELETE /api/comments/:commentId — removes comment and cascaded reactions. */
export async function deleteCreatedImageComment(commentId) {
	const url = `/api/comments/${encodeURIComponent(String(commentId))}`;
	const response = await fetch(url, {
		method: 'DELETE',
		credentials: 'include'
	});
	const data = await readResponsePayload(response);
	return { ok: response.ok, status: response.status, data };
}

/**
 * Toggle a reaction on a chat message. POST /api/chat/messages/:messageId/reactions with { emoji_key }.
 * @returns {Promise<{ ok: boolean, status: number, data?: { added: boolean, count: number } }>}
 */
export async function toggleChatMessageReaction(messageId, emojiKey) {
	const url = `/api/chat/messages/${encodeURIComponent(String(messageId))}/reactions`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ emoji_key: emojiKey }),
		credentials: 'include'
	});
	const data = await readResponsePayload(response);
	return { ok: response.ok, status: response.status, data };
}

