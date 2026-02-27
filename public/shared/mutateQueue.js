const QUEUE_KEY = 'mutateQueue:v1';

function readQueue() {
	try {
		const raw = window.localStorage?.getItem(QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const sourceIdNum = Number(item.sourceId);
				const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
				if (!imageUrl) return null;
				return {
					sourceId: Number.isFinite(sourceIdNum) && sourceIdNum > 0 ? sourceIdNum : null,
					imageUrl,
					queuedAt: Number.isFinite(Number(item.queuedAt)) ? Number(item.queuedAt) : Date.now()
				};
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function writeQueue(items) {
	try {
		const safe = Array.isArray(items) ? items : [];
		window.localStorage?.setItem(QUEUE_KEY, JSON.stringify(safe));
	} catch {
		// Ignore storage errors (quota, privacy mode, etc.)
	}
}

export function loadMutateQueue() {
	return readQueue();
}

export function addToMutateQueue({ sourceId, imageUrl }) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	const idNum = Number(sourceId);
	if (!url) return;

	const current = readQueue();
	const filtered = current.filter((item) => item.imageUrl !== url && item.sourceId !== idNum);
	const nextItem = {
		sourceId: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
		imageUrl: url,
		queuedAt: Date.now()
	};
	filtered.unshift(nextItem);
	writeQueue(filtered);
}

export function removeFromMutateQueueByImageUrl(imageUrl) {
	const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
	if (!url) return;
	const current = readQueue();
	const next = current.filter((item) => item.imageUrl !== url);
	if (next.length === current.length) return;
	writeQueue(next);
}

export function clearMutateQueue() {
	writeQueue([]);
}

