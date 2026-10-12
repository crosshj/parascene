import { describe, expect, test } from '@jest/globals';
import {
	defaultAcceptedMediaForTrack,
	normalizeAcceptedMedia,
	resolveChallengeAcceptedMedia,
	challengeAcceptsMediaType,
	creationMediaTypeFromMeta,
	ACCEPTED_MEDIA_AUDIO,
	ACCEPTED_MEDIA_IMAGE_VIDEO
} from '../src/chat/challenges/model/tracks.js';
import { resolveCreateAcceptedMedia } from '../src/chat/challenges/model/prizes.js';
import { filterAcceptingChallengesByMedia } from '../api_routes/utils/challengeSubmitShared.js';

describe('accepted_media defaults', () => {
	test('monthly/weekly accept image+video; suno accepts audio', () => {
		expect(defaultAcceptedMediaForTrack('monthly')).toEqual([...ACCEPTED_MEDIA_IMAGE_VIDEO]);
		expect(defaultAcceptedMediaForTrack('weekly')).toEqual([...ACCEPTED_MEDIA_IMAGE_VIDEO]);
		expect(defaultAcceptedMediaForTrack('suno')).toEqual([...ACCEPTED_MEDIA_AUDIO]);
	});
});

describe('normalizeAcceptedMedia / resolveChallengeAcceptedMedia', () => {
	test('normalizes and dedupes', () => {
		expect(normalizeAcceptedMedia(['audio', 'AUDIO', 'image', 'gif'])).toEqual(['audio', 'image']);
	});

	test('falls back to track default when missing', () => {
		expect(resolveChallengeAcceptedMedia({ track: 'suno' })).toEqual(['audio']);
		expect(resolveChallengeAcceptedMedia({ track: 'monthly' })).toEqual(['image', 'video']);
	});

	test('explicit accepted_media wins', () => {
		expect(
			resolveChallengeAcceptedMedia({
				track: 'suno',
				accepted_media: ['image']
			})
		).toEqual(['image']);
	});
});

describe('challengeAcceptsMediaType', () => {
	test('audio only on suno by default', () => {
		expect(challengeAcceptsMediaType({ track: 'suno' }, 'audio')).toBe(true);
		expect(challengeAcceptsMediaType({ track: 'suno' }, 'image')).toBe(false);
		expect(challengeAcceptsMediaType({ track: 'monthly' }, 'audio')).toBe(false);
		expect(challengeAcceptsMediaType({ track: 'monthly' }, 'video')).toBe(true);
	});
});

describe('creationMediaTypeFromMeta', () => {
	test('defaults to image', () => {
		expect(creationMediaTypeFromMeta(null)).toBe('image');
		expect(creationMediaTypeFromMeta({ media_type: 'audio' })).toBe('audio');
	});
});

describe('resolveCreateAcceptedMedia', () => {
	test('inherits from latest same-track by submission start', () => {
		const summaries = [
			{
				challenge_id: 'old',
				merged: {
					track: 'suno',
					accepted_media: ['audio'],
					submission_start_at: '2026-01-01T00:00:00.000Z'
				}
			},
			{
				challenge_id: 'newer',
				merged: {
					track: 'suno',
					accepted_media: ['audio', 'image'],
					submission_start_at: '2026-06-01T00:00:00.000Z'
				}
			}
		];
		expect(resolveCreateAcceptedMedia('suno', summaries)).toEqual(['audio', 'image']);
	});

	test('falls back to track template', () => {
		expect(resolveCreateAcceptedMedia('suno', [])).toEqual(['audio']);
	});
});

describe('filterAcceptingChallengesByMedia', () => {
	test('keeps only matching tracks', () => {
		const accepting = [
			{ cfg: { track: 'monthly', challenge_id: 'm1' }, challengeId: 'm1' },
			{ cfg: { track: 'suno', challenge_id: 's1' }, challengeId: 's1' }
		];
		expect(filterAcceptingChallengesByMedia(accepting, 'audio').map((r) => r.challengeId)).toEqual([
			's1'
		]);
		expect(filterAcceptingChallengesByMedia(accepting, 'image').map((r) => r.challengeId)).toEqual([
			'm1'
		]);
	});
});
