import { createStorageCache } from '../../core/storageCache.js';
import { HOME_ROW_HEIGHT } from '../../shared/homeRow.js';
import { HOME_SAMPLE, loadHomeSection } from './api.js';

export const HOME_SECTIONS = Object.freeze([
	Object.freeze({ id: 'images', title: 'Images', href: '/feed', kind: 'creation', empty: 'No images yet.' }),
	Object.freeze({ id: 'videos', title: 'Videos', href: '/feed', kind: 'creation', empty: 'No videos yet.' }),
	Object.freeze({ id: 'songs', title: 'Songs', href: '/feed', kind: 'creation', empty: 'No songs yet.' }),
	Object.freeze({ id: 'challenges', title: 'Challenges', href: '/challenges', kind: 'challenge', empty: 'No challenges yet.' }),
	Object.freeze({ id: 'commented', title: 'Comments', href: '/comments', kind: 'creation', empty: 'No comments yet.' }),
	Object.freeze({ id: 'newbies', title: 'Newbies', href: '/explore', kind: 'creation', empty: 'No new people yet.' }),
	Object.freeze({ id: 'articles', title: 'Articles', href: '/blog', kind: 'article', empty: 'No articles yet.' })
]);

const TILE_HEIGHT = HOME_ROW_HEIGHT;

function cacheKey(viewerId) {
	return `prsn-home-v11:${viewerId}`;
}

export function homeSkeletonItems() {
	return Array.from({ length: HOME_SAMPLE }, () => ({ skeleton: true, width: TILE_HEIGHT, height: TILE_HEIGHT }));
}

function emptySnapshot() {
	return { sections: HOME_SECTIONS.map((section) => ({ id: section.id, items: homeSkeletonItems() })) };
}

function isSnapshot(data) {
	return Array.isArray(data?.sections)
		&& data.sections.length === HOME_SECTIONS.length
		&& data.sections.every((row) => row && typeof row.id === 'string' && Array.isArray(row.items) && row.items.every((item) => !item?.skeleton));
}

export function createHomeProvider({
	viewerId = null,
	threads = null,
	storage,
	fetchJson,
	loadSection = loadHomeSection
} = {}) {
	const storageFn = typeof storage === 'function'
		? storage
		: () => storage || (typeof localStorage === 'undefined' ? null : localStorage);
	const cache = viewerId ? createStorageCache(cacheKey(viewerId), { storage: storageFn, validate: isSnapshot }) : null;
	let memory = cache?.read()?.data || null;
	let flight = null;

	function toView(snapshot, { pending = false, unauthorized = false } = {}) {
		const byId = new Map((snapshot?.sections || []).map((row) => [row.id, row]));
		return {
			unauthorized,
			sections: HOME_SECTIONS.map((section) => {
				const row = byId.get(section.id);
				const items = Array.isArray(row?.items) ? row.items : [];
				const failed = !pending && Number(row?.errorStatus) > 0 && !items.length;
				return {
					...section,
					status: pending ? 'loading' : (failed ? 'error' : 'ready'),
					items,
					errorStatus: failed ? Number(row.errorStatus) : 0
				};
			})
		};
	}

	function refresh() {
		if (flight) return flight;
		let unauthorized = false;
		flight = Promise.all(HOME_SECTIONS.map(async (section) => {
			try {
				const data = await loadSection(section.id, { viewerId, threads, fetchJson });
				return { id: section.id, items: Array.isArray(data?.items) ? data.items : [] };
			} catch (error) {
				if (error?.name === 'AbortError') throw error;
				if (error?.status === 401) unauthorized = true;
				return { id: section.id, items: [], errorStatus: Number(error?.status) || 1 };
			}
		})).then((sections) => {
			if (unauthorized) {
				const error = new Error('Unauthorized');
				error.status = 401;
				throw error;
			}
			const data = { sections };
			memory = data;
			cache?.write({ data });
			return data;
		}).finally(() => { flight = null; });
		return flight;
	}

	return {
		// No cache: skeletons for every section, then one call when the snapshot is stored.
		// Cache: the stored cards, sizes, and image URLs. No later content update.
		observe(listener) {
			let stopped = false;
			if (memory) {
				listener(toView(memory));
				void refresh().catch((error) => {
					if (!stopped && error?.status === 401) listener({ ...toView(memory), unauthorized: true });
				});
				return () => { stopped = true; };
			}
			listener(toView(emptySnapshot(), { pending: true }));
			void refresh().then((data) => {
				if (!stopped) listener(toView(data));
			}).catch((error) => {
				if (stopped) return;
				if (error?.status === 401) {
					listener({ ...toView(emptySnapshot(), { pending: true }), unauthorized: true });
					return;
				}
				listener(toView(emptySnapshot()));
			});
			return () => { stopped = true; };
		},
		preload() { if (viewerId) void refresh().catch(() => undefined); },
		syncExternalCache(event) {
			if (!viewerId || event?.key !== cacheKey(viewerId)) return;
			memory = cache?.read()?.data || null;
		},
		noteEngagement(creationId, patch) {
			const id = Number(creationId);
			if (!memory || !Number.isInteger(id) || id <= 0 || !patch) return;
			let changed = false;
			for (const section of memory.sections || []) {
				for (const item of section.items || []) {
					const itemId = Number(item?.created_image_id ?? item?.id);
					if (itemId !== id) continue;
					if (patch.like_count != null && item.like_count !== patch.like_count) {
						item.like_count = patch.like_count;
						changed = true;
					}
					if (typeof patch.viewer_liked === 'boolean' && item.viewer_liked !== patch.viewer_liked) {
						item.viewer_liked = patch.viewer_liked;
						changed = true;
					}
					if (patch.comment_count != null && item.comment_count !== patch.comment_count) {
						item.comment_count = patch.comment_count;
						changed = true;
					}
					if (Array.isArray(patch.liked_by) && JSON.stringify(item.liked_by || []) !== JSON.stringify(patch.liked_by)) {
						item.liked_by = patch.liked_by;
						changed = true;
					}
					if (Array.isArray(patch.commented_by) && JSON.stringify(item.commented_by || []) !== JSON.stringify(patch.commented_by)) {
						item.commented_by = patch.commented_by;
						changed = true;
					}
				}
			}
			if (changed) cache?.write({ data: memory });
		},
		clearCache() { memory = null; cache?.clear(); },
		destroy() { memory = null; }
	};
}
