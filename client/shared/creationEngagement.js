const byId = new Map();
const pending = new Map();
const listeners = new Set();
let bound = false;

function idOf(creation) {
	const id = creation?.created_image_id ?? creation?.creation_id ?? creation?.id ?? creation?.image_id;
	if (id == null || id === '') return '';
	const numeric = Number(id);
	return Number.isInteger(numeric) && numeric > 0 ? String(numeric) : '';
}

function toInt(value) {
	const n = Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(n) ? n : 0;
}

function countsFrom(creation, previous) {
	const likeKnown = creation != null && (creation.like_count != null || creation.likeCount != null || creation.likes != null);
	const commentKnown = creation != null && creation.comment_count != null;
	const likedKnown = creation != null && typeof creation.viewer_liked === 'boolean';
	return {
		like_count: likeKnown
			? Math.max(0, toInt(creation.like_count ?? creation.likeCount ?? creation.likes))
			: Math.max(0, previous?.like_count || 0),
		comment_count: commentKnown
			? Math.max(0, toInt(creation.comment_count))
			: Math.max(0, previous?.comment_count || 0),
		viewer_liked: likedKnown ? creation.viewer_liked === true : previous?.viewer_liked === true,
		liked_by: Array.isArray(creation?.liked_by) ? creation.liked_by : (previous?.liked_by || []),
		commented_by: Array.isArray(creation?.commented_by) ? creation.commented_by : (previous?.commented_by || [])
	};
}

function assign(creation, snapshot) {
	if (!creation || typeof creation !== 'object' || !snapshot) return;
	creation.like_count = snapshot.like_count;
	creation.comment_count = snapshot.comment_count;
	creation.viewer_liked = snapshot.viewer_liked;
	if (Array.isArray(snapshot.liked_by)) creation.liked_by = snapshot.liked_by;
	if (Array.isArray(snapshot.commented_by)) creation.commented_by = snapshot.commented_by;
}

function notify(id, snapshot) {
	for (const listener of listeners) {
		try { listener({ id, ...snapshot }); } catch { /* one view cannot block the others */ }
	}
}

function store(id, snapshot) {
	byId.set(id, snapshot);
	notify(id, snapshot);
	return snapshot;
}

function publish(id, snapshot, creation) {
	assign(creation, snapshot);
	store(id, snapshot);
	if (typeof document === 'undefined') return;
	const creationId = Number(id);
	if (!Number.isFinite(creationId) || creationId <= 0) return;
	document.dispatchEvent(new CustomEvent('creation-detail:mutation', {
		detail: {
			creationId,
			reason: 'like-changed',
			like_count: snapshot.like_count,
			viewer_liked: snapshot.viewer_liked,
			liked_by: snapshot.liked_by
		}
	}));
}

function invalidateRelatedCaches() {
	if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
	const message = { type: 'PRSN_SW_INVALIDATE', tags: ['creations', 'feed', 'explore'] };
	if (navigator.serviceWorker.controller) {
		navigator.serviceWorker.controller.postMessage(message);
		return;
	}
	navigator.serviceWorker.ready
		.then((registration) => { registration?.active?.postMessage(message); })
		.catch(() => {});
}

export function projectCreationEngagement(creation, { incoming = false } = {}) {
	const id = idOf(creation);
	const previous = id ? byId.get(id) : null;
	if (id && pending.has(id) && previous) return previous;
	const next = countsFrom(creation, previous);
	if (!id) return next;
	if (!incoming && previous) return previous;
	return store(id, next);
}

export function readCreationEngagement(id) {
	return byId.get(String(id || '')) || null;
}

export function subscribeCreationEngagement(listener) {
	if (typeof listener !== 'function') return () => {};
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function applyAnnouncedEngagement(detail) {
	const id = idOf({ id: detail?.creationId });
	if (!id || !detail) return null;
	const current = byId.get(id) || countsFrom(null, null);
	const reason = String(detail.reason || '');
	if (reason === 'like-changed') {
		const next = { ...current };
		if (typeof detail.viewer_liked === 'boolean') next.viewer_liked = detail.viewer_liked;
		if (detail.like_count != null && Number.isFinite(Number(detail.like_count))) {
			next.like_count = Math.max(0, Number(detail.like_count));
		}
		if (Array.isArray(detail.liked_by)) next.liked_by = detail.liked_by;
		return store(id, next);
	}
	if (reason === 'comment-changed' && detail.comment_count != null && Number.isFinite(Number(detail.comment_count))) {
		return store(id, { ...current, comment_count: Math.max(0, Number(detail.comment_count)) });
	}
	return current;
}

export function bindCreationEngagement() {
	if (bound || typeof document === 'undefined') return;
	bound = true;
	document.addEventListener('creation-detail:mutation', (event) => {
		applyAnnouncedEngagement(event?.detail);
	});
}

export function toggleCreationLike(creation) {
	const id = idOf(creation);
	const numeric = Number(id);
	if (!id || !Number.isFinite(numeric) || numeric <= 0 || pending.has(id)) return null;
	const current = byId.get(id) || countsFrom(creation, null);
	const viewer_liked = current.viewer_liked !== true;
	const optimistic = {
		...current,
		viewer_liked,
		like_count: Math.max(0, current.like_count + (viewer_liked ? 1 : -1))
	};
	pending.set(id, current);
	publish(id, optimistic, creation);
	const done = requestLike(numeric, viewer_liked).then((meta) => {
		const settled = {
			...optimistic,
			like_count: Math.max(0, Number(meta?.like_count) || 0),
			viewer_liked: Boolean(meta?.viewer_liked),
			liked_by: Array.isArray(meta?.liked_by) ? meta.liked_by : (optimistic.liked_by || [])
		};
		pending.delete(id);
		publish(id, settled, creation);
		invalidateRelatedCaches();
		return { ok: true, ...settled };
	}).catch(() => {
		const previous = pending.get(id) || current;
		const latest = byId.get(id) || previous;
		pending.delete(id);
		const restored = {
			...latest,
			like_count: previous.like_count,
			viewer_liked: previous.viewer_liked,
			liked_by: previous.liked_by || []
		};
		publish(id, restored, creation);
		return { ok: false, ...restored };
	});
	return { ...optimistic, done };
}

function requestLike(id, liked) {
	if (typeof fetch !== 'function') return Promise.reject(new Error('Like request failed'));
	const url = `/api/created-images/${encodeURIComponent(String(id))}/like`;
	return fetch(url, { method: liked ? 'POST' : 'DELETE', credentials: 'include' }).then(async (res) => {
		if (!res.ok) {
			let detail = '';
			try {
				const json = await res.json();
				detail = json?.error ? `: ${json.error}` : '';
			} catch { /* ignore */ }
			throw new Error(`Like request failed (${res.status})${detail}`);
		}
		return res.json();
	});
}

export function resetCreationEngagement() {
	byId.clear();
	pending.clear();
}
