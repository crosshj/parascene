export const MUTATE_QUEUE_UPDATED_EVENT = 'mutate-queue-updated';
const MUTATE_QUEUE_STORAGE_KEY = 'mutateQueue:v1';
const CREATE_ATTACHMENT_STORAGE_KEY = 'create_page_image_edit_selection';

function readQueue() {
	try {
		const value = JSON.parse(window.localStorage?.getItem(MUTATE_QUEUE_STORAGE_KEY) || '[]');
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

/** Keep the composer attachment strip and queue event in sync without importing queue logic. */
export function notifyMutateQueueUpdated(detail = {}) {
	const queue = Array.isArray(detail.queueItems) ? detail.queueItems : readQueue();
	try {
		const urls = queue.map((item) => typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '').filter(Boolean);
		if (urls.length) window.localStorage?.setItem(CREATE_ATTACHMENT_STORAGE_KEY, JSON.stringify(urls));
		else window.localStorage?.removeItem(CREATE_ATTACHMENT_STORAGE_KEY);
	} catch {
		// Storage may be unavailable; still dispatch the update event.
	}
	try {
		if (typeof document !== 'undefined') {
			document.dispatchEvent(new CustomEvent(MUTATE_QUEUE_UPDATED_EVENT, {
				detail: {
					reason: typeof detail.reason === 'string' ? detail.reason : 'updated',
					queueLength: queue.length,
				},
			}));
		}
	} catch {
		// Ignore unavailable DOM event APIs.
	}
}
