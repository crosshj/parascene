import { describe, expect, test } from '@jest/globals';
import {
	creationEligibleForLatestCommentsStream,
	resolveCreationTitleForLatestComments
} from '../api_routes/utils/latestCommentsVisibility.js';

describe('creationEligibleForLatestCommentsStream', () => {
	const nowMs = Date.parse('2026-08-03T12:00:00.000Z');

	test('allows published creations', () => {
		expect(
			creationEligibleForLatestCommentsStream({ id: 1, published: true, meta: {} }, { nowMs })
		).toBe(true);
		expect(
			creationEligibleForLatestCommentsStream({ id: 1, published: 1, meta: {} }, { nowMs })
		).toBe(true);
	});

	test('denies plain unpublished drafts', () => {
		expect(
			creationEligibleForLatestCommentsStream({ id: 2, published: 0, meta: {} }, { nowMs })
		).toBe(false);
	});

	test('allows unpublished with active challenge feed pin meta', () => {
		expect(
			creationEligibleForLatestCommentsStream(
				{
					id: 3,
					published: false,
					meta: {
						challenge_feed_pins: [
							{
								pin_id: 'challenge-open-summer-1',
								kind: 'open',
								until: '2026-08-10T00:00:00.000Z'
							}
						]
					}
				},
				{ nowMs }
			)
		).toBe(true);
	});

	test('denies expired challenge feed pin meta', () => {
		expect(
			creationEligibleForLatestCommentsStream(
				{
					id: 4,
					published: false,
					meta: {
						challenge_feed_pins: [
							{
								pin_id: 'challenge-open-summer-1',
								kind: 'open',
								until: '2026-07-01T00:00:00.000Z'
							}
						]
					}
				},
				{ nowMs }
			)
		).toBe(false);
	});

	test('allows unpublished results organizer ref after pin expiry', () => {
		expect(
			creationEligibleForLatestCommentsStream(
				{
					id: 5,
					published: false,
					meta: {
						challenge_organizer_refs: [{ challenge_id: 'summer-1', role: 'results' }]
					}
				},
				{ nowMs }
			)
		).toBe(true);
	});

	test('allows unpublished when id is in active editorial pin set', () => {
		expect(
			creationEligibleForLatestCommentsStream(
				{ id: 9001, published: false, meta: {} },
				{ nowMs, activeEditorialPinCreationIds: new Set([9001]) }
			)
		).toBe(true);
		expect(
			creationEligibleForLatestCommentsStream(
				{ id: 9002, published: false, meta: {} },
				{ nowMs, activeEditorialPinCreationIds: new Set([9001]) }
			)
		).toBe(false);
	});

	test('denies unavailable creations even when published', () => {
		expect(
			creationEligibleForLatestCommentsStream(
				{ id: 6, published: true, unavailable_at: '2026-01-01T00:00:00.000Z', meta: {} },
				{ nowMs }
			)
		).toBe(false);
	});
});

describe('resolveCreationTitleForLatestComments', () => {
	const nowMs = Date.parse('2026-08-03T12:00:00.000Z');

	test('prefers creation title when present', () => {
		expect(
			resolveCreationTitleForLatestComments(
				{
					id: 1,
					title: 'Godzilla',
					meta: {}
				},
				{ nowMs }
			)
		).toBe('Godzilla');
	});

	test('challenge media prefers stamped challenge title over creation title', () => {
		expect(
			resolveCreationTitleForLatestComments(
				{
					id: 1,
					title: 'Godzilla',
					meta: {
						challenge_feed_pins: [
							{ pin_id: 'x', title: 'SUMMER', track: 'monthly', until: '2026-08-10T00:00:00.000Z' }
						]
					}
				},
				{ nowMs }
			)
		).toBe('Monthly Challenge: SUMMER');
	});

	test('falls back to active challenge pin title', () => {
		expect(
			resolveCreationTitleForLatestComments(
				{
					id: 20317,
					title: '',
					meta: {
						challenge_feed_pins: [
							{
								pin_id: 'challenge-open-summer',
								title: 'SUMMER',
								track: 'monthly',
								until: '2026-08-10T00:00:00.000Z'
							}
						]
					}
				},
				{ nowMs }
			)
		).toBe('Monthly Challenge: SUMMER');
	});

	test('formats weekly challenge titles', () => {
		expect(
			resolveCreationTitleForLatestComments(
				{
					id: 9,
					title: '',
					meta: {
						challenge_organizer_refs: [
							{ challenge_id: 'w1', role: 'results', title: 'Neon', track: 'weekly' }
						]
					}
				},
				{ nowMs }
			)
		).toBe('Weekly Challenge: Neon');
	});

	test('falls back to challenge title map by challenge_id when pin meta lacks title', () => {
		expect(
			resolveCreationTitleForLatestComments(
				{
					id: 20317,
					title: '',
					meta: {
						challenge_feed_pins: [
							{
								pin_id: 'challenge-open-2026-08-summer',
								challenge_id: '2026-08-summer',
								track: 'monthly',
								until: '2026-08-10T00:00:00.000Z'
							}
						]
					}
				},
				{ nowMs, challengeTitleById: new Map([['2026-08-summer', 'Summer']]) }
			)
		).toBe('Monthly Challenge: Summer');
	});

	test('falls back to Creation id when no titles', () => {
		expect(resolveCreationTitleForLatestComments({ id: 20317, title: '', meta: {} }, { nowMs })).toBe(
			'Creation 20317'
		);
	});
});
