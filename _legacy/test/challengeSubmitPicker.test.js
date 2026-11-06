import { describe, expect, test } from '@jest/globals';
import {
	listChallengeConfigsAcceptingSubmissions,
	pickChallengeConfigAcceptingSubmissions,
	summarizeAcceptingChallengesForEligibility
} from '../api_routes/utils/challengeSubmitShared.js';
import {
	findChallengeSubmitOption,
	listChallengeSubmitOptions,
	renderChallengeSubmitPickerHtml,
	resolveChallengeSubmitSelection
} from '../public/shared/challengeSubmitPicker.js';

function acceptingConfigMessage(id, createdAt, overrides = {}) {
	return {
		created_at: createdAt,
		body: JSON.stringify({
			kind: 'challenge_config',
			challenge_id: id,
			title: overrides.title || id,
			details: overrides.details || '',
			submission_start_at: '2026-08-01T00:00:00.000Z',
			submission_end_at: '2026-08-20T00:00:00.000Z',
			voting_start_at: '2026-08-01T00:00:00.000Z',
			voting_end_at: '2026-08-20T00:00:00.000Z',
			...overrides
		})
	};
}

describe('listChallengeConfigsAcceptingSubmissions', () => {
	test('returns all accepting challenges newest first', () => {
		const nowMs = Date.parse('2026-08-05T12:00:00.000Z');
		const messages = [
			acceptingConfigMessage('weekly', '2026-08-04T00:00:00.000Z', { title: 'Weekly' }),
			acceptingConfigMessage('monthly', '2026-08-03T00:00:00.000Z', { title: 'Monthly' })
		];
		const list = listChallengeConfigsAcceptingSubmissions(messages, nowMs);
		expect(list.map((r) => r.challengeId)).toEqual(['weekly', 'monthly']);
		expect(pickChallengeConfigAcceptingSubmissions(messages, nowMs)?.challenge_id).toBe(
			'weekly'
		);
		const summary = summarizeAcceptingChallengesForEligibility(list);
		expect(summary[0].title).toBe('Weekly');
		expect(summary[0].ends_at).toBeTruthy();
	});
});

describe('challengeSubmitPicker', () => {
	test('lists options and resolves context selection', () => {
		const options = listChallengeSubmitOptions({
			eligible: true,
			challenges: [
				{ challenge_id: 'a', title: 'Alpha' },
				{ challenge_id: 'b', title: 'Beta' }
			]
		});
		expect(options).toHaveLength(2);
		expect(resolveChallengeSubmitSelection(options, 'b')).toBe('b');
		expect(resolveChallengeSubmitSelection(options, 'stale')).toBe('a');
		expect(findChallengeSubmitOption(options, 'b')?.title).toBe('Beta');
		const html = renderChallengeSubmitPickerHtml(options, 'b');
		expect(html).toMatch(/Choose a challenge/);
		expect(html).toMatch(/value="b"[^>]*checked|checked[^>]*value="b"/);
		expect(renderChallengeSubmitPickerHtml(options.slice(0, 1), 'a')).toBe('');
	});
});
