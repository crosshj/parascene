import { describe, expect, test } from '@jest/globals';
import {
	applyPinSlotsToPayload,
	buildPinSyncOps,
	parseCreationIdFromPinRef,
	pinWindowsFromChallengeConfig,
	resolvePinSlotWindows
} from '../src/chat/challenges/model/pinSlots.js';

describe('pinSlots', () => {
	test('parses creation ids from pin refs', () => {
		expect(parseCreationIdFromPinRef('/creations/20317')).toBe(20317);
		expect(parseCreationIdFromPinRef('https://www.parascene.com/creations/42')).toBe(42);
		expect(parseCreationIdFromPinRef('https://example.com/x.png')).toBeNaN();
	});

	test('derives default open/winners windows from schedule', () => {
		const windows = pinWindowsFromChallengeConfig({
			submission_start_at: '2026-08-01T04:00:00.000Z',
			submission_end_at: '2026-08-10T03:59:59.999Z',
			voting_end_at: '2026-08-10T03:59:59.999Z'
		});
		expect(windows.some((w) => w.kind === 'open')).toBe(true);
		expect(windows.some((w) => w.kind === 'winners')).toBe(true);
	});

	test('prefers stored pin ymds over schedule defaults', () => {
		const windows = resolvePinSlotWindows({
			submission_start_at: '2026-08-01T04:00:00.000Z',
			submission_end_at: '2026-08-10T03:59:59.999Z',
			pin_open_start_ymd: '2026-08-02',
			pin_open_until_ymd: '2026-08-05',
			pin_winners_start_ymd: '2026-08-11',
			pin_winners_until_ymd: '2026-08-20'
		});
		expect(windows.open).toEqual({
			start: '2026-08-02',
			until: '2026-08-05',
			enabled: true
		});
		expect(windows.winners).toEqual({
			start: '2026-08-11',
			until: '2026-08-20',
			enabled: true
		});
	});

	test('applies pin slot form fields onto payload', () => {
		const fd = new FormData();
		fd.set('pin_open_enabled', '1');
		fd.set('pin_winners_enabled', '1');
		fd.set('pin_topic_vote_enabled', '1');
		fd.set('pin_open_start_ymd', '2026-08-01');
		fd.set('pin_open_until_ymd', '2026-08-07');
		fd.set('pin_winners_start_ymd', '2026-08-10');
		fd.set('pin_winners_until_ymd', '2026-08-23');
		const payload = { kind: 'challenge_config' };
		applyPinSlotsToPayload(payload, fd, {
			heroRef: '/creations/1',
			resultsRef: '',
			topicVoteRef: '/creations/9'
		});
		expect(payload.hero_image_url).toBe('/creations/1');
		expect(payload.results_creation_url).toBeUndefined();
		expect(payload.topic_vote_creation_url).toBe('/creations/9');
		expect(payload.pin_open_start_ymd).toBe('2026-08-01');
		expect(payload.pin_open_until_ymd).toBe('2026-08-07');
		expect(payload.pin_open_enabled).toBe(true);
		expect(payload.pin_winners_enabled).toBe(true);
		expect(payload.pin_topic_vote_enabled).toBe(true);
	});

	test('disabled pin slot clears feed pin but keeps creation ref path', () => {
		const fd = new FormData();
		fd.set('pin_open_enabled', '1');
		// winners unchecked → not in FormData
		fd.set('pin_topic_vote_enabled', '1');
		fd.set('pin_open_start_ymd', '2026-08-01');
		fd.set('pin_open_until_ymd', '2026-08-07');
		const payload = { kind: 'challenge_config' };
		applyPinSlotsToPayload(payload, fd, {
			heroRef: '/creations/1',
			resultsRef: '/creations/2',
			topicVoteRef: ''
		});
		expect(payload.pin_open_enabled).toBe(true);
		expect(payload.pin_winners_enabled).toBe(false);
		expect(payload.results_creation_url).toBe('/creations/2');

		const ops = buildPinSyncOps('weekly-1', {
			heroRef: '/creations/10',
			resultsRef: '/creations/20',
			topicVoteRef: '/creations/11',
			openStart: '2026-08-01',
			openUntil: '2026-08-07',
			winnersStart: '2026-08-10',
			winnersUntil: '2026-08-23',
			topicStart: '2026-08-10',
			topicUntil: '2026-08-16',
			openEnabled: true,
			winnersEnabled: false,
			topicEnabled: true,
			localStartOfDayToIso: (ymd) => `${ymd}T00:00:00.000Z`,
			localEndOfDayToIso: (ymd) => `${ymd}T23:59:59.999Z`
		});
		expect(ops[0].clear).toBe(false);
		expect(ops[1]).toEqual({ kind: 'winners', clear: true });
		expect(ops[2].clear).toBe(false);
	});

	test('builds upsert and clear ops for pin sync', () => {
		const ops = buildPinSyncOps('weekly-1', {
			heroRef: '/creations/10',
			resultsRef: '',
			topicVoteRef: '/creations/11',
			openStart: '2026-08-01',
			openUntil: '2026-08-07',
			winnersStart: '2026-08-10',
			winnersUntil: '2026-08-23',
			topicStart: '2026-08-10',
			topicUntil: '2026-08-16',
			localStartOfDayToIso: (ymd) => `${ymd}T00:00:00.000Z`,
			localEndOfDayToIso: (ymd) => `${ymd}T23:59:59.999Z`
		});
		expect(ops).toHaveLength(3);
		expect(ops[0]).toMatchObject({
			kind: 'open',
			clear: false,
			created_image_id: 10,
			starts_at: '2026-08-01T00:00:00.000Z',
			until: '2026-08-07T23:59:59.999Z'
		});
		expect(ops[1]).toEqual({ kind: 'winners', clear: true });
		expect(ops[2].kind).toBe('topic_vote');
		expect(ops[2].clear).toBe(false);
		expect(ops[2].created_image_id).toBe(11);
	});
});
