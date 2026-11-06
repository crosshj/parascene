import { describe, expect, test } from '@jest/globals';
import { appendCreationIdToMediaUrl, isCreatedMediaThumbnailRequest } from '../api_routes/utils/url.js';

/**
 * Regression tests for /api/images/created/* owner checks and delegation parsing.
 * Logic mirrors api_routes/create.js helpers (kept in sync manually).
 */

function viewerOwnsCreationRow(row, viewerUserId) {
	if (!row || viewerUserId == null) return false;
	return Number(row.user_id) === Number(viewerUserId);
}

function collectDelegatedCreationIdCandidatesFromMediaRequest(query, referer) {
	const out = [];
	const seen = new Set();
	const add = (raw) => {
		const id = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
		if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
		seen.add(id);
		out.push(id);
	};
	const delegatedRaw = query?.creation_id ?? query?.group_id ?? query?.group_of;
	add(delegatedRaw);
	const ref = String(referer || '');
	const m = ref.match(/\/creations\/(\d+)/);
	if (m) add(m[1]);
	return out;
}

function isLineageChildOfParent(ancestorRow, parentId) {
	const pid = Number(parentId);
	if (!Number.isFinite(pid) || pid <= 0 || !ancestorRow) return false;
	const meta = ancestorRow.meta && typeof ancestorRow.meta === 'object' ? ancestorRow.meta : {};
	if (Number(meta?.mutate_of_id) === pid) return true;
	if (Array.isArray(meta?.direct_parent_ids)) {
		for (const raw of meta.direct_parent_ids) {
			if (Number(raw) === pid) return true;
		}
	}
	return false;
}

describe('appendCreationIdToMediaUrl', () => {
	test('replaces stale source creation_id with parent group id', () => {
		const raw =
			'/api/images/created/19_15819_1782571337840_9315jmf.png?creation_id=15819&variant=thumbnail';
		expect(appendCreationIdToMediaUrl(raw, 16225)).toBe(
			'/api/images/created/19_15819_1782571337840_9315jmf.png?creation_id=16225&variant=thumbnail'
		);
	});
});

describe('isCreatedMediaThumbnailRequest', () => {
	test('detects thumbnail variant query param', () => {
		expect(isCreatedMediaThumbnailRequest('thumbnail')).toBe(true);
		expect(isCreatedMediaThumbnailRequest('Thumbnail')).toBe(true);
		expect(isCreatedMediaThumbnailRequest(undefined)).toBe(false);
		expect(isCreatedMediaThumbnailRequest('')).toBe(false);
		expect(isCreatedMediaThumbnailRequest('full')).toBe(false);
	});
});

describe('viewerOwnsCreationRow', () => {
	test('matches numeric and string user ids', () => {
		expect(viewerOwnsCreationRow({ user_id: 19 }, 19)).toBe(true);
		expect(viewerOwnsCreationRow({ user_id: '19' }, 19)).toBe(true);
		expect(viewerOwnsCreationRow({ user_id: 19 }, '19')).toBe(true);
	});

	test('strict equality would fail for mixed types', () => {
		expect(19 === '19').toBe(false);
	});
});

describe('collectDelegatedCreationIdCandidatesFromMediaRequest', () => {
	test('includes both query creation_id and Referer group id', () => {
		expect(
			collectDelegatedCreationIdCandidatesFromMediaRequest(
				{ creation_id: '15819' },
				'http://localhost:2367/creations/16225?embed=1'
			)
		).toEqual([15819, 16225]);
	});
});

describe('isLineageChildOfParent', () => {
	test('detects mutate_of_id link', () => {
		expect(isLineageChildOfParent({ meta: { mutate_of_id: 100 } }, 100)).toBe(true);
		expect(isLineageChildOfParent({ meta: { mutate_of_id: 101 } }, 100)).toBe(false);
	});
});
